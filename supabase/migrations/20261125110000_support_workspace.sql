alter table public.support_tickets
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by uuid
    references auth.users (id) on delete set null;

alter table public.support_ticket_events
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.support_ticket_events
  drop constraint if exists support_ticket_events_action_check;
alter table public.support_ticket_events
  add constraint support_ticket_events_action_check
  check (action in (
    'created',
    'status_changed',
    'priority_changed',
    'assigned',
    'reply_sent',
    'member_reply',
    'internal_note',
    'escalated'
  ));
alter table public.support_ticket_events
  drop constraint if exists support_ticket_events_details_check;
alter table public.support_ticket_events
  add constraint support_ticket_events_details_check
  check (jsonb_typeof(details) = 'object');

alter table public.support_ticket_messages
  add column if not exists sender_kind text not null default 'staff';
alter table public.support_ticket_messages
  alter column sender_staff_member_id drop not null;
alter table public.support_ticket_messages
  drop constraint if exists support_ticket_messages_sender_kind_check;
alter table public.support_ticket_messages
  add constraint support_ticket_messages_sender_kind_check
  check (
    (sender_kind = 'staff' and sender_staff_member_id is not null)
    or (sender_kind = 'member' and sender_staff_member_id is null)
  );

create index if not exists support_tickets_escalated_updated_idx
  on public.support_tickets (escalated_at desc, updated_at desc)
  where escalated_at is not null;
create index if not exists support_tickets_assignee_status_updated_idx
  on public.support_tickets (assigned_staff_member_id, status, updated_at desc);

create table if not exists public.support_ticket_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id)
    on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  actor_staff_member_id uuid not null references public.staff_members (id)
    on delete restrict,
  note text not null check (char_length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_internal_notes_ticket_created_idx
  on public.support_ticket_internal_notes (ticket_id, created_at desc);

alter table public.support_ticket_internal_notes enable row level security;
revoke all on public.support_ticket_internal_notes from public, anon, authenticated;
grant all on public.support_ticket_internal_notes to service_role;

create or replace function public.log_support_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_user_id uuid;
begin
  insert into public.support_ticket_events (
    ticket_id, actor_user_id, actor_staff_member_id, action
  )
  values (
    new.ticket_id,
    new.sender_user_id,
    new.sender_staff_member_id,
    case when new.sender_kind = 'member' then 'member_reply' else 'reply_sent' end
  );

  if new.sender_kind = 'staff' then
    select ticket.user_id
    into ticket_user_id
    from public.support_tickets as ticket
    where ticket.id = new.ticket_id;

    insert into public.member_notifications (user_id, created_by, title, body)
    values (
      ticket_user_id,
      new.sender_user_id,
      'Support updated your request',
      'A support agent replied to your request. Sign in to view the response.'
    );
    insert into public.staff_audit_logs (
      actor_staff_member_id, actor_user_id, target_user_id, action, details
    )
    values (
      new.sender_staff_member_id,
      new.sender_user_id,
      ticket_user_id,
      'support.ticket.reply_sent',
      jsonb_build_object('ticket_id', new.ticket_id, 'message_id', new.id)
    );
  end if;
  return new;
end;
$$;

create or replace function public.notify_support_ticket_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_notifications (user_id, title, body)
  values (
    new.user_id,
    'Support request received',
    'Your request was received. Sign in to view its status.'
  );
  return new;
end;
$$;

drop trigger if exists support_ticket_member_notification
  on public.support_tickets;
create trigger support_ticket_member_notification
  after insert on public.support_tickets
  for each row execute function public.notify_support_ticket_submitted();

revoke all on function public.log_support_ticket_reply()
  from public, anon, authenticated;
revoke all on function public.notify_support_ticket_submitted()
  from public, anon, authenticated;

create or replace function public.get_support_workspace_agents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_staff_id uuid;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.view')
  then
    raise exception 'Support viewing permission is required.'
      using errcode = '42501';
  end if;

  select member.id
  into current_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', member.id,
    'name', member.full_name,
    'roles', role_list.roles,
    'is_senior', role_list.is_senior,
    'workload', (
      select count(*)
      from public.support_tickets as ticket
      where ticket.assigned_staff_member_id = member.id
        and ticket.status in ('open', 'pending')
    )
  ) order by member.full_name), '[]'::jsonb)
  into result
  from public.staff_members as member
  cross join lateral (
    select
      array_agg(distinct assignment.role_code order by assignment.role_code) as roles,
      bool_or(assignment.role_code in ('super_admin', 'administrator')) as is_senior
    from public.staff_role_assignments as assignment
    join public.staff_role_permissions as permission
      on permission.role_code = assignment.role_code
      and permission.permission_code = 'support.manage'
    where assignment.staff_member_id = member.id
      and assignment.revoked_at is null
  ) as role_list
  where member.status = 'active'
    and role_list.roles is not null;

  return jsonb_build_object(
    'current_staff_member_id', current_staff_id,
    'agents', result
  );
