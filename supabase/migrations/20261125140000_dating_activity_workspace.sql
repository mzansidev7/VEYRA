create index if not exists likes_created_at_idx
  on public.likes (created_at desc);
create index if not exists matches_created_at_idx
  on public.matches (created_at desc);
create index if not exists profile_views_last_viewed_at_idx
  on public.profile_views (last_viewed_at desc);
create index if not exists video_discovery_sessions_created_at_idx
  on public.video_discovery_sessions (created_at desc);
create index if not exists video_discovery_sessions_user_one_created_idx
  on public.video_discovery_sessions (user_one_id, created_at desc);
create index if not exists video_discovery_sessions_user_two_created_idx
  on public.video_discovery_sessions (user_two_id, created_at desc);

insert into public.staff_permissions (code, description)
values (
  'activity.export',
  'Export aggregate dating activity reports.'
)
on conflict (code) do update
set description = excluded.description;

insert into public.staff_role_permissions (role_code, permission_code)
values
  ('super_admin', 'activity.export'),
  ('administrator', 'activity.export'),
  ('analyst', 'activity.export')
on conflict do nothing;

create or replace function public.get_staff_activity_dashboard(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  today_local date := (now() at time zone 'Africa/Johannesburg')::date;
  range_start timestamptz;
  range_end timestamptz;
  previous_start timestamptz;
  previous_end timestamptz;
  range_days integer;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('analytics.view')
  then
    raise exception 'Analytics viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to
    or p_to > today_local or p_to - p_from > 364
  then
    raise exception 'Choose a valid activity date range of up to 365 days.'
      using errcode = '22023';
  end if;

  range_days := p_to - p_from + 1;
  range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';
  previous_start := (p_from - range_days)::timestamp
    at time zone 'Africa/Johannesburg';
  previous_end := p_from::timestamp at time zone 'Africa/Johannesburg';

  select jsonb_build_object(
    'generated_at', now(),
    'date_range', jsonb_build_object('from', p_from, 'to', p_to),
    'current', jsonb_build_object(
      'likes_sent', (
        select count(*) from public.likes as item
        where item.created_at >= range_start and item.created_at < range_end
      ),
      'likes_received', (
        select count(*) from public.likes as item
        where item.created_at >= range_start and item.created_at < range_end
      ),
      'matches', (
        select count(*) from public.matches as item
        where item.created_at >= range_start and item.created_at < range_end
      ),
      'active_matches', (
        select count(*) from public.matches as item
        where item.status = 'active'
          and item.created_at >= range_start and item.created_at < range_end
      ),
      'video_sessions', (
        select count(*) from public.video_discovery_sessions as item
        where item.created_at >= range_start and item.created_at < range_end
      ),
      'video_accepted', (
        select count(*) from public.video_discovery_sessions as item
        where item.accepted_at is not null
          and item.created_at >= range_start and item.created_at < range_end
      ),
      'video_connected', (
        select count(*) from public.video_discovery_sessions as item
        where item.connected_at is not null
          and item.created_at >= range_start and item.created_at < range_end
      ),
      'video_completed', (
        select count(*) from public.video_discovery_sessions as item
        where item.connected_at is not null
          and item.ended_at is not null
          and item.created_at >= range_start and item.created_at < range_end
      ),
      'video_not_connected', (
        select count(*) from public.video_discovery_sessions as item
        where item.connected_at is null
          and item.status in ('declined', 'cancelled', 'expired')
          and item.created_at >= range_start and item.created_at < range_end
      ),
      'average_video_duration_seconds', (
        select round(avg(extract(epoch from (item.ended_at - item.connected_at)))::numeric, 1)
        from public.video_discovery_sessions as item
        where item.connected_at is not null
          and item.ended_at is not null
          and item.created_at >= range_start and item.created_at < range_end
      ),
      'video_acceptance_rate', (
        select round(
          (count(*) filter (where item.accepted_at is not null))::numeric
          * 100
          / nullif(count(*) filter (
            where item.accepted_at is not null or item.status = 'declined'
          ), 0),
          1
        )
        from public.video_discovery_sessions as item
        where item.created_at >= range_start and item.created_at < range_end
      ),
      'video_connection_rate', (
        select round(
          count(*) filter (where item.connected_at is not null)::numeric
          * 100
          / nullif(count(*) filter (where item.accepted_at is not null), 0),
          1
        )
        from public.video_discovery_sessions as item
        where item.created_at >= range_start and item.created_at < range_end
      ),
      'active_members', (
        select count(distinct item.user_id)
        from public.member_activity_days as item
        where item.activity_date between p_from and p_to
      )
    ),
    'previous', jsonb_build_object(
      'likes_sent', (
        select count(*) from public.likes as item
        where item.created_at >= previous_start and item.created_at < previous_end
      ),
      'likes_received', (
        select count(*) from public.likes as item
        where item.created_at >= previous_start and item.created_at < previous_end
      ),
      'matches', (
        select count(*) from public.matches as item
        where item.created_at >= previous_start and item.created_at < previous_end
      ),
      'video_sessions', (
        select count(*) from public.video_discovery_sessions as item
        where item.created_at >= previous_start and item.created_at < previous_end
      ),
      'video_connected', (
        select count(*) from public.video_discovery_sessions as item
        where item.connected_at is not null
          and item.created_at >= previous_start and item.created_at < previous_end
      ),
      'video_completed', (
        select count(*) from public.video_discovery_sessions as item
        where item.connected_at is not null
          and item.ended_at is not null
          and item.created_at >= previous_start and item.created_at < previous_end
      )
    ),
    'lifetime_visitors', jsonb_build_object(
      'recorded_visits', coalesce((
        select sum(visitor.visit_count)
        from public.profile_views as visitor
        join auth.users as visitor_account
          on visitor_account.id = visitor.viewer_id
        left join public.user_privacy_settings as visitor_privacy
          on visitor_privacy.user_id = visitor.viewer_id
        left join public.user_privacy_settings as owner_privacy
          on owner_privacy.user_id = visitor.viewed_user_id
        where not coalesce(visitor_privacy.incognito_mode, false)
          and coalesce(owner_privacy.profile_visitor_history_enabled, true)
          and (visitor_account.banned_until is null
            or visitor_account.banned_until <= now())
          and visitor.owner_action = 'pending'
          and not exists (
            select 1 from public.blocked_users as blocked
            where (blocked.blocker_id = visitor.viewer_id::text
                and blocked.blocked_id = visitor.viewed_user_id::text)
              or (blocked.blocker_id = visitor.viewed_user_id::text
                and blocked.blocked_id = visitor.viewer_id::text)
          )
          and not exists (
            select 1 from public.hidden_profiles as hidden
            where (hidden.user_id = visitor.viewer_id::text
                and hidden.hidden_user_id = visitor.viewed_user_id::text)
              or (hidden.user_id = visitor.viewed_user_id::text
                and hidden.hidden_user_id = visitor.viewer_id::text)
          )
      ), 0),
      'unique_visitor_profiles', (
        select count(*)
        from public.profile_views as visitor
        join auth.users as visitor_account
          on visitor_account.id = visitor.viewer_id
        left join public.user_privacy_settings as visitor_privacy
          on visitor_privacy.user_id = visitor.viewer_id
        left join public.user_privacy_settings as owner_privacy
          on owner_privacy.user_id = visitor.viewed_user_id
        where not coalesce(visitor_privacy.incognito_mode, false)
          and coalesce(owner_privacy.profile_visitor_history_enabled, true)
          and (visitor_account.banned_until is null
            or visitor_account.banned_until <= now())
          and visitor.owner_action = 'pending'
          and not exists (
            select 1 from public.blocked_users as blocked
            where (blocked.blocker_id = visitor.viewer_id::text
                and blocked.blocked_id = visitor.viewed_user_id::text)
              or (blocked.blocker_id = visitor.viewed_user_id::text
                and blocked.blocked_id = visitor.viewer_id::text)
          )
          and not exists (
            select 1 from public.hidden_profiles as hidden
            where (hidden.user_id = visitor.viewer_id::text
                and hidden.hidden_user_id = visitor.viewed_user_id::text)
              or (hidden.user_id = visitor.viewed_user_id::text
                and hidden.hidden_user_id = visitor.viewer_id::text)
          )
      )
    ),
    'today', jsonb_build_object(
      'new_likes', (
        select count(*) from public.likes as item
        where item.created_at >= (today_local::timestamp at time zone 'Africa/Johannesburg')
          and item.created_at < ((today_local + 1)::timestamp at time zone 'Africa/Johannesburg')
      ),
      'new_matches', (
        select count(*) from public.matches as item
        where item.created_at >= (today_local::timestamp at time zone 'Africa/Johannesburg')
          and item.created_at < ((today_local + 1)::timestamp at time zone 'Africa/Johannesburg')
      )
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', days.activity_date,
        'likes_sent', (
          select count(*) from public.likes as item
          where item.created_at >= days.activity_date::timestamp
              at time zone 'Africa/Johannesburg'
            and item.created_at < (days.activity_date + 1)::timestamp
              at time zone 'Africa/Johannesburg'
        ),
        'likes_received', (
          select count(*) from public.likes as item
          where item.created_at >= days.activity_date::timestamp
              at time zone 'Africa/Johannesburg'
            and item.created_at < (days.activity_date + 1)::timestamp
              at time zone 'Africa/Johannesburg'
        ),
        'matches', (
          select count(*) from public.matches as item
          where item.created_at >= days.activity_date::timestamp
              at time zone 'Africa/Johannesburg'
            and item.created_at < (days.activity_date + 1)::timestamp
              at time zone 'Africa/Johannesburg'
        ),
        'profile_visitor_records', (
          select count(*)
          from public.profile_views as visitor
          join auth.users as visitor_account
            on visitor_account.id = visitor.viewer_id
          left join public.user_privacy_settings as visitor_privacy
            on visitor_privacy.user_id = visitor.viewer_id
          left join public.user_privacy_settings as owner_privacy
            on owner_privacy.user_id = visitor.viewed_user_id
          where visitor.last_viewed_at >= days.activity_date::timestamp
              at time zone 'Africa/Johannesburg'
            and visitor.last_viewed_at < (days.activity_date + 1)::timestamp
              at time zone 'Africa/Johannesburg'
            and not coalesce(visitor_privacy.incognito_mode, false)
            and coalesce(owner_privacy.profile_visitor_history_enabled, true)
            and (visitor_account.banned_until is null
              or visitor_account.banned_until <= now())
            and visitor.owner_action = 'pending'
            and not exists (
              select 1 from public.blocked_users as blocked
              where (blocked.blocker_id = visitor.viewer_id::text
                  and blocked.blocked_id = visitor.viewed_user_id::text)
                or (blocked.blocker_id = visitor.viewed_user_id::text
                  and blocked.blocked_id = visitor.viewer_id::text)
            )
            and not exists (
              select 1 from public.hidden_profiles as hidden
              where (hidden.user_id = visitor.viewer_id::text
                  and hidden.hidden_user_id = visitor.viewed_user_id::text)
                or (hidden.user_id = visitor.viewed_user_id::text
                  and hidden.hidden_user_id = visitor.viewer_id::text)
            )
        ),
        'video_sessions', (
          select count(*) from public.video_discovery_sessions as item
          where item.created_at >= days.activity_date::timestamp
              at time zone 'Africa/Johannesburg'
            and item.created_at < (days.activity_date + 1)::timestamp
              at time zone 'Africa/Johannesburg'
        ),
        'active_members', (
          select count(distinct item.user_id)
          from public.member_activity_days as item
          where item.activity_date = days.activity_date
        )
      ) order by days.activity_date)
      from (
        select activity_timestamp::date as activity_date
        from generate_series(
          p_from::timestamp,
          p_to::timestamp,
          interval '1 day'
        ) as generated(activity_timestamp)
      ) as days
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_staff_activity_queue(
  p_kind text,
  p_view text default 'all',
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_sort_by text default 'newest'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  today_local date := (now() at time zone 'Africa/Johannesburg')::date;
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('users.view')
  then
    raise exception 'Member viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('likes', 'matches', 'visitors', 'video')
    or p_view is null
    or p_search is not null and char_length(btrim(p_search)) > 120
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_sort_by is null or p_sort_by not in ('newest', 'oldest', 'updated')
    or p_from is not null and p_to is not null and p_from > p_to
    or p_from > today_local
    or p_to > today_local
  then
    raise exception 'Choose valid activity filters and pagination values.'
      using errcode = '22023';
  end if;

  if p_kind = 'likes' and p_view not in ('all', 'recent',
    'pending', 'matched', 'passed') then
    raise exception 'Choose a valid likes view.' using errcode = '22023';
  elsif p_kind = 'matches' and p_view not in ('all', 'recent', 'active', 'unmatched') then
    raise exception 'Choose a valid matches view.' using errcode = '22023';
  elsif p_kind = 'visitors' and p_view not in ('all', 'recent') then
    raise exception 'Choose a valid profile visitors view.' using errcode = '22023';
  elsif p_kind = 'video' and p_view not in (
    'all', 'pending_acceptance', 'accepted', 'connected',
    'completed', 'declined', 'cancelled', 'expired', 'not_connected'
  ) then
    raise exception 'Choose a valid Video Discovery view.' using errcode = '22023';
  end if;

  if p_from is not null then
    range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if p_to is not null then
    range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';
  end if;

  with activity_rows as materialized (
    select
      'likes'::text as kind,
      item.id::text,
      item.sender_id as first_user_id,
      item.receiver_id as second_user_id,
      item.status,
      item.created_at,
      item.updated_at,
      null::timestamptz as first_viewed_at,
      null::integer as visit_count,
      null::timestamptz as connected_at,
      null::timestamptz as ended_at,
      null::text as end_reason
    from public.likes as item
    where p_kind = 'likes'
      and (p_view not in ('pending', 'matched', 'passed') or item.status = p_view)
      and (p_view <> 'recent' or item.created_at >= now() - interval '7 days')
      and (range_start is null or item.created_at >= range_start)
      and (range_end is null or item.created_at < range_end)

    union all

    select
      'matches',
      item.id::text,
      item.user_one_id,
      item.user_two_id,
      item.status,
      item.created_at,
      coalesce(conversation.updated_at, item.updated_at),
      null::timestamptz,
      null::integer,
      null::timestamptz,
      null::timestamptz,
      null::text
    from public.matches as item
    left join public.conversations as conversation
      on conversation.match_id = item.id
    where p_kind = 'matches'
      and (p_view not in ('active', 'unmatched') or item.status = p_view)
      and (p_view <> 'recent' or item.created_at >= now() - interval '7 days')
      and (range_start is null or item.created_at >= range_start)
      and (range_end is null or item.created_at < range_end)

    union all

    select
      'visitors',
      item.viewer_id::text || ':' || item.viewed_user_id::text,
      item.viewer_id,
      item.viewed_user_id,
      item.owner_action,
      item.first_viewed_at,
      item.last_viewed_at,
      item.first_viewed_at,
      item.visit_count,
      null::timestamptz,
      null::timestamptz,
      null::text
    from public.profile_views as item
    join auth.users as visitor_account on visitor_account.id = item.viewer_id
    left join public.user_privacy_settings as visitor_privacy
      on visitor_privacy.user_id = item.viewer_id
    left join public.user_privacy_settings as owner_privacy
      on owner_privacy.user_id = item.viewed_user_id
    where p_kind = 'visitors'
      and (p_view <> 'recent' or item.last_viewed_at >= now() - interval '7 days')
      and not coalesce(visitor_privacy.incognito_mode, false)
      and coalesce(owner_privacy.profile_visitor_history_enabled, true)
      and (visitor_account.banned_until is null
        or visitor_account.banned_until <= now())
      and item.owner_action = 'pending'
      and (range_start is null or item.last_viewed_at >= range_start)
      and (range_end is null or item.last_viewed_at < range_end)
      and not exists (
        select 1 from public.blocked_users as blocked
        where (blocked.blocker_id = item.viewer_id::text
            and blocked.blocked_id = item.viewed_user_id::text)
          or (blocked.blocker_id = item.viewed_user_id::text
            and blocked.blocked_id = item.viewer_id::text)
      )
      and not exists (
        select 1 from public.hidden_profiles as hidden
        where (hidden.user_id = item.viewer_id::text
            and hidden.hidden_user_id = item.viewed_user_id::text)
          or (hidden.user_id = item.viewed_user_id::text
            and hidden.hidden_user_id = item.viewer_id::text)
      )

    union all

    select
      'video',
      item.id::text,
      item.user_one_id,
      item.user_two_id,
      item.status,
      item.created_at,
      coalesce(item.ended_at, item.connected_at, item.accepted_at, item.created_at),
      null::timestamptz,
      null::integer,
      item.connected_at,
      item.ended_at,
      item.end_reason
    from public.video_discovery_sessions as item
    where p_kind = 'video'
      and (
        p_view = 'all'
        or p_view = 'completed' and item.connected_at is not null and item.ended_at is not null
        or p_view = 'not_connected' and item.connected_at is null
          and item.status in ('declined', 'cancelled', 'expired')
        or p_view = item.status
      )
      and (range_start is null or item.created_at >= range_start)
      and (range_end is null or item.created_at < range_end)
  ),
  enriched as materialized (
    select
      activity.*,
      coalesce(
        nullif(btrim(first_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as first_user_name,
      coalesce(
        nullif(btrim(second_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as second_user_name
    from activity_rows as activity
    left join public.dating_profiles as first_profile
      on first_profile.user_id = activity.first_user_id
    left join public.dating_profiles as second_profile
      on second_profile.user_id = activity.second_user_id
    where nullif(btrim(p_search), '') is null
      or position(lower(btrim(p_search)) in activity.id::text) > 0
      or position(lower(btrim(p_search)) in activity.first_user_id::text) > 0
      or position(lower(btrim(p_search)) in activity.second_user_id::text) > 0
      or position(lower(btrim(p_search)) in lower(coalesce(
        nullif(btrim(first_profile.profile->'profile'->>'nickname'), ''), ''
      ))) > 0
      or position(lower(btrim(p_search)) in lower(coalesce(
        nullif(btrim(second_profile.profile->'profile'->>'nickname'), ''), ''
      ))) > 0
  ),
  page_rows as (
    select * from enriched
    order by
      case when p_sort_by = 'newest' then created_at end desc nulls last,
      case when p_sort_by = 'oldest' then created_at end asc nulls last,
      case when p_sort_by = 'updated' then updated_at end desc nulls last,
      id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from enriched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', page.kind,
        'id', page.id,
        'first_user_id', page.first_user_id,
        'first_user_name', page.first_user_name,
        'second_user_id', page.second_user_id,
        'second_user_name', page.second_user_name,
        'status', page.status,
        'created_at', page.created_at,
        'updated_at', page.updated_at,
        'first_viewed_at', page.first_viewed_at,
        'visit_count', page.visit_count,
        'connected_at', page.connected_at,
        'ended_at', page.ended_at,
        'duration_seconds', case
          when page.connected_at is not null
            then greatest(0, extract(epoch from (
              coalesce(page.ended_at, now()) - page.connected_at
            )))::bigint
          else null
        end,
        'end_reason', page.end_reason
      ) order by page.created_at desc, page.id desc)
      from page_rows as page
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_staff_member_activity_timeline(
  p_user_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  can_view_verification boolean := public.staff_has_permission('verification.view');
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('users.view')
  then
    raise exception 'Member viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or exists (
      select 1 from public.staff_members as staff
      where staff.user_id = p_user_id
    )
  then
    raise exception 'Choose a valid member and timeline page.'
      using errcode = '22023';
  end if;

  with timeline_events as materialized (
    select
      'registration:' || account.id::text as event_id,
      'registration'::text as event_type,
      account.created_at as event_at,
      '{}'::jsonb as details
    from auth.users as account
    where account.id = p_user_id

    union all

    select
      'like-sent:' || item.id::text,
      'like_sent',
      item.created_at,
      jsonb_build_object('status', item.status)
    from public.likes as item
    where item.sender_id = p_user_id

    union all

    select
      'like-received:' || item.id::text,
      'like_received',
      item.created_at,
      jsonb_build_object('status', item.status)
    from public.likes as item
    where item.receiver_id = p_user_id

    union all

    select
      'match:' || item.id::text,
      'match_created',
      item.created_at,
      jsonb_build_object('status', item.status)
    from public.matches as item
    where p_user_id in (item.user_one_id, item.user_two_id)

    union all

    select
      'profile-viewed:' || item.viewer_id::text || ':' || item.viewed_user_id::text,
      'profile_visited',
      item.last_viewed_at,
      jsonb_build_object('recorded_visit_count', item.visit_count)
    from public.profile_views as item
    left join public.user_privacy_settings as member_privacy
      on member_privacy.user_id = p_user_id
    left join public.user_privacy_settings as owner_privacy
      on owner_privacy.user_id = item.viewed_user_id
    where item.viewer_id = p_user_id
      and not coalesce(member_privacy.incognito_mode, false)
      and coalesce(owner_privacy.profile_visitor_history_enabled, true)
      and item.owner_action = 'pending'
      and not exists (
        select 1 from public.blocked_users as blocked
        where (blocked.blocker_id = item.viewer_id::text
            and blocked.blocked_id = item.viewed_user_id::text)
          or (blocked.blocker_id = item.viewed_user_id::text
            and blocked.blocked_id = item.viewer_id::text)
      )
      and not exists (
        select 1 from public.hidden_profiles as hidden
        where (hidden.user_id = item.viewer_id::text
            and hidden.hidden_user_id = item.viewed_user_id::text)
          or (hidden.user_id = item.viewed_user_id::text
            and hidden.hidden_user_id = item.viewer_id::text)
      )

    union all

    select
      'profile-visitor:' || item.viewer_id::text || ':' || item.viewed_user_id::text,
      'profile_visited_by_member',
      item.last_viewed_at,
      jsonb_build_object('recorded_visit_count', item.visit_count)
    from public.profile_views as item
    join auth.users as visitor_account on visitor_account.id = item.viewer_id
    left join public.user_privacy_settings as visitor_privacy
      on visitor_privacy.user_id = item.viewer_id
    left join public.user_privacy_settings as member_privacy
      on member_privacy.user_id = p_user_id
    where item.viewed_user_id = p_user_id
      and item.owner_action = 'pending'
      and not coalesce(visitor_privacy.incognito_mode, false)
      and coalesce(member_privacy.profile_visitor_history_enabled, true)
      and (visitor_account.banned_until is null
        or visitor_account.banned_until <= now())
      and not exists (
        select 1 from public.blocked_users as blocked
        where (blocked.blocker_id = item.viewer_id::text
            and blocked.blocked_id = item.viewed_user_id::text)
          or (blocked.blocker_id = item.viewed_user_id::text
            and blocked.blocked_id = item.viewer_id::text)
      )
      and not exists (
        select 1 from public.hidden_profiles as hidden
        where (hidden.user_id = item.viewer_id::text
            and hidden.hidden_user_id = item.viewed_user_id::text)
          or (hidden.user_id = item.viewed_user_id::text
            and hidden.hidden_user_id = item.viewer_id::text)
      )

    union all

    select
      'video-created:' || item.id::text,
      'video_session_created',
      item.created_at,
      jsonb_build_object('status', item.status)
    from public.video_discovery_sessions as item
    where p_user_id in (item.user_one_id, item.user_two_id)

    union all

    select
      'video-accepted:' || item.id::text,
      'video_session_accepted',
      item.accepted_at,
      jsonb_build_object('status', item.status)
    from public.video_discovery_sessions as item
    where p_user_id in (item.user_one_id, item.user_two_id)
      and item.accepted_at is not null

    union all

    select
      'video-connected:' || item.id::text,
      'video_session_connected',
      item.connected_at,
      jsonb_build_object('status', item.status)
    from public.video_discovery_sessions as item
    where p_user_id in (item.user_one_id, item.user_two_id)
      and item.connected_at is not null

    union all

    select
      'video-ended:' || item.id::text,
      'video_session_ended',
      item.ended_at,
      jsonb_build_object('status', item.status, 'end_reason', item.end_reason)
    from public.video_discovery_sessions as item
    where p_user_id in (item.user_one_id, item.user_two_id)
      and item.ended_at is not null

    union all

    select
      'active-day:' || item.activity_date::text,
      'active_day',
      item.last_seen_at,
      jsonb_build_object('activity_date', item.activity_date)
    from public.member_activity_days as item
    where item.user_id = p_user_id

    union all

    select
      'verification:' || item.id::text,
      'verification_status_changed',
      item.changed_at,
      jsonb_build_object(
        'verification_type', item.verification_type,
        'old_status', item.old_status,
        'new_status', item.new_status
      )
    from public.user_verification_events as item
    where can_view_verification and item.user_id = p_user_id
  ),
  page_rows as (
    select *
    from timeline_events
    order by event_at desc, event_id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from timeline_events),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.event_id,
        'type', page.event_type,
        'created_at', page.event_at,
        'details', page.details
      ) order by page.event_at desc, page.event_id desc)
      from page_rows as page
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.audit_staff_activity_export(
  p_from date,
  p_to date,
  p_dataset text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_id uuid;
  today_local date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if current_user_id is null
    or not public.staff_has_permission('analytics.view')
    or not public.staff_has_permission('activity.export')
  then
    raise exception 'Aggregate activity export permission is required.'
      using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to
    or p_to > today_local or p_to - p_from > 364
    or p_dataset is null or p_dataset <> 'aggregate_activity'
  then
    raise exception 'Choose a valid aggregate activity export range.'
      using errcode = '22023';
  end if;

  select member.id
  into actor_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if actor_staff_id is null then
    raise exception 'An active staff membership is required.'
      using errcode = '42501';
  end if;

  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, action, details
  )
  values (
    actor_staff_id,
    current_user_id,
    'activity.aggregate_export',
    jsonb_build_object(
      'dataset', p_dataset,
      'from', p_from,
      'to', p_to
    )
  );
end;
$$;

revoke all on function public.get_staff_activity_dashboard(date, date)
  from public, anon;
revoke all on function public.get_staff_activity_queue(
  text, text, date, date, text, integer, integer, text
) from public, anon;
revoke all on function public.get_staff_member_activity_timeline(uuid, integer, integer)
  from public, anon;
revoke all on function public.audit_staff_activity_export(date, date, text)
  from public, anon;

grant execute on function public.get_staff_activity_dashboard(date, date)
  to authenticated;
grant execute on function public.get_staff_activity_queue(
  text, text, date, date, text, integer, integer, text
) to authenticated;
grant execute on function public.get_staff_member_activity_timeline(uuid, integer, integer)
  to authenticated;
grant execute on function public.audit_staff_activity_export(date, date, text)
  to authenticated;
