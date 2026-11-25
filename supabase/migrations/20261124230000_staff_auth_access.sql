create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text not null,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'disabled')),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_roles (
  code text primary key,
  name text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_permissions (
  code text primary key,
  description text not null
);

create table if not exists public.staff_role_permissions (
  role_code text not null references public.staff_roles (code) on delete cascade,
  permission_code text not null references public.staff_permissions (code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists public.staff_role_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  role_code text not null references public.staff_roles (code),
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);

create unique index if not exists staff_role_assignments_one_active_role
  on public.staff_role_assignments (staff_member_id, role_code)
  where revoked_at is null;

create table if not exists public.staff_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_staff_member_id uuid references public.staff_members (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  auth_session_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.staff_audit_logs
  add column if not exists auth_session_id uuid;

create table if not exists public.staff_invitation_rate_limits (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index if not exists staff_audit_logs_created_at_idx
  on public.staff_audit_logs (created_at desc);
create index if not exists staff_audit_logs_target_user_idx
  on public.staff_audit_logs (target_user_id, created_at desc);
create unique index if not exists staff_audit_logs_auth_session_event_unique
  on public.staff_audit_logs (actor_user_id, auth_session_id, action)
  where auth_session_id is not null
    and action in ('staff.login.succeeded', 'staff.logout');
create index if not exists staff_role_assignments_active_staff_idx
  on public.staff_role_assignments (staff_member_id)
  where revoked_at is null;
create index if not exists staff_invitation_rate_limits_actor_requested_idx
  on public.staff_invitation_rate_limits (actor_user_id, requested_at desc);

insert into public.staff_roles (code, name, description)
values
  ('super_admin', 'Super Admin', 'Full access, including staff provisioning.'),
  ('administrator', 'Administrator', 'Manage portal operations and staff access.'),
  ('support_agent', 'Support Agent', 'Handle customer support workflows.'),
  ('moderator', 'Moderator', 'Review and manage safety reports.'),
  ('finance_manager', 'Finance Manager', 'Review subscription and revenue data.'),
  ('verification_agent', 'Verification Agent', 'Review identity verification requests.'),
  ('analyst', 'Analyst', 'Review approved analytics and reporting.'),
  ('developer', 'Developer', 'Review system settings and audit information.'),
  ('tester', 'Tester', 'Access the support portal dashboard.')
on conflict (code) do update
set name = excluded.name, description = excluded.description;

insert into public.staff_permissions (code, description)
values
  ('dashboard.view', 'View the support dashboard.'),
  ('users.view', 'View member records.'),
  ('users.manage', 'Manage member records.'),
  ('users.suspend', 'Suspend or reinstate member accounts.'),
  ('moderation.view', 'View safety reports and moderation queues.'),
  ('moderation.manage', 'Resolve safety reports and moderate content.'),
  ('support.view', 'View support requests and conversations.'),
  ('support.manage', 'Respond to and manage support requests.'),
  ('notifications.view', 'View notification campaigns and delivery.'),
  ('notifications.send', 'Send or schedule notifications.'),
  ('subscriptions.view', 'View plans, subscribers, payments and revenue.'),
  ('subscriptions.manage', 'Manage subscription operations.'),
  ('verification.view', 'View verification requests.'),
  ('verification.manage', 'Review and update verification requests.'),
  ('analytics.view', 'View analytics and reporting.'),
  ('staff.manage', 'Invite and manage staff membership.'),
  ('roles.manage', 'Assign and manage staff roles.'),
  ('audit_logs.view', 'View staff audit events.'),
  ('system.manage', 'Manage portal system settings.')
on conflict (code) do update set description = excluded.description;

insert into public.staff_role_permissions (role_code, permission_code)
select mapping.role_code, mapping.permission_code
from (values
  ('super_admin', 'dashboard.view'),
  ('super_admin', 'users.view'),
  ('super_admin', 'users.manage'),
  ('super_admin', 'users.suspend'),
  ('super_admin', 'moderation.view'),
  ('super_admin', 'moderation.manage'),
  ('super_admin', 'support.view'),
  ('super_admin', 'support.manage'),
  ('super_admin', 'notifications.view'),
  ('super_admin', 'notifications.send'),
  ('super_admin', 'subscriptions.view'),
  ('super_admin', 'subscriptions.manage'),
  ('super_admin', 'verification.view'),
  ('super_admin', 'verification.manage'),
  ('super_admin', 'analytics.view'),
  ('super_admin', 'staff.manage'),
  ('super_admin', 'roles.manage'),
  ('super_admin', 'audit_logs.view'),
  ('super_admin', 'system.manage'),
  ('administrator', 'dashboard.view'),
  ('administrator', 'users.view'),
  ('administrator', 'users.manage'),
  ('administrator', 'users.suspend'),
  ('administrator', 'moderation.view'),
  ('administrator', 'moderation.manage'),
  ('administrator', 'support.view'),
  ('administrator', 'support.manage'),
  ('administrator', 'notifications.view'),
  ('administrator', 'notifications.send'),
  ('administrator', 'subscriptions.view'),
  ('administrator', 'subscriptions.manage'),
  ('administrator', 'verification.view'),
  ('administrator', 'verification.manage'),
  ('administrator', 'analytics.view'),
  ('administrator', 'staff.manage'),
  ('administrator', 'roles.manage'),
  ('administrator', 'audit_logs.view'),
  ('administrator', 'system.manage'),
  ('support_agent', 'dashboard.view'),
  ('support_agent', 'users.view'),
  ('support_agent', 'support.view'),
  ('support_agent', 'support.manage'),
  ('moderator', 'dashboard.view'),
  ('moderator', 'users.view'),
  ('moderator', 'users.suspend'),
  ('moderator', 'moderation.view'),
  ('moderator', 'moderation.manage'),
  ('finance_manager', 'dashboard.view'),
  ('finance_manager', 'subscriptions.view'),
  ('finance_manager', 'subscriptions.manage'),
  ('finance_manager', 'analytics.view'),
  ('verification_agent', 'dashboard.view'),
  ('verification_agent', 'users.view'),
  ('verification_agent', 'verification.view'),
  ('verification_agent', 'verification.manage'),
  ('analyst', 'dashboard.view'),
  ('analyst', 'analytics.view'),
  ('developer', 'dashboard.view'),
  ('developer', 'audit_logs.view'),
  ('developer', 'system.manage'),
  ('tester', 'dashboard.view')
) as mapping(role_code, permission_code)
on conflict do nothing;

create or replace function public.staff_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members as member
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = member.id
      and assignment.revoked_at is null
    join public.staff_role_permissions as role_permission
      on role_permission.role_code = assignment.role_code
    where member.user_id = (select auth.uid())
      and member.status = 'active'
      and role_permission.permission_code = p_permission
  );
$$;

create or replace function public.staff_has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_members as member
    join public.staff_role_assignments as assignment
      on assignment.staff_member_id = member.id
      and assignment.revoked_at is null
    where member.user_id = (select auth.uid())
      and member.status = 'active'
      and assignment.role_code = p_role
  );
$$;

create or replace function public.get_my_staff_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', member.id,
    'full_name', member.full_name,
    'email', member.email,
    'roles', coalesce((
      select jsonb_agg(
        jsonb_build_object('code', role.code, 'name', role.name)
        order by role.name
      )
      from public.staff_role_assignments as assignment
      join public.staff_roles as role on role.code = assignment.role_code
      where assignment.staff_member_id = member.id
        and assignment.revoked_at is null
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(distinct role_permission.permission_code
        order by role_permission.permission_code)
      from public.staff_role_assignments as assignment
      join public.staff_role_permissions as role_permission
        on role_permission.role_code = assignment.role_code
      where assignment.staff_member_id = member.id
        and assignment.revoked_at is null
    ), '[]'::jsonb)
  )
  from public.staff_members as member
  where member.user_id = (select auth.uid())
    and member.status = 'active'
    and public.staff_has_permission('dashboard.view')
  limit 1;
$$;

create or replace function public.record_staff_auth_event(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_staff_id uuid;
  current_session_id uuid;
  session_issued_at bigint;
begin
  if p_action not in (
    'staff.login.succeeded',
    'staff.logout'
  ) then
    raise exception 'Unsupported staff authentication event.';
  end if;

  select member.id
  into current_staff_id
  from public.staff_members as member
  where member.user_id = (select auth.uid())
    and member.status = 'active';

  if current_staff_id is null then
    raise exception 'Active staff membership is required.';
  end if;

  current_session_id := nullif(
    (select auth.jwt()) ->> 'session_id',
    ''
  )::uuid;
  session_issued_at := nullif(
    (select auth.jwt()) ->> 'iat',
    ''
  )::bigint;
  if current_session_id is null then
    raise exception 'A valid authentication session is required.';
  end if;
  if p_action = 'staff.login.succeeded'
    and (
      session_issued_at is null
      or abs(extract(epoch from now())::bigint - session_issued_at) > 300
    )
  then
    raise exception 'The authentication session is not recent enough.';
  end if;

  insert into public.staff_audit_logs (
    actor_staff_member_id,
    actor_user_id,
    auth_session_id,
    action
  )
  values (
    current_staff_id,
    (select auth.uid()),
    current_session_id,
    p_action
  )
  on conflict do nothing;
end;
$$;

create or replace function public.log_staff_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_staff_id uuid;
begin
  if old.encrypted_password is not distinct from new.encrypted_password then
    return new;
  end if;

  select member.id
  into current_staff_id
  from public.staff_members as member
  where member.user_id = new.id
    and member.status in ('invited', 'active', 'suspended');

  if current_staff_id is not null then
    insert into public.staff_audit_logs (
      actor_staff_member_id,
      actor_user_id,
      action
    )
    values (
      current_staff_id,
      new.id,
      'staff.password.changed'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_staff_password_change on auth.users;
create trigger audit_staff_password_change
  after update of encrypted_password on auth.users
  for each row
  execute function public.log_staff_password_change();

create or replace function public.accept_staff_invitation()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_staff_id uuid;
begin
  select member.id
  into invited_staff_id
  from public.staff_members as member
  join auth.users as auth_user on auth_user.id = member.user_id
  where member.user_id = (select auth.uid())
    and member.status = 'invited'
    and auth_user.email_confirmed_at is not null;

  if invited_staff_id is null then
    return false;
  end if;

  update public.staff_members
  set status = 'active',
      activated_at = now(),
      updated_at = now()
  where id = invited_staff_id;

  insert into public.staff_audit_logs (
    actor_staff_member_id,
    actor_user_id,
    action
  )
  values (
    invited_staff_id,
    (select auth.uid()),
    'staff.invitation.accepted'
  );

  return true;
end;
$$;

create or replace function public.consume_staff_invitation_rate_limit()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  recent_invitation_count integer;
begin
  if current_user_id is null
    or not public.staff_has_permission('staff.manage')
    or not public.staff_has_permission('roles.manage')
  then
    raise exception 'Staff invitation permission is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  delete from public.staff_invitation_rate_limits as rate_limit
  where rate_limit.actor_user_id = current_user_id
    and rate_limit.requested_at <= now() - interval '1 hour';

  select count(*)::integer
  into recent_invitation_count
  from public.staff_invitation_rate_limits as rate_limit
  where rate_limit.actor_user_id = current_user_id
    and rate_limit.requested_at > now() - interval '1 hour';

  if recent_invitation_count >= 5 then
    return false;
  end if;

  insert into public.staff_invitation_rate_limits (actor_user_id)
  values (current_user_id);

  return true;
end;
$$;

alter table public.staff_members enable row level security;
alter table public.staff_roles enable row level security;
alter table public.staff_permissions enable row level security;
alter table public.staff_role_permissions enable row level security;
alter table public.staff_role_assignments enable row level security;
alter table public.staff_audit_logs enable row level security;
alter table public.staff_invitation_rate_limits enable row level security;

drop policy if exists "Staff can read their own active membership"
  on public.staff_members;
create policy "Staff can read their own active membership"
  on public.staff_members
  for select
  to authenticated
  using (user_id = (select auth.uid()) and status = 'active');

drop policy if exists "Authorised staff can read audit logs"
  on public.staff_audit_logs;
create policy "Authorised staff can read audit logs"
  on public.staff_audit_logs
  for select
  to authenticated
  using (public.staff_has_permission('audit_logs.view'));

revoke all on public.staff_members from public, anon, authenticated;
revoke all on public.staff_roles from public, anon, authenticated;
revoke all on public.staff_permissions from public, anon, authenticated;
revoke all on public.staff_role_permissions from public, anon, authenticated;
revoke all on public.staff_role_assignments from public, anon, authenticated;
revoke all on public.staff_audit_logs from public, anon, authenticated;
revoke all on public.staff_invitation_rate_limits from public, anon, authenticated;

grant select on public.staff_members to authenticated;
grant select on public.staff_audit_logs to authenticated;
grant all on public.staff_members to service_role;
grant all on public.staff_roles to service_role;
grant all on public.staff_permissions to service_role;
grant all on public.staff_role_permissions to service_role;
grant all on public.staff_role_assignments to service_role;
grant all on public.staff_audit_logs to service_role;
grant all on public.staff_invitation_rate_limits to service_role;

revoke all on function public.staff_has_permission(text) from public, anon;
revoke all on function public.staff_has_role(text) from public, anon;
revoke all on function public.get_my_staff_access() from public, anon;
revoke all on function public.record_staff_auth_event(text) from public, anon;
revoke all on function public.log_staff_password_change() from public, anon, authenticated;
revoke all on function public.accept_staff_invitation() from public, anon;
revoke all on function public.consume_staff_invitation_rate_limit() from public, anon;

grant execute on function public.staff_has_permission(text) to authenticated;
grant execute on function public.staff_has_role(text) to authenticated;
grant execute on function public.get_my_staff_access() to authenticated;
grant execute on function public.record_staff_auth_event(text) to authenticated;
grant execute on function public.accept_staff_invitation() to authenticated;
grant execute on function public.consume_staff_invitation_rate_limit() to authenticated;
