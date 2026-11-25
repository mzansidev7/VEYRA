create table if not exists public.member_activity_tracking_config (
  singleton boolean primary key default true check (singleton),
  tracking_started_at timestamptz not null default now()
);

insert into public.member_activity_tracking_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.member_activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

create index if not exists member_activity_days_date_user_idx
  on public.member_activity_days (activity_date, user_id);

alter table public.member_activity_tracking_config enable row level security;
alter table public.member_activity_days enable row level security;
revoke all on public.member_activity_tracking_config,
  public.member_activity_days from public, anon, authenticated;
grant all on public.member_activity_tracking_config,
  public.member_activity_days to service_role;

create or replace function public.record_member_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  insert into public.member_activity_days (user_id, activity_date, last_seen_at)
  select current_user_id,
         (now() at time zone 'Africa/Johannesburg')::date,
         now()
  from auth.users as auth_user
  where auth_user.id = current_user_id
    and not auth_user.is_anonymous
    and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= now())
    and not exists (
      select 1
      from public.staff_members as staff_member
      where staff_member.user_id = current_user_id
    )
  on conflict (user_id, activity_date)
  do update set last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.record_member_activity()
  from public, anon;
grant execute on function public.record_member_activity()
  to authenticated;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  category text not null
    check (category in ('account', 'technical', 'safety', 'verification', 'other')),
  subject text not null check (char_length(btrim(subject)) between 5 and 120),
  message text not null check (char_length(btrim(message)) between 10 and 4000),
  status text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_priority_updated_idx
  on public.support_tickets (status, priority, updated_at desc);
create index if not exists support_tickets_user_created_idx
  on public.support_tickets (user_id, created_at desc);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id)
    on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  action text not null
    check (action in ('created', 'status_changed', 'priority_changed', 'assigned')),
  old_status text,
  new_status text,
  old_priority text,
  new_priority text,
  old_assigned_staff_member_id uuid,
  new_assigned_staff_member_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_events_created_idx
  on public.support_ticket_events (created_at desc);
create index if not exists support_ticket_events_ticket_created_idx
  on public.support_ticket_events (ticket_id, created_at desc);

alter table public.user_reports
  add column if not exists status text not null default 'pending',
  add column if not exists priority text not null default 'normal',
  add column if not exists content_type text not null default 'member',
  add column if not exists message_id uuid
    references public.messages (id) on delete set null,
  add column if not exists reviewed_by uuid
    references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolution text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_reports'::regclass
      and conname = 'user_reports_status_check'
  ) then
    alter table public.user_reports
      add constraint user_reports_status_check
      check (status in ('pending', 'in_review', 'resolved', 'dismissed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_reports'::regclass
      and conname = 'user_reports_priority_check'
  ) then
    alter table public.user_reports
      add constraint user_reports_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_reports'::regclass
      and conname = 'user_reports_content_type_check'
  ) then
    alter table public.user_reports
      add constraint user_reports_content_type_check
      check (content_type in ('member', 'message'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_reports'::regclass
      and conname = 'user_reports_message_content_consistency_check'
  ) then
    alter table public.user_reports
      add constraint user_reports_message_content_consistency_check
      check ((content_type = 'message') = (message_id is not null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_reports'::regclass
      and conname = 'user_reports_reviewed_status_consistency_check'
  ) then
    alter table public.user_reports
      add constraint user_reports_reviewed_status_consistency_check
      check (
        (status in ('resolved', 'dismissed')) =
        (reviewed_at is not null and reviewed_by is not null)
      );
  end if;
end
$constraints$;

create index if not exists user_reports_status_priority_created_idx
  on public.user_reports (status, priority, created_at desc);
create index if not exists user_reports_message_id_idx
  on public.user_reports (message_id)
  where message_id is not null;
create unique index if not exists user_reports_reporter_message_uidx
  on public.user_reports (reporter_id, message_id)
  where message_id is not null;

create table if not exists public.user_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.user_reports (id)
    on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  action text not null
    check (action in ('submitted', 'status_changed', 'priority_changed')),
  old_status text,
  new_status text,
  old_priority text,
  new_priority text,
  created_at timestamptz not null default now()
);

create index if not exists user_report_events_created_idx
  on public.user_report_events (created_at desc);
create index if not exists user_report_events_report_created_idx
  on public.user_report_events (report_id, created_at desc);

create table if not exists public.user_verification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  verification_type text not null
    check (verification_type in ('photo', 'identity')),
  old_status text not null,
  new_status text not null,
  changed_at timestamptz not null default now()
);

create index if not exists user_verification_events_changed_idx
  on public.user_verification_events (changed_at desc);
create index if not exists user_verification_events_user_changed_idx
  on public.user_verification_events (user_id, changed_at desc);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.user_report_events enable row level security;