end;
$$;

create or replace function public.get_support_workspace_dashboard(
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
    or not public.staff_has_permission('support.view')
  then
    raise exception 'Support viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to
    or p_to > today_local or p_to - p_from > 364
  then
    raise exception 'Choose a valid support date range of up to 365 days.'
      using errcode = '22023';
  end if;

  range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';

  select jsonb_build_object(
    'generated_at', now(),
    'date_range', jsonb_build_object('from', p_from, 'to', p_to),
    'tickets', jsonb_build_object(
      'total', (
        select count(*) from public.support_tickets as ticket
        where ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'open', (
        select count(*) from public.support_tickets as ticket
        where ticket.status = 'open'
          and ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'pending', (
        select count(*) from public.support_tickets as ticket
        where ticket.status = 'pending'
          and ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'resolved', (
        select count(*) from public.support_tickets as ticket
        where ticket.status = 'resolved'
          and ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'closed', (
        select count(*) from public.support_tickets as ticket
        where ticket.status = 'closed'
          and ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'escalated', (
        select count(*) from public.support_tickets as ticket
        where ticket.escalated_at is not null
          and ticket.status in ('open', 'pending')
          and ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'received_today', (
        select count(*) from public.support_tickets as ticket
        where ticket.created_at >=
          (today_local::timestamp at time zone 'Africa/Johannesburg')
          and ticket.created_at <
          ((today_local + 1)::timestamp at time zone 'Africa/Johannesburg')
      ),
      'urgent_open', (
        select count(*) from public.support_tickets as ticket
        where ticket.priority = 'urgent'
          and ticket.status in ('open', 'pending')
          and ticket.created_at >= range_start and ticket.created_at < range_end
      ),
      'overdue', null
    ),
    'average_first_response_minutes', (
      select round(avg(extract(epoch from (first_response.created_at - ticket.created_at)) / 60)::numeric, 1)
      from public.support_tickets as ticket
      join lateral (
        select message.created_at
        from public.support_ticket_messages as message
        where message.ticket_id = ticket.id
          and message.sender_kind = 'staff'
        order by message.created_at
        limit 1
      ) as first_response on true
      where ticket.created_at >= range_start and ticket.created_at < range_end
    ),
    'average_resolution_minutes', (
      select round(avg(extract(epoch from (resolved_event.created_at - ticket.created_at)) / 60)::numeric, 1)
      from public.support_tickets as ticket
      join lateral (
        select min(event.created_at) as created_at
        from public.support_ticket_events as event
        where event.ticket_id = ticket.id
          and event.action = 'status_changed'
          and event.new_status = 'resolved'
      ) as resolved_event on resolved_event.created_at is not null
      where ticket.created_at >= range_start and ticket.created_at < range_end
    ),
    'category_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', grouped.category,
        'count', grouped.ticket_count
      ) order by grouped.category)
      from (
        select category, count(*) as ticket_count
        from public.support_tickets
        where created_at >= range_start and created_at < range_end
        group by category
      ) as grouped
    ), '[]'::jsonb),
    'priority_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priority', grouped.priority,
        'count', grouped.ticket_count
      ) order by case grouped.priority
        when 'urgent' then 4 when 'high' then 3
        when 'normal' then 2 else 1 end desc)
      from (
        select priority, count(*) as ticket_count
        from public.support_tickets
        where created_at >= range_start and created_at < range_end
        group by priority
      ) as grouped
    ), '[]'::jsonb),
    'agent_workload', coalesce((
      select jsonb_agg(to_jsonb(workload_row)
        order by workload_row.open_count desc, workload_row.agent_name)
      from (
        select
          member.id as agent_id,
          member.full_name as agent_name,
          count(ticket.id) as open_count
        from public.staff_members as member
        left join public.support_tickets as ticket
          on ticket.assigned_staff_member_id = member.id
          and ticket.status in ('open', 'pending')
        where member.status = 'active'
          and exists (
            select 1
            from public.staff_role_assignments as assignment
            join public.staff_role_permissions as role_permission
              on role_permission.role_code = assignment.role_code
              and role_permission.permission_code = 'support.manage'
            where assignment.staff_member_id = member.id
              and assignment.revoked_at is null
          )
        group by member.id, member.full_name
      ) as workload_row
    ), '[]'::jsonb)
  )
  into result;
  return result;
