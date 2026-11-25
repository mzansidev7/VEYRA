alter table public.user_reports
  add column if not exists assigned_staff_member_id uuid
    references public.staff_members (id) on delete set null,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by uuid
    references auth.users (id) on delete set null;

alter table public.user_report_events
  add column if not exists old_assigned_staff_member_id uuid,
  add column if not exists new_assigned_staff_member_id uuid,
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.user_report_events
  drop constraint if exists user_report_events_action_check;
alter table public.user_report_events
  add constraint user_report_events_action_check
  check (action in (
    'submitted',
    'status_changed',
    'priority_changed',
    'assigned',
    'escalated',
    'resolution_recorded',
    'note_added'
  ));
alter table public.user_report_events
  drop constraint if exists user_report_events_details_check;
alter table public.user_report_events
  add constraint user_report_events_details_check
  check (jsonb_typeof(details) = 'object');

create index if not exists user_reports_assigned_status_created_idx
  on public.user_reports (assigned_staff_member_id, status, created_at desc);
create index if not exists user_reports_escalated_status_idx
  on public.user_reports (escalated_at desc)
  where escalated_at is not null;

create table if not exists public.user_report_internal_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.user_reports (id)
    on delete cascade,
  actor_user_id uuid not null references auth.users (id)
    on delete restrict,
  actor_staff_member_id uuid not null references public.staff_members (id)
    on delete restrict,
  note text not null check (char_length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists user_report_internal_notes_report_created_idx
  on public.user_report_internal_notes (report_id, created_at desc);

alter table public.user_report_internal_notes enable row level security;
revoke all on public.user_report_internal_notes from public, anon, authenticated;
grant all on public.user_report_internal_notes to service_role;

create or replace function public.log_user_report_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := coalesce((select auth.uid()), new.reporter_id);
  actor_staff_id uuid;
begin
  if actor_id is not null then
    select member.id
    into actor_staff_id
    from public.staff_members as member
    where member.user_id = actor_id
      and member.status = 'active';
  end if;

  if tg_op = 'INSERT' then
    insert into public.user_report_events (
      report_id, actor_user_id, actor_staff_member_id, action,
      new_status, new_priority
    )
    values (
      new.id, actor_id, actor_staff_id, 'submitted',
      new.status, new.priority
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.user_report_events (
      report_id, actor_user_id, actor_staff_member_id, action,
      old_status, new_status
    )
    values (
      new.id, actor_id, actor_staff_id, 'status_changed',
      old.status, new.status
    );
  end if;
  if old.priority is distinct from new.priority then
    insert into public.user_report_events (
      report_id, actor_user_id, actor_staff_member_id, action,
      old_priority, new_priority
    )
    values (
      new.id, actor_id, actor_staff_id, 'priority_changed',
      old.priority, new.priority
    );
  end if;
  if old.assigned_staff_member_id
    is distinct from new.assigned_staff_member_id then
    insert into public.user_report_events (
      report_id, actor_user_id, actor_staff_member_id, action,
      old_assigned_staff_member_id, new_assigned_staff_member_id
    )
    values (
      new.id, actor_id, actor_staff_id, 'assigned',
      old.assigned_staff_member_id, new.assigned_staff_member_id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_user_report_event()
  from public, anon, authenticated;

create or replace function public.get_staff_moderation_assignees()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.view')
  then
    raise exception 'Moderation viewing permission is required.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', member.id,
      'name', member.full_name,
      'roles', role_list.roles,
      'is_senior', role_list.is_senior
    )
    order by member.full_name
  ), '[]'::jsonb)
  into result
  from public.staff_members as member
  cross join lateral (
    select
      array_agg(distinct assignment.role_code order by assignment.role_code)
        as roles,
      bool_or(assignment.role_code in ('super_admin', 'administrator'))
        as is_senior
    from public.staff_role_assignments as assignment
    join public.staff_role_permissions as role_permission
      on role_permission.role_code = assignment.role_code
      and role_permission.permission_code = 'moderation.manage'
    where assignment.staff_member_id = member.id
      and assignment.revoked_at is null
  ) as role_list
  where member.status = 'active'
    and role_list.roles is not null;

  return result;