alter table public.user_verification_events enable row level security;

revoke all on public.support_tickets, public.support_ticket_events,
  public.user_report_events, public.user_verification_events
  from public, anon, authenticated;
grant all on public.support_tickets, public.support_ticket_events,
  public.user_report_events, public.user_verification_events
  to service_role;

create or replace function public.log_support_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
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
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      new_status, new_priority, new_assigned_staff_member_id
    )
    values (
      new.id, actor_id, actor_staff_id, 'created',
      new.status, new.priority, new.assigned_staff_member_id
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      old_status, new_status
    )
    values (
      new.id, actor_id, actor_staff_id, 'status_changed',
      old.status, new.status
    );
  end if;
  if old.priority is distinct from new.priority then
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      old_priority, new_priority
    )
    values (
      new.id, actor_id, actor_staff_id, 'priority_changed',
      old.priority, new.priority
    );
  end if;
  if old.assigned_staff_member_id
    is distinct from new.assigned_staff_member_id then
    insert into public.support_ticket_events (
      ticket_id, actor_user_id, actor_staff_member_id, action,
      old_assigned_staff_member_id, new_assigned_staff_member_id
    )
    values (
      new.id, actor_id, actor_staff_id, 'assigned',
      old.assigned_staff_member_id, new.assigned_staff_member_id
    );
  end if;

  new.updated_at := now();
  return new;
end;
$$;

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
  return new;
end;
$$;

create or replace function public.log_user_verification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.photo_verification_status <> 'not_started' then
      insert into public.user_verification_events (
        user_id, verification_type, old_status, new_status
      )
      values (
        new.user_id::uuid, 'photo', 'not_started',
        new.photo_verification_status
      );
    end if;
    if new.identity_verification_status <> 'not_started' then
      insert into public.user_verification_events (
        user_id, verification_type, old_status, new_status
      )
      values (
        new.user_id::uuid, 'identity', 'not_started',
        new.identity_verification_status
      );
    end if;
    return new;
  end if;

  if old.photo_verification_status
    is distinct from new.photo_verification_status then
    insert into public.user_verification_events (
      user_id, verification_type, old_status, new_status
    )
    values (
      new.user_id::uuid, 'photo',
      old.photo_verification_status, new.photo_verification_status
    );
  end if;
  if old.identity_verification_status
    is distinct from new.identity_verification_status then
    insert into public.user_verification_events (
      user_id, verification_type, old_status, new_status
    )
    values (
      new.user_id::uuid, 'identity',
      old.identity_verification_status,
      new.identity_verification_status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists support_tickets_write_event
  on public.support_tickets;
create trigger support_tickets_write_event
  after insert or update on public.support_tickets
  for each row execute function public.log_support_ticket_event();

drop trigger if exists user_reports_write_event
  on public.user_reports;
create trigger user_reports_write_event
  after insert or update on public.user_reports
  for each row execute function public.log_user_report_event();

drop trigger if exists user_verification_status_change
  on public.user_verifications;
create trigger user_verification_status_change
  after insert or update of photo_verification_status,
    identity_verification_status on public.user_verifications
  for each row execute function public.log_user_verification_change();

revoke all on function public.log_support_ticket_event()
  from public, anon, authenticated;
revoke all on function public.log_user_report_event()
  from public, anon, authenticated;
revoke all on function public.log_user_verification_change()
  from public, anon, authenticated;

create or replace function public.submit_support_ticket(
  p_category text,
  p_subject text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  recent_ticket_count integer;
  new_ticket_id uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in to contact VEYRA support.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = current_user_id
      and not auth_user.is_anonymous
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= now())
  ) then
    raise exception 'An active VEYRA member account is required.'
      using errcode = '42501';
  end if;

  if p_category is null or p_category not in (
      'account', 'technical', 'safety', 'verification', 'other'
    )
    or p_subject is null
    or char_length(btrim(p_subject)) not between 5 and 120
    or p_message is null
    or char_length(btrim(p_message)) not between 10 and 4000
  then
    raise exception 'Enter a category, a subject of 5–120 characters, and a message of 10–4000 characters.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 1)
  );

  select count(*)::integer
  into recent_ticket_count
  from public.support_tickets as ticket
  where ticket.user_id = current_user_id
    and ticket.created_at > now() - interval '24 hours';

  if recent_ticket_count >= 5 then
    raise exception 'Support request limit reached. Try again later.'
      using errcode = '54000';
  end if;

  insert into public.support_tickets (user_id, category, subject, message)
  values (
    current_user_id, p_category, btrim(p_subject), btrim(p_message)
  )
  returning id into new_ticket_id;

  return new_ticket_id;
end;
$$;