end;
$$;

create or replace function public.get_support_ticket_queue(
  p_view text default 'all',
  p_status text default 'all',
  p_category text default 'all',
  p_priority text default 'all',
  p_assignee_id uuid default null,
  p_unassigned_only boolean default false,
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_sort_by text default 'updated',
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
  current_staff_id uuid;
  today_local date := (now() at time zone 'Africa/Johannesburg')::date;
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.view')
  then
    raise exception 'Support viewing permission is required.'
      using errcode = '42501';
  end if;
  select member.id into current_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id and member.status = 'active';

  if p_view is null
    or p_status is null
    or p_category is null
    or p_priority is null
    or p_sort_by is null
    or p_sort_direction is null
    or p_view not in (
      'all', 'unassigned', 'mine', 'escalated',
      'open', 'pending', 'resolved', 'closed'
    )
    or p_status not in ('all', 'open', 'pending', 'resolved', 'closed')
    or p_category not in ('all', 'account', 'technical', 'safety', 'verification', 'other')
    or p_priority not in ('all', 'low', 'normal', 'high', 'urgent')
    or p_search is not null and char_length(btrim(p_search)) > 120
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_sort_by not in ('newest', 'oldest', 'priority', 'updated')
    or p_sort_direction not in ('asc', 'desc')
    or p_from is not null and p_to is not null and p_from > p_to
    or p_to > today_local
  then
    raise exception 'Choose valid ticket filters and pagination values.'
      using errcode = '22023';
  end if;
  if p_view = 'mine' and current_staff_id is null then
    raise exception 'An active staff membership is required for My Tickets.'
      using errcode = '42501';
  end if;
  if p_from is not null then
    range_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  end if;
  if p_to is not null then
    range_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';
  end if;

  with filtered as materialized (
    select
      ticket.id,
      ticket.user_id,
      coalesce(
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as member_name,
      auth_user.email,
      ticket.category,
      ticket.subject,
      ticket.status,
      ticket.priority,
      ticket.assigned_staff_member_id,
      assignee.full_name as assigned_staff_name,
      ticket.escalated_at,
      ticket.created_at,
      ticket.updated_at,
      coalesce((
        select max(message.created_at)
        from public.support_ticket_messages as message
        where message.ticket_id = ticket.id
      ), ticket.created_at) as last_response_at,
      (
        select count(*) from public.support_ticket_messages as message
        where message.ticket_id = ticket.id
      ) as reply_count
    from public.support_tickets as ticket
    join auth.users as auth_user on auth_user.id = ticket.user_id
    left join public.dating_profiles as profile on profile.user_id = ticket.user_id
    left join public.staff_members as assignee
      on assignee.id = ticket.assigned_staff_member_id
    where (p_status = 'all' or ticket.status = p_status)
      and (p_category = 'all' or ticket.category = p_category)
      and (p_priority = 'all' or ticket.priority = p_priority)
      and (
        p_view not in ('open', 'pending', 'resolved', 'closed')
        or ticket.status = p_view
      )
      and (p_view <> 'unassigned' or ticket.assigned_staff_member_id is null)
      and (p_view <> 'mine' or ticket.assigned_staff_member_id = current_staff_id)
      and (
        p_view <> 'escalated'
        or (
          ticket.escalated_at is not null
          and ticket.status in ('open', 'pending')
        )
      )
      and (p_assignee_id is null or ticket.assigned_staff_member_id = p_assignee_id)
      and (not p_unassigned_only or ticket.assigned_staff_member_id is null)
      and (range_start is null or ticket.created_at >= range_start)
      and (range_end is null or ticket.created_at < range_end)
      and (
        nullif(btrim(p_search), '') is null
        or position(lower(btrim(p_search)) in ticket.id::text) > 0
        or position(lower(btrim(p_search)) in lower(ticket.subject)) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(auth_user.email, ''))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(
          nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
          ''
        ))) > 0
      )
  ),
  page_rows as (
    select * from filtered
    order by
      case when p_sort_by = 'priority' and p_sort_direction = 'desc'
        then case priority when 'urgent' then 4 when 'high' then 3
          when 'normal' then 2 else 1 end end desc nulls last,
      case when p_sort_by = 'priority' and p_sort_direction = 'asc'
        then case priority when 'urgent' then 4 when 'high' then 3
          when 'normal' then 2 else 1 end end asc nulls last,
      case when p_sort_by = 'newest' and p_sort_direction = 'desc'
        then created_at end desc nulls last,
      case when p_sort_by = 'newest' and p_sort_direction = 'asc'
        then created_at end asc nulls last,
      case when p_sort_by = 'oldest' and p_sort_direction = 'asc'
        then created_at end asc nulls last,
      case when p_sort_by = 'oldest' and p_sort_direction = 'desc'
        then created_at end desc nulls last,
      case when p_sort_by = 'updated' and p_sort_direction = 'desc'
        then updated_at end desc nulls last,
      case when p_sort_by = 'updated' and p_sort_direction = 'asc'
        then updated_at end asc nulls last,
      id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'member_id', page.user_id,
        'member_name', page.member_name,
        'email', page.email,
        'category', page.category,
        'subject', page.subject,
        'status', page.status,
        'priority', page.priority,
        'assigned_staff_member_id', page.assigned_staff_member_id,
        'assigned_staff_name', page.assigned_staff_name,
        'escalated_at', page.escalated_at,
        'created_at', page.created_at,
        'updated_at', page.updated_at,
        'last_response_at', page.last_response_at,
        'reply_count', page.reply_count
      )
      order by
        case when p_sort_by = 'priority' and p_sort_direction = 'desc'
          then case page.priority when 'urgent' then 4 when 'high' then 3
            when 'normal' then 2 else 1 end end desc nulls last,
        case when p_sort_by = 'priority' and p_sort_direction = 'asc'
          then case page.priority when 'urgent' then 4 when 'high' then 3
            when 'normal' then 2 else 1 end end asc nulls last,
        case when p_sort_by = 'newest' and p_sort_direction = 'desc'
          then page.created_at end desc nulls last,
        case when p_sort_by = 'newest' and p_sort_direction = 'asc'
          then page.created_at end asc nulls last,
        case when p_sort_by = 'oldest' and p_sort_direction = 'asc'
          then page.created_at end asc nulls last,
        case when p_sort_by = 'oldest' and p_sort_direction = 'desc'
          then page.created_at end desc nulls last,
        case when p_sort_by = 'updated' and p_sort_direction = 'desc'
          then page.updated_at end desc nulls last,
        case when p_sort_by = 'updated' and p_sort_direction = 'asc'
          then page.updated_at end asc nulls last,
        page.id
      )
      from page_rows as page
    ), '[]'::jsonb)
  )
  into result;
  return result;