end;
$$;

create or replace function public.get_staff_safety_overview(
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
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.view')
  then
    raise exception 'Moderation viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to
    or p_to > today_local or p_to - p_from > 364
  then
    raise exception 'Choose a valid safety date range of up to 365 days.'
      using errcode = '22023';
  end if;

  range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';

  select jsonb_build_object(
    'date_range', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),
    'reports', jsonb_build_object(
      'total', (
        select count(*) from public.user_reports as report
        where report.created_at >= range_start and report.created_at < range_end
      ),
      'new', (
        select count(*) from public.user_reports as report
        where report.status = 'pending'
          and report.created_at >= range_start and report.created_at < range_end
      ),
      'awaiting_review', (
        select count(*) from public.user_reports as report
        where report.status = 'pending'
          and report.created_at >= range_start and report.created_at < range_end
      ),
      'under_investigation', (
        select count(*) from public.user_reports as report
        where report.status = 'in_review'
          and report.created_at >= range_start and report.created_at < range_end
      ),
      'escalated', (
        select count(*) from public.user_reports as report
        where report.escalated_at is not null
          and report.status not in ('resolved', 'dismissed')
          and report.created_at >= range_start and report.created_at < range_end
      ),
      'resolved', (
        select count(*) from public.user_reports as report
        where report.status in ('resolved', 'dismissed')
          and report.created_at >= range_start and report.created_at < range_end
      ),
      'urgent', (
        select count(*) from public.user_reports as report
        where report.priority = 'urgent'
          and report.status not in ('resolved', 'dismissed')
          and report.created_at >= range_start and report.created_at < range_end
      )
    ),
    'suspended_accounts', (
      select count(*)
      from auth.users as auth_user
      where auth_user.banned_until > now()
        and auth_user.deleted_at is null
        and not auth_user.is_anonymous
        and not exists (
          select 1 from public.staff_members as staff
          where staff.user_id = auth_user.id
        )
    ),
    'active_restrictions_supported', false,
    'category_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', categories.reason,
        'count', categories.report_count
      ) order by categories.reason)
      from (
        select reason, count(*) as report_count
        from public.user_reports
        where created_at >= range_start and created_at < range_end
        group by reason
      ) as categories
    ), '[]'::jsonb),
    'recent_actions', coalesce((
      select jsonb_agg(to_jsonb(action_row)
        order by action_row.created_at desc)
      from (
        select
          event.report_id,
          event.action,
          event.created_at,
          coalesce(staff.full_name, 'Staff member') as actor_name,
          coalesce(
            nullif(btrim(reported_profile.profile->'profile'->>'nickname'), ''),
            'VEYRA member'
          ) as reported_member_name
        from public.user_report_events as event
        join public.user_reports as report on report.id = event.report_id
        left join public.staff_members as staff
          on staff.id = event.actor_staff_member_id
        left join public.dating_profiles as reported_profile
          on reported_profile.user_id = report.reported_user_id
        where event.created_at >= range_start and event.created_at < range_end
          and event.action <> 'submitted'
          and event.actor_staff_member_id is not null
        order by event.created_at desc
        limit 10
      ) as action_row
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_staff_user_reports(
  p_content_type text default 'all',
  p_search text default null,
  p_reason text default 'all',
  p_status text default 'all',
  p_priority text default 'all',
  p_assignee_id uuid default null,
  p_unassigned_only boolean default false,
  p_from date default null,
  p_to date default null,
  p_sort_by text default 'newest',
  p_sort_direction text default 'desc',
  p_limit integer default 25,
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
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.view')
  then
    raise exception 'Moderation viewing permission is required.'
      using errcode = '42501';
  end if;

  if p_content_type not in ('all', 'member', 'message')
    or p_reason not in (
      'all', 'inappropriate', 'harassment', 'spam', 'fake_profile', 'other'
    )
    or p_status not in ('all', 'pending', 'in_review', 'resolved', 'dismissed')
    or p_priority not in ('all', 'low', 'normal', 'high', 'urgent')
    or p_search is not null and char_length(btrim(p_search)) > 100
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_sort_by not in ('newest', 'priority')
    or p_sort_direction not in ('asc', 'desc')
    or p_from is not null and p_to is not null and p_from > p_to
    or p_assignee_id is not null and p_unassigned_only
  then
    raise exception 'Choose valid report filters and pagination values.'
      using errcode = '22023';
  end if;

  if p_from is not null then
    range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if p_to is not null then
    range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';
  end if;

  with report_rows as materialized (
    select
      report.id,
      report.reporter_id,
      coalesce(
        nullif(btrim(reporter_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as reporter_name,
      report.reported_user_id,
      coalesce(
        nullif(btrim(reported_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as reported_member_name,
      report.reason,
      report.content_type,
      report.status,
      report.priority,
      report.created_at,
      report.reviewed_at,
      report.assigned_staff_member_id,
      assignee.full_name as assigned_staff_name,
      report.escalated_at
    from public.user_reports as report
    left join public.dating_profiles as reporter_profile
      on reporter_profile.user_id = report.reporter_id
    left join public.dating_profiles as reported_profile
      on reported_profile.user_id = report.reported_user_id
    left join public.staff_members as assignee
      on assignee.id = report.assigned_staff_member_id
    where (p_content_type = 'all' or report.content_type = p_content_type)
      and (p_reason = 'all' or report.reason = p_reason)
      and (p_status = 'all' or report.status = p_status)
      and (p_priority = 'all' or report.priority = p_priority)
      and (p_assignee_id is null
        or report.assigned_staff_member_id = p_assignee_id)
      and (not p_unassigned_only or report.assigned_staff_member_id is null)
      and (range_start is null or report.created_at >= range_start)
      and (range_end is null or report.created_at < range_end)
      and (
        nullif(btrim(p_search), '') is null
        or position(lower(btrim(p_search)) in report.id::text) > 0
        or position(lower(btrim(p_search)) in report.reporter_id::text) > 0
        or position(lower(btrim(p_search)) in report.reported_user_id::text) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(
          nullif(btrim(reporter_profile.profile->'profile'->>'nickname'), ''),
          ''
        ))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(
          nullif(btrim(reported_profile.profile->'profile'->>'nickname'), ''),
          ''
        ))) > 0
      )
  ),
  page_rows as (
    select *
    from report_rows
    order by
      case when p_sort_by = 'priority' and p_sort_direction = 'desc'
        then case priority
          when 'urgent' then 4 when 'high' then 3
          when 'normal' then 2 else 1 end end desc nulls last,
      case when p_sort_by = 'priority' and p_sort_direction = 'asc'
        then case priority
          when 'urgent' then 4 when 'high' then 3
          when 'normal' then 2 else 1 end end asc nulls last,
      case when p_sort_by = 'newest' and p_sort_direction = 'desc'
        then created_at end desc nulls last,
      case when p_sort_by = 'newest' and p_sort_direction = 'asc'
        then created_at end asc nulls last,
      id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from report_rows),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'reporter_id', page.reporter_id,
        'reporter_name', page.reporter_name,
        'reported_user_id', page.reported_user_id,
        'reported_member_name', page.reported_member_name,
        'reason', page.reason,
        'content_type', page.content_type,
        'status', page.status,
        'priority', page.priority,
        'created_at', page.created_at,
        'reviewed_at', page.reviewed_at,
        'assigned_staff_member_id', page.assigned_staff_member_id,
        'assigned_staff_name', page.assigned_staff_name,
        'escalated_at', page.escalated_at
      ))
      from page_rows as page
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_staff_user_report_detail(
  p_report_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  can_manage boolean := public.staff_has_permission('moderation.manage');
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.view')
  then
    raise exception 'Moderation viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_report_id is null then
    raise exception 'A valid report ID is required.'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'report', jsonb_build_object(
      'id', report.id,
      'reporter_id', report.reporter_id,
      'reporter_name', coalesce(
        nullif(btrim(reporter_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ),
      'reported_user_id', report.reported_user_id,
      'reported_member_name', coalesce(
        nullif(btrim(reported_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ),
      'reported_account_status', case
        when reported_auth.banned_until > now() then 'suspended'
        else 'active'
      end,
      'reported_banned_until', reported_auth.banned_until,
      'conversation_id', report.conversation_id,
      'reason', report.reason,
      'content_type', report.content_type,
      'status', report.status,
      'priority', report.priority,
      'created_at', report.created_at,
      'reviewed_at', report.reviewed_at,
      'resolution', report.resolution,
      'assigned_staff_member_id', report.assigned_staff_member_id,
      'assigned_staff_name', assignee.full_name,
      'escalated_at', report.escalated_at,
      'profile_evidence', case when can_manage then jsonb_build_object(
        'bio', reported_profile.profile->'profile'->>'bio',
        'photo_paths', coalesce((
          select jsonb_agg(photo.value order by photo.ordinality)
          from jsonb_array_elements_text(case
            when jsonb_typeof(reported_profile.profile->'profile'->'photos')
                = 'array'
              then reported_profile.profile->'profile'->'photos'
            else '[]'::jsonb
          end) with ordinality as photo(value, ordinality)
          where photo.value like report.reported_user_id::text || '/%'
            and position('..' in photo.value) = 0
            and position('://' in photo.value) = 0
        ), '[]'::jsonb)
      ) else null end,
      'reported_message', case
        when can_manage and report.content_type = 'message' then (
          select jsonb_build_object(
            'id', message.id,
            'sender_id', message.sender_id,
            'body', message.body,
            'created_at', message.created_at
          )
          from public.messages as message
          where message.id = report.message_id
            and message.sender_id = report.reported_user_id
        )
        else null
      end
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'action', event.action,
        'old_status', event.old_status,
        'new_status', event.new_status,
        'old_priority', event.old_priority,
        'new_priority', event.new_priority,
        'old_assigned_staff_member_id',
          event.old_assigned_staff_member_id,
        'new_assigned_staff_member_id',
          event.new_assigned_staff_member_id,
        'details', case when can_manage then event.details else '{}'::jsonb end,
        'actor_name', coalesce(actor.full_name, 'Member'),
        'created_at', event.created_at
      ) order by event.created_at desc)
      from public.user_report_events as event
      left join public.staff_members as actor
        on actor.id = event.actor_staff_member_id
      where event.report_id = report.id
    ), '[]'::jsonb),
    'internal_notes', case when can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'note', note.note,
        'author_name', staff.full_name,
        'created_at', note.created_at
      ) order by note.created_at desc)
      from public.user_report_internal_notes as note
      join public.staff_members as staff
        on staff.id = note.actor_staff_member_id
      where note.report_id = report.id
    ), '[]'::jsonb) else null end
  )
  into result
  from public.user_reports as report
  left join public.dating_profiles as reporter_profile
    on reporter_profile.user_id = report.reporter_id
  left join public.dating_profiles as reported_profile
    on reported_profile.user_id = report.reported_user_id
  left join auth.users as reported_auth
    on reported_auth.id = report.reported_user_id
  left join public.staff_members as assignee
    on assignee.id = report.assigned_staff_member_id
  where report.id = p_report_id;

  if result is null then
    raise exception 'User report not found.'
      using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.get_staff_blocked_users(
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 25,
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
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.view')
  then
    raise exception 'Moderation viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_search is not null and char_length(btrim(p_search)) > 100
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_from is not null and p_to is not null and p_from > p_to
  then
    raise exception 'Choose valid block filters and pagination values.'
      using errcode = '22023';
  end if;
  if p_from is not null then
    range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if p_to is not null then
    range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';
  end if;

  with block_rows as materialized (
    select
      blocked.id,
      blocked.blocker_id,
      coalesce(
        nullif(btrim(blocker_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as blocker_name,
      blocked.blocked_id,
      coalesce(
        nullif(btrim(blocked_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as blocked_name,
      blocked.created_at
    from public.blocked_users as blocked
    left join public.dating_profiles as blocker_profile
      on blocker_profile.user_id::text = blocked.blocker_id
    left join public.dating_profiles as blocked_profile
      on blocked_profile.user_id::text = blocked.blocked_id
    where (range_start is null or blocked.created_at >= range_start)
      and (range_end is null or blocked.created_at < range_end)
      and (
        nullif(btrim(p_search), '') is null
        or position(lower(btrim(p_search)) in lower(blocked.blocker_id)) > 0
        or position(lower(btrim(p_search)) in lower(blocked.blocked_id)) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(
          nullif(btrim(blocker_profile.profile->'profile'->>'nickname'), ''),
          ''
        ))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(
          nullif(btrim(blocked_profile.profile->'profile'->>'nickname'), ''),
          ''
        ))) > 0
      )
  ),
  page_rows as (
    select *
    from block_rows
    order by created_at desc, id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from block_rows),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'blocker_id', page.blocker_id,
        'blocker_name', page.blocker_name,
        'blocked_id', page.blocked_id,
        'blocked_name', page.blocked_name,
        'created_at', page.created_at
      ))
      from page_rows as page
    ), '[]'::jsonb)
  )
  into result;
  return result;
