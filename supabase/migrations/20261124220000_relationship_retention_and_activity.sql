alter table public.profile_views
  add column if not exists visit_count integer not null default 1
    check (visit_count > 0);

create or replace function public.record_profile_view(
  p_viewer_id uuid,
  p_viewed_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer := 0;
begin
  if p_viewer_id is null or p_viewed_user_id is null
    or p_viewer_id = p_viewed_user_id then
    return false;
  end if;

  insert into public.profile_views (
    viewer_id,
    viewed_user_id,
    first_viewed_at,
    last_viewed_at,
    visit_count
  )
  select p_viewer_id, p_viewed_user_id, now(), now(), 1
  where exists (
    select 1
    from public.dating_profiles as viewer
    join public.dating_profiles as viewed
      on viewed.user_id = p_viewed_user_id
    where viewer.user_id = p_viewer_id
  )
    and not exists (
      select 1
      from public.user_privacy_settings as viewer_privacy
      where viewer_privacy.user_id = p_viewer_id
        and viewer_privacy.incognito_mode
    )
    and coalesce((
      select owner_privacy.profile_visitor_history_enabled
      from public.user_privacy_settings as owner_privacy
      where owner_privacy.user_id = p_viewed_user_id
    ), true)
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_viewer_id::text
          and blocked.blocked_id = p_viewed_user_id::text)
         or (blocked.blocker_id = p_viewed_user_id::text
          and blocked.blocked_id = p_viewer_id::text)
    )
    and not exists (
      select 1
      from public.hidden_profiles as hidden
      where (hidden.user_id = p_viewer_id::text
          and hidden.hidden_user_id = p_viewed_user_id::text)
         or (hidden.user_id = p_viewed_user_id::text
          and hidden.hidden_user_id = p_viewer_id::text)
    )
  on conflict (viewer_id, viewed_user_id)
  do update
  set last_viewed_at = excluded.last_viewed_at,
      visit_count = public.profile_views.visit_count + 1;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.get_profile_visitors(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visitors jsonb;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  if not exists (
    select 1 from public.dating_profiles where user_id = p_user_id
  ) then
    raise exception 'A completed profile is required to view profile visitors.';
  end if;

  select coalesce(jsonb_agg(
    public.build_likes_profile_card(
      p_user_id,
      profile_view.viewer_id,
      p_timezone
    ) || jsonb_build_object(
      'visitor_id', profile_view.viewer_id,
      'first_viewed_at', profile_view.first_viewed_at,
      'viewed_at', profile_view.last_viewed_at,
      'visit_count', profile_view.visit_count,
      'active_match', exists (
        select 1
        from public.matches as match
        where match.status = 'active'
          and (
            (match.user_one_id = p_user_id
              and match.user_two_id = profile_view.viewer_id)
            or (match.user_one_id = profile_view.viewer_id
              and match.user_two_id = p_user_id)
          )
      )
    )
    order by profile_view.last_viewed_at desc
  ), '[]'::jsonb)
  into v_visitors
  from public.profile_views as profile_view
  join public.dating_profiles as visitor
    on visitor.user_id = profile_view.viewer_id
  join auth.users as visitor_auth
    on visitor_auth.id = profile_view.viewer_id
  left join public.user_privacy_settings as visitor_privacy
    on visitor_privacy.user_id = profile_view.viewer_id
  where profile_view.viewed_user_id = p_user_id
    and profile_view.owner_action = 'pending'
    and not coalesce(visitor_privacy.incognito_mode, false)
    and (visitor_auth.banned_until is null
      or visitor_auth.banned_until <= now())
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_user_id::text
          and blocked.blocked_id = profile_view.viewer_id::text)
         or (blocked.blocker_id = profile_view.viewer_id::text
          and blocked.blocked_id = p_user_id::text)
    )
    and not exists (
      select 1
      from public.hidden_profiles as hidden
      where (hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = profile_view.viewer_id::text)
         or (hidden.user_id = profile_view.viewer_id::text
          and hidden.hidden_user_id = p_user_id::text)
    );

  return v_visitors;
end;
$$;

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
          'last_activity_at', coalesce(
            latest_message.created_at,
            match.created_at
          ),
          'status', match.status
        )
        order by coalesce(latest_message.created_at, match.created_at) desc
      )
      from public.matches as match
      left join public.conversations as conversation
        on conversation.match_id = match.id
      left join lateral (
        select message.created_at
        from public.messages as message
        where message.conversation_id = conversation.id
        order by message.created_at desc
        limit 1
      ) as latest_message on true
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

revoke all on function public.get_profile_visitors(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_profile_visitors(uuid, text)
  to service_role;

revoke all on function public.get_likes_feed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_likes_feed(uuid, text)
  to service_role;