end;
$$;

create or replace function public.get_support_ticket_workspace_detail(
  p_ticket_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  can_manage boolean := public.staff_has_permission('support.manage');
  current_staff_id uuid;
  ticket_record public.support_tickets%rowtype;
  result jsonb;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.view')
  then
    raise exception 'Support viewing permission is required.'
      using errcode = '42501';
  end if;
  select ticket.* into ticket_record
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
  for update;
  if not found then
    raise exception 'Support ticket not found.'
      using errcode = 'P0002';
  end if;

  if can_manage and ticket_record.assigned_staff_member_id is null
    and ticket_record.status in ('open', 'pending')
  then
    select member.id
    into current_staff_id
    from public.staff_members as member
    where member.user_id = current_user_id
      and member.status = 'active';

    if current_staff_id is not null then
      update public.support_tickets as ticket
      set assigned_staff_member_id = current_staff_id,
          updated_at = now()
      where ticket.id = p_ticket_id
        and ticket.assigned_staff_member_id is null
      returning ticket.* into ticket_record;

      if found then
        insert into public.support_ticket_events (
          ticket_id, actor_user_id, actor_staff_member_id, action,
          old_assigned_staff_member_id, new_assigned_staff_member_id
        )
        values (
          p_ticket_id, current_user_id, current_staff_id, 'assigned',
          null, current_staff_id
        );
        insert into public.staff_audit_logs (
          actor_staff_member_id, actor_user_id, target_user_id, action, details
        )
        values (
          current_staff_id,
          current_user_id,
          ticket_record.user_id,
          'support.ticket.auto_assigned',
          jsonb_build_object(
            'ticket_id', p_ticket_id,
            'new_assignee_id', current_staff_id
          )
        );
      end if;
    end if;
  end if;

  select jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', ticket_record.id,
      'member_id', ticket_record.user_id,
      'member_name', coalesce(
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ),
      'email', auth_user.email,
      'category', ticket_record.category,
      'subject', ticket_record.subject,
      'message', ticket_record.message,
      'status', ticket_record.status,
      'priority', ticket_record.priority,
      'assigned_staff_member_id', ticket_record.assigned_staff_member_id,
      'assigned_staff_name', assignee.full_name,
      'escalated_at', ticket_record.escalated_at,
      'created_at', ticket_record.created_at,
      'updated_at', ticket_record.updated_at,
      'last_response_at', coalesce((
        select max(message.created_at)
        from public.support_ticket_messages as message
        where message.ticket_id = ticket_record.id
      ), ticket_record.created_at),
      'reply_count', (
        select count(*)
        from public.support_ticket_messages as message
        where message.ticket_id = ticket_record.id
      )
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'body', message.body,
        'sender', message.sender_kind,
        'sender_name', case
          when message.sender_kind = 'member' then 'Member'
          else coalesce(sender_staff.full_name, 'VEYRA Support')
        end,
        'created_at', message.created_at
      ) order by message.created_at, message.id)
      from public.support_ticket_messages as message
      left join public.staff_members as sender_staff
        on sender_staff.id = message.sender_staff_member_id
      where message.ticket_id = ticket_record.id
    ), '[]'::jsonb),
    'internal_notes', case when can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'note', note.note,
        'author_name', staff.full_name,
        'created_at', note.created_at
      ) order by note.created_at desc)
      from public.support_ticket_internal_notes as note
      join public.staff_members as staff
        on staff.id = note.actor_staff_member_id
      where note.ticket_id = ticket_record.id
    ), '[]'::jsonb) else null end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'action', event.action,
        'old_status', event.old_status,
        'new_status', event.new_status,
        'old_priority', event.old_priority,
        'new_priority', event.new_priority,
        'old_assigned_staff_member_id', event.old_assigned_staff_member_id,
        'new_assigned_staff_member_id', event.new_assigned_staff_member_id,
        'details', case when can_manage then event.details else '{}'::jsonb end,
        'actor_name', coalesce(actor.full_name, 'Member'),
        'created_at', event.created_at
      ) order by event.created_at desc)
      from public.support_ticket_events as event
      left join public.staff_members as actor
        on actor.id = event.actor_staff_member_id
      where event.ticket_id = ticket_record.id
    ), '[]'::jsonb)
  )
  into result
  from auth.users as auth_user
  left join public.dating_profiles as profile
    on profile.user_id = ticket_record.user_id
  left join public.staff_members as assignee
    on assignee.id = ticket_record.assigned_staff_member_id
  where auth_user.id = ticket_record.user_id;
  return result;
