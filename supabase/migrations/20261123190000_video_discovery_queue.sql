alter table public.user_privacy_settings
  add column if not exists video_discovery_enabled boolean not null default false;

create table if not exists public.video_discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references auth.users (id) on delete cascade,
  user_two_id uuid not null references auth.users (id) on delete cascade,
  initiated_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending_acceptance'
    check (status in (
      'pending_acceptance',
      'accepted',
      'declined',
      'connected',
      'ended',
      'cancelled',
      'expired'
    )),
  user_one_accepted boolean,
  user_two_accepted boolean,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 seconds',
  accepted_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  check (user_one_id < user_two_id),
  check (initiated_by in (user_one_id, user_two_id)),
  check (user_one_id <> user_two_id),
  check (end_reason is null or end_reason in (
    'user_ended',
    'cancelled',
    'declined',
    'expired',
    'blocked',
    'reported'
  ))
);

create unique index if not exists video_discovery_one_active_session_per_user_one
  on public.video_discovery_sessions (user_one_id)
  where status in ('pending_acceptance', 'accepted', 'connected');
create unique index if not exists video_discovery_one_active_session_per_user_two
  on public.video_discovery_sessions (user_two_id)
  where status in ('pending_acceptance', 'accepted', 'connected');

create table if not exists public.video_discovery_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'searching'
    check (status in ('searching', 'matched', 'cancelled', 'expired')),
  session_id uuid references public.video_discovery_sessions (id)
    on delete cascade,
  queued_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 minutes',
  updated_at timestamptz not null default now(),
  check ((status = 'matched') = (session_id is not null))
);

create unique index if not exists video_discovery_one_search_per_user
  on public.video_discovery_queue (user_id)
  where status = 'searching';
create index if not exists video_discovery_searching_queue_idx
  on public.video_discovery_queue (queued_at)
  where status = 'searching';
create index if not exists video_discovery_queue_session_idx
  on public.video_discovery_queue (session_id)
  where session_id is not null;

alter table public.video_discovery_queue enable row level security;
alter table public.video_discovery_sessions enable row level security;

revoke all on public.video_discovery_queue,
  public.video_discovery_sessions from public, anon, authenticated;
grant select on public.video_discovery_queue,
  public.video_discovery_sessions to authenticated;
grant all on public.video_discovery_queue,
  public.video_discovery_sessions to service_role;

drop policy if exists "Users can read their own video discovery queue entry"
  on public.video_discovery_queue;
create policy "Users can read their own video discovery queue entry"
  on public.video_discovery_queue
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Video session participants can read their sessions"
  on public.video_discovery_sessions;
create policy "Video session participants can read their sessions"
  on public.video_discovery_sessions
  for select
  to authenticated
  using (
    user_one_id = (select auth.uid())
    or user_two_id = (select auth.uid())
  );

create or replace function public.video_discovery_profile_age(
  p_profile jsonb,
  p_timezone text
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_birthday_text text;
  v_birthday date;
begin
  if not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  v_birthday_text := p_profile #>> '{profile,birthday}';
  if v_birthday_text is null
    or v_birthday_text !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  begin
    v_birthday := v_birthday_text::date;
  exception
    when others then
      return null;
  end;

  if v_birthday::text <> v_birthday_text then
    return null;
  end if;

  return extract(year from age(
    (now() at time zone p_timezone)::date,
    v_birthday
  ))::integer;
end;
$$;

create or replace function public.video_discovery_profile_age_preference(
  p_profile jsonb,
  p_preference text
)
returns integer
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_age_text text;
  v_age integer;
begin
  if p_preference not in ('minAge', 'maxAge') then
    return null;
  end if;

  v_age_text := p_profile #>> array['preferences', p_preference];
  if v_age_text is null or v_age_text !~ '^\d{1,2}$' then
    return null;
  end if;

  v_age := v_age_text::integer;
  if v_age not between 18 and 99 then
    return null;
  end if;

  return v_age;
end;
$$;

create or replace function public.video_discovery_profile_has_photo(
  p_profile jsonb,
  p_user_id uuid
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_profile->'profile'->'photos') = 'array'
          then p_profile->'profile'->'photos'
        else '[]'::jsonb
      end
    ) as photo(path)
    where photo.path like p_user_id::text || '/%'
  );