end;
$$;

create or replace function public.update_user_report(
  p_report_id uuid,
  p_status text default null,
  p_priority text default null,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_member_id uuid;
  report_target_user_id uuid;
  previous_resolution text;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.manage')
  then
    raise exception 'Moderation management permission is required.'
      using errcode = '42501';
  end if;
  if p_report_id is null
    or p_status is null and p_priority is null and p_resolution is null
    or p_status is not null
      and p_status not in ('pending', 'in_review', 'resolved', 'dismissed')
    or p_priority is not null
      and p_priority not in ('low', 'normal', 'high', 'urgent')
    or p_resolution is not null
      and char_length(btrim(p_resolution)) > 2000
    or p_status in ('resolved', 'dismissed')
      and nullif(btrim(p_resolution), '') is null
  then
    raise exception 'Choose valid report updates and provide a resolution for final decisions.'
      using errcode = '22023';
  end if;

  select report.reported_user_id, report.resolution
  into report_target_user_id, previous_resolution
  from public.user_reports as report
  where report.id = p_report_id
  for update;
  if not found then
    raise exception 'User report not found.'
      using errcode = 'P0002';
  end if;
  select member.id
  into actor_staff_member_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if actor_staff_member_id is null then
    raise exception 'Active staff membership is required.'
      using errcode = '42501';
  end if;

  update public.user_reports as report
  set status = coalesce(p_status, report.status),
      priority = coalesce(p_priority, report.priority),
      reviewed_by = case
        when p_status is null or p_status = report.status
          then report.reviewed_by
        when p_status in ('resolved', 'dismissed') then current_user_id
        else null
      end,
      reviewed_at = case
        when p_status is null or p_status = report.status
          then report.reviewed_at
        when p_status in ('resolved', 'dismissed') then now()
        else null
      end,
      resolution = case
        when p_resolution is not null then btrim(p_resolution)
        when p_status in ('pending', 'in_review') then null
        else report.resolution
      end
  where report.id = p_report_id;

  if p_resolution is not null
    and previous_resolution is distinct from btrim(p_resolution) then
    insert into public.user_report_events (
      report_id, actor_user_id, actor_staff_member_id,
      action, details
    )
    values (
      p_report_id, current_user_id, actor_staff_member_id,
      'resolution_recorded',
      jsonb_build_object('resolution', btrim(p_resolution))
    );
  end if;

  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_member_id, current_user_id, report_target_user_id,
    'report.updated',
    jsonb_strip_nulls(jsonb_build_object(
      'report_id', p_report_id,
      'status', p_status,
      'priority', p_priority,
      'resolution_recorded', p_resolution is not null
    ))
  );