end;
$$;

create or replace function public.update_support_ticket(
  p_ticket_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assigned_staff_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  ticket_user_id uuid;
  actor_staff_id uuid;
  previous_status text;
  previous_priority text;
  previous_assignee_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.manage')
    or not exists (
      select 1
      from public.staff_members as member
      join public.staff_role_assignments as assignment
        on assignment.staff_member_id = member.id
        and assignment.role_code = 'super_admin'
        and assignment.revoked_at is null
      where member.user_id = current_user_id
        and member.status = 'active'
    )
  then
    raise exception 'An active Super Admin role is required to change ticket controls.'
      using errcode = '42501';
  end if;
  if p_status is null and p_priority is null
    and p_assigned_staff_member_id is null
    or p_status is not null
      and p_status not in ('open', 'pending', 'resolved', 'closed')
    or p_priority is not null
      and p_priority not in ('low', 'normal', 'high', 'urgent')
  then
    raise exception 'Choose valid support ticket updates.'
      using errcode = '22023';
  end if;

  select member.id into actor_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id and member.status = 'active';
  if actor_staff_id is null then
    raise exception 'An active support staff membership is required.'
      using errcode = '42501';
  end if;
  if p_assigned_staff_member_id is not null and not exists (
    select 1
    from public.staff_members as member
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = member.id
      and assignment.revoked_at is null
    join public.staff_role_permissions as permission
      on permission.role_code = assignment.role_code
      and permission.permission_code = 'support.manage'
    where member.id = p_assigned_staff_member_id
      and member.status = 'active'
  ) then
    raise exception 'Choose an active support agent.'
      using errcode = '22023';
  end if;

  select
    ticket.user_id,
    ticket.status,
    ticket.priority,
    ticket.assigned_staff_member_id
  into
    ticket_user_id,
    previous_status,
    previous_priority,
    previous_assignee_id
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
  for update;
  if not found then
    raise exception 'Support ticket not found.'
      using errcode = 'P0002';
  end if;

  update public.support_tickets as ticket
  set status = coalesce(p_status, ticket.status),
      priority = coalesce(p_priority, ticket.priority),
      assigned_staff_member_id = coalesce(
        p_assigned_staff_member_id, ticket.assigned_staff_member_id
      ),
      updated_at = now()
  where ticket.id = p_ticket_id;

  if p_status is not null and p_status is distinct from previous_status then
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      old_status, new_status
    )
    values (
      p_ticket_id, current_user_id, actor_staff_id, 'status_changed',
      previous_status, p_status
    );
    insert into public.member_notifications (user_id, created_by, title, body)
    values (
      ticket_user_id,
      current_user_id,
      'Support request status updated',
      'Your support request status changed to ' || replace(p_status, '_', ' ') || '.'
    );
  end if;
  if p_priority is not null and p_priority is distinct from previous_priority then
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      old_priority, new_priority
    )
    values (
      p_ticket_id, current_user_id, actor_staff_id, 'priority_changed',
      previous_priority, p_priority
    );
  end if;
  if p_assigned_staff_member_id is not null
    and p_assigned_staff_member_id is distinct from previous_assignee_id
  then
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      old_assigned_staff_member_id, new_assigned_staff_member_id
    )
    values (
      p_ticket_id, current_user_id, actor_staff_id, 'assigned',
      previous_assignee_id, p_assigned_staff_member_id
    );
  end if;

  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_id, current_user_id, ticket_user_id,
    'support.ticket.updated',
    jsonb_strip_nulls(jsonb_build_object(
      'ticket_id', p_ticket_id,
      'status', p_status,
      'priority', p_priority
    ))
  );
