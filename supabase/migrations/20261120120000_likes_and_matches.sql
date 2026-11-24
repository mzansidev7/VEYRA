create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'matched', 'passed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sender_id, receiver_id),
  check (sender_id <> receiver_id)
);

create index if not exists likes_receiver_status_created_idx
  on public.likes (receiver_id, status, created_at desc);
create index if not exists likes_sender_status_created_idx
  on public.likes (sender_id, status, created_at desc);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references auth.users (id) on delete cascade,
  user_two_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'unmatched')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_one_id < user_two_id),
  unique (user_one_id, user_two_id)
);

create index if not exists matches_user_one_created_idx
  on public.matches (user_one_id, created_at desc);
create index if not exists matches_user_two_created_idx
  on public.matches (user_two_id, created_at desc);

alter table public.likes enable row level security;
alter table public.matches enable row level security;
revoke all on public.likes, public.matches from public, anon, authenticated;
grant all on public.likes, public.matches to service_role;

alter table public.discovery_actions
  drop constraint if exists discovery_actions_source_check,
  add constraint discovery_actions_source_check
    check (source in ('daily_five', 'explore', 'likes'));

create or replace function public.sync_discovery_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first_user uuid := least(new.user_id, new.target_user_id);
  v_second_user uuid := greatest(new.user_id, new.target_user_id);
begin
  if new.action not in ('like', 'superlike') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_first_user::text || ':' || v_second_user::text)
  );

  insert into public.likes (sender_id, receiver_id, created_at)
  values (new.user_id, new.target_user_id, new.created_at)
  on conflict (sender_id, receiver_id) do nothing;

  if exists (
    select 1
    from public.likes as reciprocal
    where reciprocal.sender_id = new.target_user_id
      and reciprocal.receiver_id = new.user_id
      and reciprocal.status in ('pending', 'matched')
  ) then
    insert into public.matches (user_one_id, user_two_id)
    values (v_first_user, v_second_user)
    on conflict (user_one_id, user_two_id) do nothing;

    update public.likes
    set status = 'matched', updated_at = now()
    where (sender_id = new.user_id and receiver_id = new.target_user_id)
       or (sender_id = new.target_user_id and receiver_id = new.user_id);
  end if;

  return new;
end;
$$;

revoke all on function public.sync_discovery_like() from public, anon, authenticated;
grant execute on function public.sync_discovery_like() to service_role;

drop trigger if exists discovery_actions_sync_like on public.discovery_actions;
create trigger discovery_actions_sync_like
  after insert on public.discovery_actions
  for each row
  execute function public.sync_discovery_like();

insert into public.likes (sender_id, receiver_id, created_at)
select action.user_id, action.target_user_id, action.created_at
from public.discovery_actions as action
where action.action in ('like', 'superlike')
order by action.created_at
on conflict (sender_id, receiver_id) do nothing;