end;
$$;

create or replace function public.assign_staff_user_report(
  p_report_id uuid,
  p_assignee_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_member_id uuid;
  report_target_user_id uuid;
  previous_assignee_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.manage')
  then
    raise exception 'Moderation management permission is required.'
      using errcode = '42501';
  end if;
  if p_report_id is null then
    raise exception 'A valid report ID is required.'
      using errcode = '22023';
  end if;
  if p_assignee_id is not null and not exists (
    select 1
    from public.staff_members as assignee
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = assignee.id
      and assignment.revoked_at is null
    join public.staff_role_permissions as role_permission
      on role_permission.role_code = assignment.role_code
      and role_permission.permission_code = 'moderation.manage'
    where assignee.id = p_assignee_id
      and assignee.status = 'active'
  ) then
    raise exception 'The assigned staff member is not an active moderator.'
      using errcode = '22023';
  end if;

  select report.reported_user_id, report.assigned_staff_member_id
  into report_target_user_id, previous_assignee_id
  from public.user_reports as report
  where report.id = p_report_id
  for update;
  if not found then
    raise exception 'User report not found.'
      using errcode = 'P0002';
  end if;
  select member.id
  into actor_staff_member_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if actor_staff_member_id is null then
    raise exception 'Active staff membership is required.'
      using errcode = '42501';
  end if;

  update public.user_reports
  set assigned_staff_member_id = p_assignee_id
  where id = p_report_id;

  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_member_id, current_user_id, report_target_user_id,
    'report.assigned',
    jsonb_build_object(
      'report_id', p_report_id,
      'previous_assignee_id', previous_assignee_id,
      'new_assignee_id', p_assignee_id
    )
  );