end;
$$;

create or replace function public.assign_support_ticket(
  p_ticket_id uuid,
  p_assignee_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_id uuid;
  ticket_user_id uuid;
  previous_assignee_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.manage')
    or not exists (
      select 1
      from public.staff_members as member
      join public.staff_role_assignments as assignment
        on assignment.staff_member_id = member.id
        and assignment.role_code = 'super_admin'
        and assignment.revoked_at is null
      where member.user_id = current_user_id
        and member.status = 'active'
    )
  then
    raise exception 'An active Super Admin role is required to change ticket controls.'
      using errcode = '42501';
  end if;
  if p_ticket_id is null then
    raise exception 'A valid ticket reference is required.'
      using errcode = '22023';
  end if;
  if p_assignee_id is not null and not exists (
    select 1
    from public.staff_members as member
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = member.id
      and assignment.revoked_at is null
    join public.staff_role_permissions as permission
      on permission.role_code = assignment.role_code
      and permission.permission_code = 'support.manage'
    where member.id = p_assignee_id
      and member.status = 'active'
  ) then
    raise exception 'Choose an active support agent.'
      using errcode = '22023';
  end if;
  select member.id into actor_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id and member.status = 'active';
  if actor_staff_id is null then
    raise exception 'An active support staff membership is required.'
      using errcode = '42501';
  end if;
  select ticket.user_id, ticket.assigned_staff_member_id
  into ticket_user_id, previous_assignee_id
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
  for update;
  if not found then
    raise exception 'Support ticket not found.'
      using errcode = 'P0002';
  end if;
  if previous_assignee_id is not distinct from p_assignee_id then
    return;
  end if;

  update public.support_tickets
  set assigned_staff_member_id = p_assignee_id,
      updated_at = now()
  where id = p_ticket_id;
  insert into public.support_ticket_events (
    ticket_id, actor_user_id, actor_staff_member_id, action,
    old_assigned_staff_member_id, new_assigned_staff_member_id
  )
  values (
    p_ticket_id, current_user_id, actor_staff_id, 'assigned',
    previous_assignee_id, p_assignee_id
  );
  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_id, current_user_id, ticket_user_id,
    'support.ticket.assigned',
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'previous_assignee_id', previous_assignee_id,
      'new_assignee_id', p_assignee_id
    )
  );