$$;

create or replace function public.video_discovery_pair_is_eligible(
  p_user_id uuid,
  p_candidate_id uuid,
  p_timezone text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dating_profiles as viewer
    join public.dating_profiles as candidate
      on candidate.user_id = p_candidate_id
    join auth.users as viewer_auth
      on viewer_auth.id = viewer.user_id
    join auth.users as candidate_auth
      on candidate_auth.id = candidate.user_id
    left join public.user_privacy_settings as viewer_privacy
      on viewer_privacy.user_id = viewer.user_id
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    cross join lateral (
      select
        case lower(candidate.profile->'profile'->>'gender')
          when 'woman' then 'Women'
          when 'man' then 'Men'
          when 'non-binary' then 'Non-binary people'
          else null
        end as candidate_gender_preference,
        case lower(viewer.profile->'profile'->>'gender')
          when 'woman' then 'Women'
          when 'man' then 'Men'
          when 'non-binary' then 'Non-binary people'
          else null
        end as viewer_gender_preference,
        case
          when viewer.latitude is null
            or viewer.longitude is null
            or candidate.latitude is null
            or candidate.longitude is null
            then null
          else 6371 * 2 * asin(least(1, sqrt(
            power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
            + cos(radians(viewer.latitude))
              * cos(radians(candidate.latitude))
              * power(
                sin(radians(candidate.longitude - viewer.longitude) / 2),
                2
              )
          )))
        end as distance_km
    ) as pair_data
    where viewer.user_id = p_user_id
      and viewer.user_id <> candidate.user_id
      and (viewer_auth.banned_until is null or viewer_auth.banned_until <= now())
      and (
        candidate_auth.banned_until is null
        or candidate_auth.banned_until <= now()
      )
      and coalesce(viewer_privacy.discoverable, true)
      and coalesce(viewer_privacy.show_in_explore, true)
      and coalesce(viewer_privacy.video_discovery_enabled, false)
      and coalesce(candidate_privacy.discoverable, true)
      and coalesce(candidate_privacy.show_in_explore, true)
      and coalesce(candidate_privacy.video_discovery_enabled, false)
      and nullif(btrim(viewer.profile->'profile'->>'nickname'), '') is not null
      and nullif(btrim(candidate.profile->'profile'->>'nickname'), '') is not null
      and public.video_discovery_profile_has_photo(
        viewer.profile,
        viewer.user_id
      )
      and public.video_discovery_profile_has_photo(
        candidate.profile,
        candidate.user_id
      )
      and public.video_discovery_profile_age(viewer.profile, p_timezone) >= 18
      and public.video_discovery_profile_age(candidate.profile, p_timezone) >= 18
      and (viewer.profile->'preferences'->'genders')
        ? pair_data.candidate_gender_preference
      and (candidate.profile->'preferences'->'genders')
        ? pair_data.viewer_gender_preference
      and public.video_discovery_profile_age(candidate.profile, p_timezone)
        between
          public.video_discovery_profile_age_preference(
            viewer.profile,
            'minAge'
          )
          and public.video_discovery_profile_age_preference(
            viewer.profile,
            'maxAge'
          )
      and public.video_discovery_profile_age(viewer.profile, p_timezone)
        between
          public.video_discovery_profile_age_preference(
            candidate.profile,
            'minAge'
          )
          and public.video_discovery_profile_age_preference(
            candidate.profile,
            'maxAge'
          )
      and (
        pair_data.distance_km is null
        or pair_data.distance_km <= least(
          coalesce(viewer.explore_radius_km, 50),
          coalesce(candidate.explore_radius_km, 50)
        )
      )
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = p_candidate_id::text)
          or (blocked.blocker_id = p_candidate_id::text
            and blocked.blocked_id = p_user_id::text)
      )
      and not exists (
        select 1
        from public.hidden_profiles as hidden
        where (hidden.user_id = p_user_id::text
            and hidden.hidden_user_id = p_candidate_id::text)
          or (hidden.user_id = p_candidate_id::text
            and hidden.hidden_user_id = p_user_id::text)
      )
      and not exists (
        select 1
        from public.discovery_actions as action
        where (action.user_id = p_user_id
            and action.target_user_id = p_candidate_id)
          or (action.user_id = p_candidate_id
            and action.target_user_id = p_user_id)
      )
      and not exists (
        select 1
        from public.matches as match
        where match.status = 'active'
          and (
            (match.user_one_id = p_user_id
              and match.user_two_id = p_candidate_id)
            or (match.user_one_id = p_candidate_id
              and match.user_two_id = p_user_id)
          )
      )
      and not exists (
        select 1
        from public.video_discovery_sessions as previous_session
        where previous_session.status in ('declined', 'cancelled', 'expired')
          and previous_session.created_at > now() - interval '24 hours'
          and (
            (previous_session.user_one_id = p_user_id
              and previous_session.user_two_id = p_candidate_id)
            or (previous_session.user_one_id = p_candidate_id
              and previous_session.user_two_id = p_user_id)
          )
      )
  );