end;
$$;

create or replace function public.escalate_staff_user_report(
  p_report_id uuid,
  p_reason text,
  p_senior_assignee_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_member_id uuid;
  report_target_user_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.manage')
  then
    raise exception 'Moderation management permission is required.'
      using errcode = '42501';
  end if;
  if p_report_id is null
    or p_reason is null
    or char_length(btrim(p_reason)) not between 5 and 2000
    or p_senior_assignee_id is null
  then
    raise exception 'Provide an escalation reason and senior staff assignee.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.staff_members as assignee
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = assignee.id
      and assignment.revoked_at is null
    where assignee.id = p_senior_assignee_id
      and assignee.status = 'active'
      and assignment.role_code in ('super_admin', 'administrator')
  ) then
    raise exception 'Escalations must be assigned to an active administrator.'
      using errcode = '22023';
  end if;

  select report.reported_user_id
  into report_target_user_id
  from public.user_reports as report
  where report.id = p_report_id
    and report.status not in ('resolved', 'dismissed')
  for update;
  if not found then
    raise exception 'An open user report is required for escalation.'
      using errcode = 'P0002';
  end if;
  select member.id
  into actor_staff_member_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if actor_staff_member_id is null then
    raise exception 'Active staff membership is required.'
      using errcode = '42501';
  end if;

  update public.user_reports
  set assigned_staff_member_id = p_senior_assignee_id,
      escalated_at = now(),
      escalated_by = current_user_id,
      priority = 'urgent',
      status = case when status = 'pending' then 'in_review' else status end
  where id = p_report_id;

  insert into public.user_report_events (
    report_id, actor_user_id, actor_staff_member_id, action, details
  )
  values (
    p_report_id, current_user_id, actor_staff_member_id, 'escalated',
    jsonb_build_object(
      'reason', btrim(p_reason),
      'assigned_to', p_senior_assignee_id
    )
  );
  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_member_id, current_user_id, report_target_user_id,
    'report.escalated',
    jsonb_build_object(
      'report_id', p_report_id,
      'reason', btrim(p_reason),
      'assigned_to', p_senior_assignee_id
    )
  );