end;
$$;

create or replace function public.escalate_support_ticket(
  p_ticket_id uuid,
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
  actor_staff_id uuid;
  ticket_user_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.manage')
    or not exists (
      select 1
      from public.staff_members as member
      join public.staff_role_assignments as assignment
        on assignment.staff_member_id = member.id
        and assignment.role_code = 'super_admin'
        and assignment.revoked_at is null
      where member.user_id = current_user_id
        and member.status = 'active'
    )
  then
    raise exception 'An active Super Admin role is required to change ticket controls.'
      using errcode = '42501';
  end if;
  if p_ticket_id is null or p_reason is null
    or char_length(btrim(p_reason)) not between 5 and 2000
    or p_senior_assignee_id is null
  then
    raise exception 'Provide an escalation reason and senior support agent.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.staff_members as member
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = member.id
      and assignment.revoked_at is null
    join public.staff_role_permissions as permission
      on permission.role_code = assignment.role_code
      and permission.permission_code = 'support.manage'
    where member.id = p_senior_assignee_id
      and member.status = 'active'
      and assignment.role_code in ('super_admin', 'administrator')
  ) then
    raise exception 'Escalations must be assigned to an active administrator.'
      using errcode = '22023';
  end if;
  select member.id into actor_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id and member.status = 'active';
  if actor_staff_id is null then
    raise exception 'An active support staff membership is required.'
      using errcode = '42501';
  end if;
  select ticket.user_id into ticket_user_id
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
    and ticket.status in ('open', 'pending')
  for update;
  if not found then
    raise exception 'An open support ticket is required for escalation.'
      using errcode = 'P0002';
  end if;

  update public.support_tickets
  set assigned_staff_member_id = p_senior_assignee_id,
      escalated_at = now(),
      escalated_by = current_user_id,
      updated_at = now()
  where id = p_ticket_id;
  insert into public.support_ticket_events (
    ticket_id, actor_user_id, actor_staff_member_id, action, details
  )
  values (
    p_ticket_id, current_user_id, actor_staff_id, 'escalated',
    jsonb_build_object(
      'reason', btrim(p_reason),
      'assigned_to', p_senior_assignee_id
    )
  );
  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_id, current_user_id, ticket_user_id,
    'support.ticket.escalated',
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'reason', btrim(p_reason),
      'assigned_to', p_senior_assignee_id
    )
  );
end;
$$;