create or replace function public.get_my_support_tickets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ticket.id,
      'category', ticket.category,
      'subject', ticket.subject,
      'status', ticket.status,
      'created_at', ticket.created_at,
      'updated_at', ticket.updated_at
    )
    order by ticket.updated_at desc
  ), '[]'::jsonb)
  from (
    select support_ticket.*
    from public.support_tickets as support_ticket
    where support_ticket.user_id = (select auth.uid())
    order by support_ticket.updated_at desc
    limit 25
  ) as ticket;
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
begin
  if current_user_id is null
    or not public.staff_has_permission('support.manage')
  then
    raise exception 'Support management permission is required.'
      using errcode = '42501';
  end if;

  if p_status is not null
    and p_status not in ('open', 'pending', 'resolved', 'closed') then
    raise exception 'Choose a valid support ticket status.'
      using errcode = '22023';
  end if;

  if p_priority is not null
    and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Choose a valid support ticket priority.'
      using errcode = '22023';
  end if;

  if p_assigned_staff_member_id is not null
    and not exists (
      select 1
      from public.staff_members as member
      where member.id = p_assigned_staff_member_id
        and member.status = 'active'
    ) then
    raise exception 'The assigned staff member is not active.'
      using errcode = '22023';
  end if;

  update public.support_tickets as ticket
  set status = coalesce(p_status, ticket.status),
      priority = coalesce(p_priority, ticket.priority),
      assigned_staff_member_id = coalesce(
        p_assigned_staff_member_id, ticket.assigned_staff_member_id
      )
  where ticket.id = p_ticket_id;

  if not found then
    raise exception 'Support ticket not found.';
  end if;
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
begin
  if current_user_id is null
    or not public.staff_has_permission('moderation.manage')
  then
    raise exception 'Moderation management permission is required.'
      using errcode = '42501';
  end if;

  if p_status is not null
    and p_status not in ('pending', 'in_review', 'resolved', 'dismissed') then
    raise exception 'Choose a valid moderation status.'
      using errcode = '22023';
  end if;

  if p_priority is not null
    and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Choose a valid report priority.'
      using errcode = '22023';
  end if;

  if p_resolution is not null
    and char_length(btrim(p_resolution)) > 2000 then
    raise exception 'Resolution notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  update public.user_reports as report
  set status = coalesce(p_status, report.status),
      priority = coalesce(p_priority, report.priority),
      reviewed_by = case
        when coalesce(p_status, report.status) in ('resolved', 'dismissed')
          then current_user_id
        else null
      end,
      reviewed_at = case
        when coalesce(p_status, report.status) in ('resolved', 'dismissed')
          then now()
        else null
      end,
      resolution = case
        when p_resolution is not null then btrim(p_resolution)
        when p_status in ('pending', 'in_review') then null
        else report.resolution
      end
  where report.id = p_report_id;

  if not found then
    raise exception 'User report not found.';
  end if;
end;
$$;

create or replace function public.report_message(
  p_message_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  message_record public.messages%rowtype;
  new_report_id uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in to report a message.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = current_user_id
      and not auth_user.is_anonymous
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= now())
  ) then
    raise exception 'An active VEYRA member account is required.'
      using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in (
    'inappropriate', 'harassment', 'spam', 'fake_profile', 'other'
  ) then
    raise exception 'Choose a valid report reason.'
      using errcode = '22023';
  end if;

  select message.*
  into message_record
  from public.messages as message
  where message.id = p_message_id;

  if not found
    or message_record.sender_id = current_user_id
    or not public.is_active_conversation_member(message_record.conversation_id)
  then
    raise exception 'This message is not available to report.'
      using errcode = '42501';
  end if;

  insert into public.user_reports (
    reporter_id, reported_user_id, conversation_id,
    reason, content_type, message_id
  )
  values (
    current_user_id, message_record.sender_id,
    message_record.conversation_id, p_reason, 'message', message_record.id
  )
  on conflict (reporter_id, message_id)
    where message_id is not null
    do nothing
  returning id into new_report_id;

  if new_report_id is null then
    select report.id
    into new_report_id
    from public.user_reports as report
    where report.reporter_id = current_user_id
      and report.message_id = message_record.id;
  end if;

  return new_report_id;
end;
$$;

revoke all on function public.submit_support_ticket(text, text, text)
  from public, anon;
revoke all on function public.get_my_support_tickets()
  from public, anon;
revoke all on function public.update_support_ticket(uuid, text, text, uuid)
  from public, anon;
revoke all on function public.update_user_report(uuid, text, text, text)
  from public, anon;
revoke all on function public.report_message(uuid, text)
  from public, anon;

grant execute on function public.submit_support_ticket(text, text, text)
  to authenticated;
grant execute on function public.get_my_support_tickets()
  to authenticated;
grant execute on function public.update_support_ticket(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.update_user_report(uuid, text, text, text)
  to authenticated;
grant execute on function public.report_message(uuid, text)
  to authenticated;