end;
$$;

create or replace function public.add_staff_user_report_note(
  p_report_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_member_id uuid;
  report_target_user_id uuid;
  note_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.manage')
  then
    raise exception 'Moderation management permission is required.'
      using errcode = '42501';
  end if;
  if p_report_id is null
    or p_note is null
    or char_length(btrim(p_note)) not between 1 and 4000
  then
    raise exception 'Enter an internal note of 1–4000 characters.'
      using errcode = '22023';
  end if;

  select report.reported_user_id
  into report_target_user_id
  from public.user_reports as report
  where report.id = p_report_id;
  if not found then
    raise exception 'User report not found.'
      using errcode = 'P0002';
  end if;
  select member.id
  into actor_staff_member_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if actor_staff_member_id is null then
    raise exception 'Active staff membership is required.'
      using errcode = '42501';
  end if;

  insert into public.user_report_internal_notes (
    report_id, actor_user_id, actor_staff_member_id, note
  )
  values (
    p_report_id, current_user_id, actor_staff_member_id, btrim(p_note)
  )
  returning id into note_id;

  insert into public.user_report_events (
    report_id, actor_user_id, actor_staff_member_id, action, details
  )
  values (
    p_report_id, current_user_id, actor_staff_member_id, 'note_added',
    jsonb_build_object('note_id', note_id)
  );
  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_member_id, current_user_id, report_target_user_id,
    'report.internal_note_added',
    jsonb_build_object('report_id', p_report_id, 'note_id', note_id)
  );
  return note_id;