create or replace function public.build_likes_profile_card(
  p_viewer_id uuid,
  p_candidate_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer_profile jsonb;
  v_candidate_profile jsonb;
  v_compatibility jsonb;
  v_show_age boolean;
  v_show_city boolean;
  v_show_verification boolean;
  v_show_compatibility boolean;
  v_profile jsonb;
begin
  select profile into v_viewer_profile
  from public.dating_profiles
  where user_id = p_viewer_id;

  select candidate.profile into v_candidate_profile
  from public.dating_profiles as candidate
  where candidate.user_id = p_candidate_id;

  if v_viewer_profile is null or v_candidate_profile is null then
    return null;
  end if;

  select
    coalesce(privacy.show_age, true),
    coalesce(privacy.show_city, true),
    coalesce(privacy.show_verification_badge, true),
    coalesce(privacy.show_compatibility_score, true)
  into
    v_show_age,
    v_show_city,
    v_show_verification,
    v_show_compatibility
  from (select 1) as defaults
  left join public.user_privacy_settings as privacy
    on privacy.user_id = p_candidate_id;

  v_compatibility := public.daily_five_compatibility(
    v_viewer_profile,
    v_candidate_profile
  );

  select jsonb_build_object(
    'candidate_id', p_candidate_id,
    'nickname', v_candidate_profile->'profile'->>'nickname',
    'age', case when v_show_age then
      extract(year from age(
        (now() at time zone p_timezone)::date,
        (v_candidate_profile->'profile'->>'birthday')::date
      ))::integer
      else null end,
    'city', case when v_show_city
      then v_candidate_profile->'profile'->>'city'
      else null end,
    'bio', coalesce(v_candidate_profile->'profile'->>'bio', ''),
    'occupation', coalesce(v_candidate_profile->'profile'->>'occupation', ''),
    'interests', coalesce(
      v_candidate_profile->'profile'->'interests',
      '[]'::jsonb
    ),
    'intentions', coalesce(v_candidate_profile->'intentions', '[]'::jsonb),
    'photo_paths', coalesce((
      select jsonb_agg(photo.path order by photo.ordinality)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_candidate_profile->'profile'->'photos') = 'array'
            then v_candidate_profile->'profile'->'photos'
          else '[]'::jsonb
        end
      ) with ordinality as photo(path, ordinality)
      where photo.path like p_candidate_id::text || '/%'
    ), '[]'::jsonb),
    'identity_verified', v_show_verification and exists (
      select 1
      from public.user_verifications as verification
      where verification.user_id = p_candidate_id::text
        and verification.identity_verification_status = 'verified'
    ),
    'compatibility_score', case when v_show_compatibility
      then v_compatibility->'score'
      else null end,
    'compatibility_confidence', case when v_show_compatibility
      then v_compatibility->'confidence'
      else null end,
    'compatibility_breakdown', case when v_show_compatibility then
      jsonb_build_object(
        'version', 1,
        'relationship_intentions', v_compatibility->'relationship_intentions',
        'core_values', v_compatibility->'core_values',
        'lifestyle', v_compatibility->'lifestyle',
        'dating_dna', v_compatibility->'dating_dna',
        'shared_interests', v_compatibility->'shared_interests',
        'communication', v_compatibility->'communication'
      )
      else null end
  ) into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.build_likes_profile_card(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.build_likes_profile_card(uuid, uuid, text)
  to service_role;

create or replace function public.get_likes_feed(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_feed jsonb;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  if not exists (
    select 1 from public.dating_profiles where user_id = p_user_id
  ) then
    raise exception 'A completed profile is required to view Likes.';
  end if;

  select jsonb_build_object(
    'incoming', coalesce((
      select jsonb_agg(
        public.build_likes_profile_card(
          p_user_id,
          like_record.sender_id,
          p_timezone
        ) || jsonb_build_object(
          'like_id', like_record.id,
          'created_at', like_record.created_at,
          'status', like_record.status
        )
        order by like_record.created_at desc
      )
      from public.likes as like_record
      where like_record.receiver_id = p_user_id
        and like_record.status = 'pending'
        and not exists (
          select 1
          from public.blocked_users as blocked
          where (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = like_record.sender_id::text)
             or (blocked.blocker_id = like_record.sender_id::text
            and blocked.blocked_id = p_user_id::text)
        )
        and not exists (
          select 1
          from public.hidden_profiles as hidden
          where hidden.user_id = p_user_id::text
            and hidden.hidden_user_id = like_record.sender_id::text
        )
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(
        public.build_likes_profile_card(
          p_user_id,
          like_record.receiver_id,
          p_timezone
        ) || jsonb_build_object(
          'like_id', like_record.id,
          'created_at', like_record.created_at,
          'status', like_record.status
        )
        order by like_record.created_at desc
      )
      from public.likes as like_record
      where like_record.sender_id = p_user_id
        and like_record.status in ('pending', 'matched')
        and not exists (
          select 1
          from public.blocked_users as blocked
          where (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = like_record.receiver_id::text)
             or (blocked.blocker_id = like_record.receiver_id::text
            and blocked.blocked_id = p_user_id::text)
        )
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(
        public.build_likes_profile_card(
          p_user_id,
          case
            when match.user_one_id = p_user_id then match.user_two_id
            else match.user_one_id
          end,
          p_timezone
        ) || jsonb_build_object(
          'match_id', match.id,
          'created_at', match.created_at,
          'status', match.status
        )
        order by match.created_at desc
      )
      from public.matches as match
      where (match.user_one_id = p_user_id or match.user_two_id = p_user_id)
        and match.status = 'active'
        and not exists (
          select 1
          from public.blocked_users as blocked
          where (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = case
              when match.user_one_id = p_user_id
                then match.user_two_id::text
              else match.user_one_id::text
            end)
             or (blocked.blocked_id = p_user_id::text
            and blocked.blocker_id = case
              when match.user_one_id = p_user_id
                then match.user_two_id::text
              else match.user_one_id::text
            end)
        )
    ), '[]'::jsonb)
  ) into v_feed;

  return v_feed;
end;
$$;

revoke all on function public.get_likes_feed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_likes_feed(uuid, text)
  to service_role;

create or replace function public.respond_to_received_like(
  p_user_id uuid,
  p_sender_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_like public.likes%rowtype;
  v_match_id uuid;
begin
  if p_action not in ('like', 'pass') then
    raise exception 'Choose like or pass for an incoming like.';
  end if;
  if p_user_id = p_sender_id then
    raise exception 'You cannot respond to your own like.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(least(p_user_id::text, p_sender_id::text) || ':' ||
      greatest(p_user_id::text, p_sender_id::text))
  );

  select *
  into v_like
  from public.likes
  where sender_id = p_sender_id
    and receiver_id = p_user_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'This incoming like is no longer available.';
  end if;

  if exists (
    select 1
    from public.blocked_users as blocked
    where (blocked.blocker_id = p_user_id::text
      and blocked.blocked_id = p_sender_id::text)
       or (blocked.blocker_id = p_sender_id::text
      and blocked.blocked_id = p_user_id::text)
  ) then
    raise exception 'This incoming like is no longer available.';
  end if;

  if p_action = 'pass' then
    update public.likes
    set status = 'passed', updated_at = now()
    where id = v_like.id;
    return jsonb_build_object('success', true, 'matched', false);
  end if;

  if exists (
    select 1
    from public.discovery_actions
    where user_id = p_user_id
      and target_user_id = p_sender_id
  ) then
    raise exception 'You have already taken action on this profile.';
  end if;

  insert into public.discovery_actions (
    user_id,
    target_user_id,
    action,
    source
  )
  values (p_user_id, p_sender_id, 'like', 'likes');

  select id into v_match_id
  from public.matches
  where user_one_id = least(p_user_id, p_sender_id)
    and user_two_id = greatest(p_user_id, p_sender_id);

  return jsonb_build_object(
    'success', true,
    'matched', v_match_id is not null,
    'match_id', v_match_id
  );
end;
$$;

revoke all on function public.respond_to_received_like(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.respond_to_received_like(uuid, uuid, text)
  to service_role;