$$;

create or replace function public.set_video_discovery_availability(
  p_user_id uuid,
  p_enabled boolean,
  p_timezone text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or p_enabled is null then
    raise exception 'A user and availability value are required.';
  end if;
  if not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  if p_enabled and not exists (
    select 1
    from public.dating_profiles as profile
    where profile.user_id = p_user_id
      and public.video_discovery_profile_age(profile.profile, p_timezone) >= 18
      and nullif(btrim(profile.profile->'profile'->>'nickname'), '') is not null
      and nullif(btrim(profile.profile->'profile'->>'gender'), '') is not null
      and jsonb_typeof(profile.profile->'preferences'->'genders') = 'array'
      and public.video_discovery_profile_has_photo(profile.profile, p_user_id)
  ) then
    raise exception
      'Complete an eligible adult dating profile before enabling Video Discovery.';
  end if;

  insert into public.user_privacy_settings (
    user_id,
    video_discovery_enabled,
    updated_at
  )
  values (p_user_id, p_enabled, now())
  on conflict (user_id) do update
    set video_discovery_enabled = excluded.video_discovery_enabled,
        updated_at = excluded.updated_at;

  return p_enabled;
end;
$$;

create or replace function public.join_video_discovery_queue(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue_id uuid;
  v_session_id uuid;
  v_candidate_id uuid;
  v_candidate_queue_id uuid;
  v_user_one_id uuid;
  v_user_two_id uuid;
  v_session_status text;
  v_expires_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'A user is required to join Video Discovery.';
  end if;
  if not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('veyra-video-discovery-queue'));

  update public.video_discovery_queue
  set status = 'expired', session_id = null, updated_at = now()
  where status = 'searching'
    and expires_at <= now();

  update public.video_discovery_sessions
  set status = 'expired', end_reason = 'expired', ended_at = now()
  where status in ('pending_acceptance', 'accepted')
    and expires_at <= now();

  update public.video_discovery_queue
  set status = 'expired', session_id = null, updated_at = now()
  where status = 'matched'
    and session_id in (
      select id
      from public.video_discovery_sessions
      where status = 'expired'
    );

  if not exists (
    select 1
    from public.dating_profiles as profile
    join public.user_privacy_settings as privacy
      on privacy.user_id = profile.user_id
    where profile.user_id = p_user_id
      and privacy.video_discovery_enabled
      and privacy.discoverable
      and privacy.show_in_explore
      and public.video_discovery_profile_age(profile.profile, p_timezone) >= 18
      and public.video_discovery_profile_has_photo(profile.profile, p_user_id)
  ) then
    raise exception
      'Enable Video Discovery and make sure your eligible adult profile is discoverable before searching.';
  end if;

  select session.id, session.status,
    case
      when session.user_one_id = p_user_id then session.user_two_id
      else session.user_one_id
    end
  into v_session_id, v_session_status, v_candidate_id
  from public.video_discovery_sessions as session
  where p_user_id in (session.user_one_id, session.user_two_id)
    and session.status in ('pending_acceptance', 'accepted', 'connected')
  order by session.created_at desc
  limit 1;

  if v_session_id is not null then
    return jsonb_build_object(
      'state', 'session',
      'session_id', v_session_id,
      'status', v_session_status,
      'other_user_id', v_candidate_id
    );
  end if;

  insert into public.video_discovery_queue (user_id)
  values (p_user_id)
  on conflict (user_id) where status = 'searching' do nothing;

  select id, expires_at into v_queue_id, v_expires_at
  from public.video_discovery_queue
  where user_id = p_user_id
    and status = 'searching'
    and expires_at > now();

  if v_queue_id is null then
    raise exception 'Could not add you to Video Discovery. Please try again.';
  end if;

  select queue.id, queue.user_id
  into v_candidate_queue_id, v_candidate_id
  from public.video_discovery_queue as queue
  join public.dating_profiles as viewer
    on viewer.user_id = p_user_id
  join public.dating_profiles as candidate
    on candidate.user_id = queue.user_id
  where queue.status = 'searching'
    and queue.expires_at > now()
    and queue.user_id <> p_user_id
    and public.video_discovery_pair_is_eligible(
      p_user_id,
      queue.user_id,
      p_timezone
    )
    and not exists (
      select 1
      from public.video_discovery_sessions as active_session
      where active_session.status in (
          'pending_acceptance',
          'accepted',
          'connected'
        )
        and (
          active_session.user_one_id in (p_user_id, queue.user_id)
          or active_session.user_two_id in (p_user_id, queue.user_id)
        )
    )
  order by
    (public.daily_five_compatibility(viewer.profile, candidate.profile)
      ->>'score')::integer desc nulls last,
    queue.queued_at asc
  limit 1
  for update of queue skip locked;

  if v_candidate_id is null then
    return jsonb_build_object(
      'state', 'searching',
      'queue_id', v_queue_id,
      'expires_at', v_expires_at
    );
  end if;

  v_user_one_id := least(p_user_id, v_candidate_id);
  v_user_two_id := greatest(p_user_id, v_candidate_id);

  insert into public.video_discovery_sessions (
    user_one_id,
    user_two_id,
    initiated_by,
    expires_at
  )
  values (
    v_user_one_id,
    v_user_two_id,
    p_user_id,
    now() + interval '45 seconds'
  )
  returning id, expires_at into v_session_id, v_expires_at;

  update public.video_discovery_queue
  set status = 'matched',
      session_id = v_session_id,
      expires_at = v_expires_at,
      updated_at = now()
  where id in (v_queue_id, v_candidate_queue_id);

  return jsonb_build_object(
    'state', 'session',
    'session_id', v_session_id,
    'status', 'pending_acceptance',
    'other_user_id', v_candidate_id,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.respond_to_video_discovery_session(
  p_user_id uuid,
  p_session_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.video_discovery_sessions%rowtype;
  v_all_accepted boolean;
begin
  if p_user_id is null or p_session_id is null or p_accept is null then
    raise exception 'A session and response are required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('veyra-video-discovery-queue'));

  select * into v_session
  from public.video_discovery_sessions
  where id = p_session_id
    and p_user_id in (user_one_id, user_two_id)
  for update;

  if not found then
    raise exception 'This Video Discovery invitation is unavailable.';
  end if;

  if v_session.status <> 'pending_acceptance' then
    return jsonb_build_object(
      'state', v_session.status,
      'session_id', v_session.id
    );
  end if;

  if v_session.expires_at <= now() then
    update public.video_discovery_sessions
    set status = 'expired', end_reason = 'expired', ended_at = now()
    where id = v_session.id;
    update public.video_discovery_queue
    set status = 'expired', session_id = null, updated_at = now()
    where session_id = v_session.id;
    return jsonb_build_object('state', 'expired', 'session_id', v_session.id);
  end if;

  if not p_accept then
    update public.video_discovery_sessions
    set status = 'declined', end_reason = 'declined', ended_at = now()
    where id = v_session.id;

    update public.video_discovery_queue as queue
    set status = case
          when coalesce(privacy.video_discovery_enabled, false)
            then 'searching'
          else 'cancelled'
        end,
        session_id = null,
        queued_at = case
          when coalesce(privacy.video_discovery_enabled, false) then now()
          else queue.queued_at
        end,
        expires_at = case
          when coalesce(privacy.video_discovery_enabled, false)
            then now() + interval '3 minutes'
          else queue.expires_at
        end,
        updated_at = now()
    from public.user_privacy_settings as privacy
    where queue.session_id = v_session.id
      and privacy.user_id = queue.user_id;

    return jsonb_build_object('state', 'declined', 'session_id', v_session.id);
  end if;

  update public.video_discovery_sessions
  set user_one_accepted = case
        when user_one_id = p_user_id then true
        else user_one_accepted
      end,
      user_two_accepted = case
        when user_two_id = p_user_id then true
        else user_two_accepted
      end
  where id = v_session.id
  returning user_one_accepted and user_two_accepted into v_all_accepted;

  if v_all_accepted then
    update public.video_discovery_sessions
    set status = 'accepted',
        accepted_at = now(),
        expires_at = now() + interval '2 minutes'
    where id = v_session.id;
    return jsonb_build_object('state', 'accepted', 'session_id', v_session.id);
  end if;

  return jsonb_build_object(
    'state', 'pending_acceptance',
    'session_id', v_session.id
  );
end;
$$;

create or replace function public.cancel_video_discovery_search(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.video_discovery_sessions%rowtype;
begin
  if p_user_id is null then
    raise exception 'A user is required to cancel Video Discovery.';
  end if;

  perform pg_advisory_xact_lock(hashtext('veyra-video-discovery-queue'));

  select * into v_session
  from public.video_discovery_sessions
  where p_user_id in (user_one_id, user_two_id)
    and status in ('pending_acceptance', 'accepted', 'connected')
  order by created_at desc
  limit 1
  for update;

  if v_session.id is not null and v_session.status = 'connected' then
    return jsonb_build_object(
      'state', 'connected',
      'session_id', v_session.id
    );
  end if;

  if v_session.id is not null then
    update public.video_discovery_sessions
    set status = 'cancelled', end_reason = 'cancelled', ended_at = now()
    where id = v_session.id;

    update public.video_discovery_queue as queue
    set status = case
          when queue.user_id <> p_user_id
            and coalesce(privacy.video_discovery_enabled, false)
            then 'searching'
          else 'cancelled'
        end,
        session_id = null,
        queued_at = case
          when queue.user_id <> p_user_id
            and coalesce(privacy.video_discovery_enabled, false)
            then now()
          else queue.queued_at
        end,
        expires_at = case
          when queue.user_id <> p_user_id
            and coalesce(privacy.video_discovery_enabled, false)
            then now() + interval '3 minutes'
          else queue.expires_at
        end,
        updated_at = now()
    from public.user_privacy_settings as privacy
    where queue.session_id = v_session.id
      and privacy.user_id = queue.user_id;

    return jsonb_build_object(
      'state', 'cancelled',
      'session_id', v_session.id
    );
  end if;

  update public.video_discovery_queue
  set status = 'cancelled', updated_at = now()
  where user_id = p_user_id
    and status = 'searching';

  return jsonb_build_object('state', 'cancelled');
end;
$$;

create or replace function public.enforce_video_discovery_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and old.video_discovery_enabled
    and (
      not new.video_discovery_enabled
      or not new.discoverable
      or not new.show_in_explore
    ) then
    new.video_discovery_enabled := false;
  end if;

  if new.video_discovery_enabled then
    if not exists (
      select 1
      from public.dating_profiles as profile
      where profile.user_id = new.user_id
        and public.video_discovery_profile_age(
          profile.profile,
          coalesce(new.timezone, 'Africa/Johannesburg')
        ) >= 18
        and nullif(btrim(profile.profile->'profile'->>'nickname'), '') is not null
        and nullif(btrim(profile.profile->'profile'->>'gender'), '') is not null
        and jsonb_typeof(profile.profile->'preferences'->'genders') = 'array'
        and public.video_discovery_profile_has_photo(
          profile.profile,
          new.user_id
        )
        and new.discoverable
        and new.show_in_explore
    ) then
      raise exception
        'Complete an adult dating profile and enable discovery visibility before enabling Video Discovery.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.video_discovery_enabled and not new.video_discovery_enabled then
      perform pg_advisory_xact_lock(hashtext('veyra-video-discovery-queue'));

      update public.video_discovery_queue as queue
      set status = 'searching',
          session_id = null,
          queued_at = now(),
          expires_at = now() + interval '3 minutes',
          updated_at = now()
      from public.user_privacy_settings as privacy
      where queue.session_id in (
          select session.id
          from public.video_discovery_sessions as session
          where session.status in ('pending_acceptance', 'accepted')
            and new.user_id in (session.user_one_id, session.user_two_id)
        )
        and queue.user_id <> new.user_id
        and privacy.user_id = queue.user_id
        and privacy.video_discovery_enabled;

      update public.video_discovery_sessions
      set status = 'cancelled', end_reason = 'cancelled', ended_at = now()
      where new.user_id in (user_one_id, user_two_id)
        and status in ('pending_acceptance', 'accepted');

      update public.video_discovery_queue as queue
      set status = 'cancelled',
          session_id = null,
          updated_at = now()
      where queue.user_id = new.user_id
        and queue.status in ('searching', 'matched');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists user_privacy_video_discovery_availability
  on public.user_privacy_settings;
create trigger user_privacy_video_discovery_availability
before insert or update of
  video_discovery_enabled, discoverable, show_in_explore
on public.user_privacy_settings
for each row
execute function public.enforce_video_discovery_availability();

revoke all on function public.video_discovery_profile_age(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.video_discovery_profile_age_preference(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.video_discovery_profile_has_photo(jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.video_discovery_pair_is_eligible(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_video_discovery_availability(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.join_video_discovery_queue(uuid, text)
  from public, anon, authenticated;
revoke all on function public.respond_to_video_discovery_session(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.cancel_video_discovery_search(uuid)
  from public, anon, authenticated;
revoke all on function public.enforce_video_discovery_availability()
  from public, anon, authenticated;

grant execute on function public.set_video_discovery_availability(uuid, boolean, text)
  to service_role;
grant execute on function public.join_video_discovery_queue(uuid, text)
  to service_role;
grant execute on function public.respond_to_video_discovery_session(uuid, uuid, boolean)
  to service_role;
grant execute on function public.cancel_video_discovery_search(uuid)
  to service_role;

do $realtime$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'video_discovery_queue'
    ) then
      alter publication supabase_realtime
        add table public.video_discovery_queue;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'video_discovery_sessions'
    ) then
      alter publication supabase_realtime
        add table public.video_discovery_sessions;
    end if;
  end if;
end;
$realtime$;