create or replace function public.add_support_ticket_internal_note(
  p_ticket_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_staff_id uuid;
  ticket_user_id uuid;
  note_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.manage')
  then
    raise exception 'Support management permission is required.'
      using errcode = '42501';
  end if;
  if p_ticket_id is null or p_note is null
    or char_length(btrim(p_note)) not between 1 and 4000
  then
    raise exception 'Enter an internal note of 1–4000 characters.'
      using errcode = '22023';
  end if;
  select member.id into actor_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id and member.status = 'active';
  if actor_staff_id is null then
    raise exception 'An active support staff membership is required.'
      using errcode = '42501';
  end if;
  select ticket.user_id into ticket_user_id
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id;
  if not found then
    raise exception 'Support ticket not found.'
      using errcode = 'P0002';
  end if;

  insert into public.support_ticket_internal_notes (
    ticket_id, actor_user_id, actor_staff_member_id, note
  )
  values (p_ticket_id, current_user_id, actor_staff_id, btrim(p_note))
  returning id into note_id;
  insert into public.support_ticket_events (
    ticket_id, actor_user_id, actor_staff_member_id, action, details
  )
  values (
    p_ticket_id, current_user_id, actor_staff_id, 'internal_note',
    jsonb_build_object('note_id', note_id)
  );
  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    actor_staff_id, current_user_id, ticket_user_id,
    'support.ticket.internal_note_added',
    jsonb_build_object('ticket_id', p_ticket_id, 'note_id', note_id)
  );
  return note_id;
end;
$$;

create or replace function public.send_my_support_ticket_reply(
  p_ticket_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  ticket_status text;
  new_message_id uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in to reply to this support request.'
      using errcode = '42501';
  end if;
  if p_message is null or char_length(btrim(p_message)) not between 1 and 4000
  then
    raise exception 'Reply must be between 1 and 4000 characters.'
      using errcode = '22023';
  end if;
  select ticket.status into ticket_status
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
    and ticket.user_id = current_user_id
  for update;
  if not found then
    raise exception 'Support request not found.'
      using errcode = '42501';
  end if;
  if ticket_status = 'closed' then
    raise exception 'Closed requests cannot receive replies.'
      using errcode = '22023';
  end if;

  insert into public.support_ticket_messages (
    ticket_id, sender_user_id, sender_staff_member_id, sender_kind, body
  )
  values (p_ticket_id, current_user_id, null, 'member', btrim(p_message))
  returning id into new_message_id;
  update public.support_tickets
  set status = case when ticket_status in ('pending', 'resolved')
      then 'open' else status end,
      updated_at = now()
  where id = p_ticket_id;
  return new_message_id;
end;
$$;

revoke all on function public.get_support_workspace_agents()
  from public, anon;
revoke all on function public.get_support_workspace_dashboard(date, date)
  from public, anon;
revoke all on function public.get_support_ticket_queue(
  text, text, text, text, uuid, boolean, date, date, text, text, text,
  integer, integer
) from public, anon;
revoke all on function public.get_support_ticket_workspace_detail(uuid)
  from public, anon;
revoke all on function public.update_support_ticket(uuid, text, text, uuid)
  from public, anon;
revoke all on function public.assign_support_ticket(uuid, uuid)
  from public, anon;
revoke all on function public.escalate_support_ticket(uuid, text, uuid)
  from public, anon;
revoke all on function public.add_support_ticket_internal_note(uuid, text)
  from public, anon;
revoke all on function public.send_my_support_ticket_reply(uuid, text)
  from public, anon;

grant execute on function public.get_support_workspace_agents()
  to authenticated;
grant execute on function public.get_support_workspace_dashboard(date, date)
  to authenticated;
grant execute on function public.get_support_ticket_queue(
  text, text, text, text, uuid, boolean, date, date, text, text, text,
  integer, integer
) to authenticated;
grant execute on function public.get_support_ticket_workspace_detail(uuid)
  to authenticated;
grant execute on function public.update_support_ticket(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.assign_support_ticket(uuid, uuid)
  to authenticated;
grant execute on function public.escalate_support_ticket(uuid, text, uuid)
  to authenticated;
grant execute on function public.add_support_ticket_internal_note(uuid, text)
  to authenticated;
grant execute on function public.send_my_support_ticket_reply(uuid, text)
  to authenticated;