end;
$$;

revoke all on function public.get_staff_moderation_assignees()
  from public, anon;
revoke all on function public.get_staff_safety_overview(date, date)
  from public, anon;
revoke all on function public.get_staff_user_reports(
  text, text, text, text, text, uuid, boolean, date, date, text, text,
  integer, integer
) from public, anon;
revoke all on function public.get_staff_user_report_detail(uuid)
  from public, anon;
revoke all on function public.get_staff_blocked_users(
  text, date, date, integer, integer
) from public, anon;
revoke all on function public.update_user_report(uuid, text, text, text)
  from public, anon;
revoke all on function public.assign_staff_user_report(uuid, uuid)
  from public, anon;
revoke all on function public.escalate_staff_user_report(uuid, text, uuid)
  from public, anon;
revoke all on function public.add_staff_user_report_note(uuid, text)
  from public, anon;

grant execute on function public.get_staff_moderation_assignees()
  to authenticated;
grant execute on function public.get_staff_safety_overview(date, date)
  to authenticated;
grant execute on function public.get_staff_user_reports(
  text, text, text, text, text, uuid, boolean, date, date, text, text,
  integer, integer
) to authenticated;
grant execute on function public.get_staff_user_report_detail(uuid)
  to authenticated;
grant execute on function public.get_staff_blocked_users(
  text, date, date, integer, integer
) to authenticated;
grant execute on function public.update_user_report(uuid, text, text, text)
  to authenticated;
grant execute on function public.assign_staff_user_report(uuid, uuid)
  to authenticated;
grant execute on function public.escalate_staff_user_report(uuid, text, uuid)
  to authenticated;
grant execute on function public.add_staff_user_report_note(uuid, text)
  to authenticated;
