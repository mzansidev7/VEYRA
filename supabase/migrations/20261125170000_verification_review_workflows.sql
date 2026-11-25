insert into public.staff_permissions (code, description)
values (
  'verification.view_evidence',
  'View submitted verification evidence.'
)
on conflict (code) do update
set description = excluded.description;

insert into public.staff_role_permissions (role_code, permission_code)
values
  ('super_admin', 'verification.view_evidence'),
  ('administrator', 'verification.view_evidence'),
  ('verification_agent', 'verification.view_evidence')
on conflict do nothing;

create table if not exists public.verification_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  verification_type text not null
    check (verification_type in ('photo', 'identity')),
  status text not null default 'pending'
    check (status in (
      'pending',
      'in_review',
      'approved',
      'rejected',
      'resubmission_requested'
    )),
  assigned_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  member_message text
    check (member_message is null or char_length(btrim(member_message)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint verification_submission_decision_fields check (
    (status in ('approved', 'rejected', 'resubmission_requested')
      and reviewed_at is not null and reviewed_by is not null)
    or (status not in ('approved', 'rejected', 'resubmission_requested')
      and reviewed_at is null and reviewed_by is null)
  )
);

create index if not exists verification_submissions_queue_idx
  on public.verification_submissions (status, submitted_at desc);
create index if not exists verification_submissions_member_idx
  on public.verification_submissions (user_id, verification_type, submitted_at desc);
create index if not exists verification_submissions_assignee_idx
  on public.verification_submissions (assigned_staff_member_id, status, submitted_at desc);

create unique index if not exists verification_submissions_one_active_type_idx
  on public.verification_submissions (user_id, verification_type)
  where status in ('pending', 'in_review');

create table if not exists public.verification_submission_evidence (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.verification_submissions (id)
    on delete cascade,
  storage_path text not null unique,
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  file_size_bytes bigint not null
    check (file_size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists verification_submission_evidence_submission_idx
  on public.verification_submission_evidence (submission_id, created_at);

create table if not exists public.verification_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.verification_submissions (id)
    on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  action text not null
    check (action in (
      'submitted',
      'assigned',
      'unassigned',
      'review_started',
      'approved',
      'rejected',
      'resubmission_requested',
      'note_added',
      'evidence_accessed'
    )),
  old_status text,
  new_status text,
  old_assigned_staff_member_id uuid,
  new_assigned_staff_member_id uuid,
  member_message text
    check (member_message is null or char_length(btrim(member_message)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists verification_submission_events_history_idx
  on public.verification_submission_events (submission_id, created_at desc);

create table if not exists public.verification_submission_internal_notes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.verification_submissions (id)
    on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  author_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  note text not null
    check (char_length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists verification_submission_notes_history_idx
  on public.verification_submission_internal_notes (submission_id, created_at desc);

alter table public.verification_submissions enable row level security;
alter table public.verification_submission_evidence enable row level security;
alter table public.verification_submission_events enable row level security;
alter table public.verification_submission_internal_notes enable row level security;

revoke all on public.verification_submissions,
  public.verification_submission_evidence,
  public.verification_submission_events,
  public.verification_submission_internal_notes
  from public, anon, authenticated;

grant select on public.verification_submissions,
  public.verification_submission_events
  to authenticated;
grant select on public.verification_submission_internal_notes
  to authenticated;
grant all on public.verification_submissions,
  public.verification_submission_evidence,
  public.verification_submission_events,
  public.verification_submission_internal_notes
  to service_role;
grant select, insert, update on public.user_verifications to service_role;

drop policy if exists "Verification staff view submissions"
  on public.verification_submissions;
create policy "Verification staff view submissions"
  on public.verification_submissions
  for select
  to authenticated
  using (public.staff_has_permission('verification.view'));

drop policy if exists "Verification staff view evidence"
  on public.verification_submission_evidence;

drop policy if exists "Verification staff view submission history"
  on public.verification_submission_events;
create policy "Verification staff view submission history"
  on public.verification_submission_events
  for select
  to authenticated
  using (public.staff_has_permission('verification.view'));

drop policy if exists "Verification managers view internal notes"
  on public.verification_submission_internal_notes;
create policy "Verification managers view internal notes"
  on public.verification_submission_internal_notes
  for select
  to authenticated
  using (public.staff_has_permission('verification.manage'));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'verification-evidence',
  'verification-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

drop policy if exists "Verification staff access evidence objects"
  on storage.objects;

create or replace function public.staff_get_verification_queue(
  p_status text default 'all',
  p_type text default 'all',
  p_search text default '',
  p_assignee_id uuid default null,
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
  result jsonb;
  search_value text := nullif(btrim(p_search), '');
begin
  if not public.staff_has_permission('verification.view') then
    raise exception 'Verification viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_status is null or p_type is null or p_status not in (
    'all', 'active', 'pending', 'in_review', 'approved', 'rejected',
    'resubmission_requested'
  ) or p_type not in ('all', 'photo', 'identity') then
    raise exception 'Choose valid verification filters.'
      using errcode = '22023';
  end if;
  if p_search is not null and char_length(p_search) > 100 then
    raise exception 'Search must be 100 characters or fewer.'
      using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The start date must not be after the end date.'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 then
    raise exception 'Choose a valid verification page.'
      using errcode = '22023';
  end if;

  with filtered as (
    select
      submission.id,
      submission.user_id,
      submission.verification_type,
      submission.status,
      submission.assigned_staff_member_id,
      submission.submitted_at,
      submission.updated_at,
      submission.reviewed_at,
      coalesce(
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as member_name,
      assignee.full_name as assigned_staff_name
    from public.verification_submissions as submission
    left join public.dating_profiles as profile
      on profile.user_id = submission.user_id
    left join public.staff_members as assignee
      on assignee.id = submission.assigned_staff_member_id
    where (
        p_status = 'all'
        or (p_status = 'active' and submission.status in ('pending', 'in_review'))
        or submission.status = p_status
      )
      and (p_type = 'all' or submission.verification_type = p_type)
      and (p_assignee_id is null
        or submission.assigned_staff_member_id = p_assignee_id)
      and (p_from is null
        or submission.submitted_at >= p_from::timestamptz)
      and (p_to is null
        or submission.submitted_at < (p_to + 1)::timestamptz)
      and (
        search_value is null
        or submission.user_id::text ilike '%' || search_value || '%'
        or profile.profile->'profile'->>'nickname'
          ilike '%' || replace(replace(replace(search_value, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*)::integer from filtered),
    'submissions', coalesce((
      select jsonb_agg(to_jsonb(page_row) order by page_row.submitted_at desc)
      from (
        select *
        from filtered
        order by submitted_at desc, id
        limit p_limit
        offset p_offset
      ) as page_row
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.staff_get_verification_queue(
  text, text, text, uuid, date, date, integer, integer
) from public, anon;
grant execute on function public.staff_get_verification_queue(
  text, text, text, uuid, date, date, integer, integer
) to authenticated;

create or replace function public.staff_get_verification_overview(
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.staff_has_permission('verification.view') then
    raise exception 'Verification viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The start date must not be after the end date.'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where submission.status = 'pending'),
    'in_review', count(*) filter (where submission.status = 'in_review'),
    'approved', count(*) filter (where submission.status = 'approved'),
    'rejected', count(*) filter (where submission.status = 'rejected'),
    'resubmissions', count(*) filter (
      where submission.status = 'resubmission_requested'
    ),
    'average_review_minutes', (
      select round(avg(extract(epoch from (reviewed.reviewed_at - reviewed.submitted_at)) / 60)::numeric, 1)
      from public.verification_submissions as reviewed
      where reviewed.reviewed_at is not null
        and (p_from is null or reviewed.submitted_at >= p_from::timestamptz)
        and (p_to is null or reviewed.submitted_at < (p_to + 1)::timestamptz)
    ),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(recent_row) order by recent_row.submitted_at desc)
      from (
        select
          recent.id,
          recent.user_id,
          recent.verification_type,
          recent.status,
          recent.submitted_at,
          coalesce(
            nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
            'VEYRA member'
          ) as member_name
        from public.verification_submissions as recent
        left join public.dating_profiles as profile
          on profile.user_id = recent.user_id
        order by recent.submitted_at desc
        limit 8
      ) as recent_row
    ), '[]'::jsonb),
    'agent_workload', coalesce((
      select jsonb_agg(to_jsonb(agent_row) order by agent_row.open_count desc, agent_row.name)
      from (
        select
          staff.id,
          staff.full_name as name,
          count(submission.id)::integer as open_count
        from public.staff_members as staff
        left join public.verification_submissions as submission
          on submission.assigned_staff_member_id = staff.id
          and submission.status in ('pending', 'in_review')
        where staff.status = 'active'
          and exists (
            select 1
            from public.staff_role_assignments as assignment
            join public.staff_role_permissions as role_permission
              on role_permission.role_code = assignment.role_code
            where assignment.staff_member_id = staff.id
              and assignment.revoked_at is null
              and role_permission.permission_code = 'verification.manage'
          )
        group by staff.id, staff.full_name
      ) as agent_row
    ), '[]'::jsonb)
  )
  into result
  from public.verification_submissions as submission
  where (p_from is null or submission.submitted_at >= p_from::timestamptz)
    and (p_to is null or submission.submitted_at < (p_to + 1)::timestamptz);

  return result;
end;
$$;

revoke all on function public.staff_get_verification_overview(date, date)
  from public, anon;
grant execute on function public.staff_get_verification_overview(date, date)
  to authenticated;

create or replace function public.staff_get_verification_agents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.staff_has_permission('verification.view') then
    raise exception 'Verification viewing permission is required.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', staff.id,
    'name', staff.full_name
  ) order by staff.full_name), '[]'::jsonb)
  into result
  from public.staff_members as staff
  where staff.status = 'active'
    and exists (
      select 1
      from public.staff_role_assignments as assignment
      join public.staff_role_permissions as role_permission
        on role_permission.role_code = assignment.role_code
      where assignment.staff_member_id = staff.id
        and assignment.revoked_at is null
        and role_permission.permission_code = 'verification.manage'
    );

  return result;
end;
$$;

revoke all on function public.staff_get_verification_agents()
  from public, anon;
grant execute on function public.staff_get_verification_agents()
  to authenticated;

create or replace function public.staff_get_verification_detail(
  p_submission_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.staff_has_permission('verification.view') then
    raise exception 'Verification viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_submission_id is null then
    raise exception 'A verification submission is required.'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'submission', jsonb_build_object(
      'id', submission.id,
      'user_id', submission.user_id,
      'verification_type', submission.verification_type,
      'status', submission.status,
      'assigned_staff_member_id', submission.assigned_staff_member_id,
      'assigned_staff_name', assignee.full_name,
      'submitted_at', submission.submitted_at,
      'updated_at', submission.updated_at,
      'reviewed_at', submission.reviewed_at,
      'reviewed_by', submission.reviewed_by,
      'member_message', submission.member_message,
      'member_name', coalesce(
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ),
      'photo_status', verification.photo_verification_status,
      'identity_status', verification.identity_verification_status,
      'email_verified', verification.email_verified,
      'account_status', case
        when auth_user.banned_until is not null
          and auth_user.banned_until > now() then 'suspended'
        else 'active'
      end
    ),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', evidence.id,
        'content_type', evidence.content_type,
        'file_size_bytes', evidence.file_size_bytes,
        'created_at', evidence.created_at
      ) order by evidence.created_at)
      from public.verification_submission_evidence as evidence
      where evidence.submission_id = submission.id
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attempt.id,
        'status', attempt.status,
        'submitted_at', attempt.submitted_at,
        'reviewed_at', attempt.reviewed_at,
        'member_message', attempt.member_message
      ) order by attempt.submitted_at desc)
      from public.verification_submissions as attempt
      where attempt.user_id = submission.user_id
        and attempt.verification_type = submission.verification_type
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'action', event.action,
        'old_status', event.old_status,
        'new_status', event.new_status,
        'old_assigned_staff_member_id', event.old_assigned_staff_member_id,
        'new_assigned_staff_member_id', event.new_assigned_staff_member_id,
        'member_message', event.member_message,
        'created_at', event.created_at,
        'actor_name', coalesce(actor.full_name, 'System')
      ) order by event.created_at desc)
      from public.verification_submission_events as event
      left join public.staff_members as actor
        on actor.id = event.actor_staff_member_id
      where event.submission_id = submission.id
    ), '[]'::jsonb),
    'status_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'verification_type', history.verification_type,
        'old_status', history.old_status,
        'new_status', history.new_status,
        'changed_at', history.changed_at
      ) order by history.changed_at desc)
      from public.user_verification_events as history
      where history.user_id = submission.user_id
        and history.verification_type = submission.verification_type
    ), '[]'::jsonb),
    'internal_notes', case
      when public.staff_has_permission('verification.manage') then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', note.id,
          'note', note.note,
          'created_at', note.created_at,
          'author_name', coalesce(author.full_name, 'Former staff member')
        ) order by note.created_at desc)
        from public.verification_submission_internal_notes as note
        left join public.staff_members as author
          on author.id = note.author_staff_member_id
        where note.submission_id = submission.id
      ), '[]'::jsonb)
      else null
    end
  )
  into result
  from public.verification_submissions as submission
  left join public.dating_profiles as profile
    on profile.user_id = submission.user_id
  left join public.user_verifications as verification
    on verification.user_id = submission.user_id::text
  left join public.staff_members as assignee
    on assignee.id = submission.assigned_staff_member_id
  join auth.users as auth_user
    on auth_user.id = submission.user_id
  where submission.id = p_submission_id;

  if result is null then
    raise exception 'Verification submission was not found.'
      using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.staff_get_verification_detail(uuid)
  from public, anon;
grant execute on function public.staff_get_verification_detail(uuid)
  to authenticated;

create or replace function public.staff_manage_verification_submission(
  p_submission_id uuid,
  p_action text,
  p_reason text default null,
  p_assigned_staff_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_staff_id uuid;
  submission public.verification_submissions%rowtype;
  next_status text;
  mapped_status text;
  action_reason text := nullif(btrim(p_reason), '');
  notification_title text;
  notification_body text;
begin
  if current_user_id is null
    or not public.staff_has_permission('verification.manage') then
    raise exception 'Verification management permission is required.'
      using errcode = '42501';
  end if;
  if p_submission_id is null or p_action is null or p_action not in (
    'assign', 'start_review', 'approve', 'reject', 'request_resubmission'
  ) then
    raise exception 'Choose a valid verification action.'
      using errcode = '22023';
  end if;
  if action_reason is not null and char_length(action_reason) > 1000 then
    raise exception 'The member-facing reason must be 1000 characters or fewer.'
      using errcode = '22023';
  end if;
  if p_action in ('reject', 'request_resubmission')
    and action_reason is null then
    raise exception 'A member-facing explanation is required.'
      using errcode = '22023';
  end if;

  select member.id
  into current_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if current_staff_id is null then
    raise exception 'An active staff account is required.'
      using errcode = '42501';
  end if;

  select *
  into submission
  from public.verification_submissions
  where id = p_submission_id
  for update;
  if not found then
    raise exception 'Verification submission was not found.'
      using errcode = 'P0002';
  end if;

  if p_action = 'assign' then
    if submission.status not in ('pending', 'in_review') then
      raise exception 'Only active submissions can be assigned.'
        using errcode = '55000';
    end if;
    if p_assigned_staff_member_id is not null and not exists (
      select 1
      from public.staff_members as agent
      join public.staff_role_assignments as assignment
        on assignment.staff_member_id = agent.id
        and assignment.revoked_at is null
      join public.staff_role_permissions as role_permission
        on role_permission.role_code = assignment.role_code
        and role_permission.permission_code = 'verification.manage'
      where agent.id = p_assigned_staff_member_id
        and agent.status = 'active'
    ) then
      raise exception 'Choose an active verification agent.'
        using errcode = '22023';
    end if;

    update public.verification_submissions
    set assigned_staff_member_id = p_assigned_staff_member_id,
        updated_at = now()
    where id = submission.id;

    insert into public.verification_submission_events (
      submission_id, actor_user_id, actor_staff_member_id,
      action, old_status, new_status,
      old_assigned_staff_member_id, new_assigned_staff_member_id
    )
    values (
      submission.id, current_user_id, current_staff_id,
      case when p_assigned_staff_member_id is null
        then 'unassigned' else 'assigned' end,
      submission.status, submission.status,
      submission.assigned_staff_member_id, p_assigned_staff_member_id
    );
    insert into public.staff_audit_logs (
      actor_staff_member_id, actor_user_id, target_user_id, action, details
    )
    values (
      current_staff_id, current_user_id, submission.user_id,
      case when p_assigned_staff_member_id is null
        then 'verification.submission.unassigned'
        else 'verification.submission.assigned' end,
      jsonb_build_object(
        'submission_id', submission.id,
        'assigned_staff_member_id', p_assigned_staff_member_id
      )
    );
    return jsonb_build_object(
      'submission_id', submission.id,
      'status', submission.status,
      'assigned_staff_member_id', p_assigned_staff_member_id
    );
  end if;

  if p_action = 'start_review' then
    if submission.status <> 'pending' then
      raise exception 'Only pending submissions can enter review.'
        using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.verification_submission_evidence as evidence
      where evidence.submission_id = submission.id
    ) then
      raise exception 'Evidence must be attached before review can begin.'
        using errcode = '55000';
    end if;
    next_status := 'in_review';
  elsif p_action = 'approve' then
    if submission.status not in ('pending', 'in_review') then
      raise exception 'This submission has already received a final decision.'
        using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.verification_submission_evidence as evidence
      where evidence.submission_id = submission.id
    ) then
      raise exception 'Evidence must be attached before this submission is decided.'
        using errcode = '55000';
    end if;
    next_status := 'approved';
  elsif p_action = 'reject' then
    if submission.status not in ('pending', 'in_review') then
      raise exception 'This submission has already received a final decision.'
        using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.verification_submission_evidence as evidence
      where evidence.submission_id = submission.id
    ) then
      raise exception 'Evidence must be attached before this submission is decided.'
        using errcode = '55000';
    end if;
    next_status := 'rejected';
  else
    if submission.status not in ('pending', 'in_review') then
      raise exception 'Only active submissions can request resubmission.'
        using errcode = '55000';
    end if;
    if not exists (
      select 1
      from public.verification_submission_evidence as evidence
      where evidence.submission_id = submission.id
    ) then
      raise exception 'Evidence must be attached before requesting resubmission.'
        using errcode = '55000';
    end if;
    next_status := 'resubmission_requested';
  end if;

  update public.verification_submissions
  set status = next_status,
      updated_at = now(),
      reviewed_at = case when next_status in (
        'approved', 'rejected', 'resubmission_requested'
      )
        then now() else null end,
      reviewed_by = case when next_status in (
        'approved', 'rejected', 'resubmission_requested'
      )
        then current_user_id else null end,
      member_message = case
        when next_status in ('rejected', 'resubmission_requested')
          then action_reason
        when next_status = 'approved' then 'Your verification was approved.'
        else null
      end
  where id = submission.id;

  mapped_status := case next_status
    when 'approved' then 'verified'
    when 'rejected' then 'rejected'
    when 'resubmission_requested' then 'review_required'
    else 'pending'
  end;

  insert into public.user_verifications (
    user_id,
    email_verified,
    photo_verification_status,
    identity_verification_status,
    updated_at
  )
  select
    auth_user.id::text,
    auth_user.email_confirmed_at is not null,
    case when submission.verification_type = 'photo'
      then mapped_status else 'not_started' end,
    case when submission.verification_type = 'identity'
      then mapped_status else 'not_started' end,
    now()
  from auth.users as auth_user
  where auth_user.id = submission.user_id
  on conflict (user_id) do update
  set
    photo_verification_status = case
      when submission.verification_type = 'photo' then mapped_status
      else public.user_verifications.photo_verification_status
    end,
    identity_verification_status = case
      when submission.verification_type = 'identity' then mapped_status
      else public.user_verifications.identity_verification_status
    end,
    photo_verified_at = case
      when submission.verification_type = 'photo' and mapped_status = 'verified'
        then now()
      when submission.verification_type = 'photo' then null
      else public.user_verifications.photo_verified_at
    end,
    identity_verified_at = case
      when submission.verification_type = 'identity' and mapped_status = 'verified'
        then now()
      when submission.verification_type = 'identity' then null
      else public.user_verifications.identity_verified_at
    end,
    updated_at = now();

  insert into public.verification_submission_events (
    submission_id, actor_user_id, actor_staff_member_id,
    action, old_status, new_status, member_message
  )
  values (
    submission.id, current_user_id, current_staff_id,
    case next_status
      when 'approved' then 'approved'
      when 'rejected' then 'rejected'
      when 'resubmission_requested' then 'resubmission_requested'
      else 'review_started'
    end,
    submission.status, next_status, action_reason
  );

  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    current_staff_id, current_user_id, submission.user_id,
    'verification.submission.' || next_status,
    jsonb_build_object(
      'submission_id', submission.id,
      'verification_type', submission.verification_type,
      'status', next_status
    )
  );

  if next_status in ('approved', 'rejected', 'resubmission_requested') then
    notification_title := case next_status
      when 'approved' then 'Verification approved'
      when 'rejected' then 'Verification update'
      else 'More information needed'
    end;
    notification_body := case next_status
      when 'approved' then
        'Your ' || submission.verification_type || ' verification was approved.'
      when 'rejected' then
        'Your ' || submission.verification_type ||
        ' verification was not approved: ' || action_reason
      else
        'Please resubmit your ' || submission.verification_type ||
        ' verification: ' || action_reason
    end;

    insert into public.member_notifications (
      user_id, created_by, title, body
    )
    values (
      submission.user_id, current_user_id, notification_title,
      left(notification_body, 1000)
    );
  end if;

  return jsonb_build_object(
    'submission_id', submission.id,
    'status', next_status,
    'member_message', case
      when next_status in ('rejected', 'resubmission_requested')
        then action_reason
      else null
    end
  );
end;
$$;

revoke all on function public.staff_manage_verification_submission(
  uuid, text, text, uuid
) from public, anon;
grant execute on function public.staff_manage_verification_submission(
  uuid, text, text, uuid
) to authenticated;

create or replace function public.staff_add_verification_internal_note(
  p_submission_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_staff_id uuid;
  note_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('verification.manage') then
    raise exception 'Verification management permission is required.'
      using errcode = '42501';
  end if;
  if p_submission_id is null or p_note is null
    or char_length(btrim(p_note)) not between 1 and 4000 then
    raise exception 'Internal notes must contain 1 to 4000 characters.'
      using errcode = '22023';
  end if;
  select member.id into current_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if current_staff_id is null then
    raise exception 'An active staff account is required.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.verification_submissions
    where id = p_submission_id
  ) then
    raise exception 'Verification submission was not found.'
      using errcode = 'P0002';
  end if;

  insert into public.verification_submission_internal_notes (
    submission_id, author_user_id, author_staff_member_id, note
  )
  values (
    p_submission_id, current_user_id, current_staff_id, btrim(p_note)
  )
  returning id into note_id;

  insert into public.verification_submission_events (
    submission_id, actor_user_id, actor_staff_member_id, action
  )
  values (
    p_submission_id, current_user_id, current_staff_id, 'note_added'
  );

  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  select
    current_staff_id, current_user_id, submission.user_id,
    'verification.submission.note_added',
    jsonb_build_object('submission_id', submission.id)
  from public.verification_submissions as submission
  where submission.id = p_submission_id;

  return note_id;
end;
$$;

revoke all on function public.staff_add_verification_internal_note(uuid, text)
  from public, anon;
grant execute on function public.staff_add_verification_internal_note(uuid, text)
  to authenticated;

create or replace function public.staff_record_verification_evidence_access(
  p_submission_id uuid,
  p_evidence_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_staff_id uuid;
  target_user_id uuid;
begin
  if current_user_id is null
    or not public.staff_has_permission('verification.view')
    or not public.staff_has_permission('verification.view_evidence') then
    raise exception 'Verification evidence viewing permission is required.'
      using errcode = '42501';
  end if;
  select member.id into current_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if current_staff_id is null then
    raise exception 'An active staff account is required.'
      using errcode = '42501';
  end if;
  select submission.user_id into target_user_id
  from public.verification_submissions as submission
  join public.verification_submission_evidence as evidence
    on evidence.submission_id = submission.id
  where submission.id = p_submission_id
    and evidence.id = p_evidence_id;
  if target_user_id is null then
    raise exception 'Evidence was not found for this submission.'
      using errcode = 'P0002';
  end if;

  insert into public.verification_submission_events (
    submission_id, actor_user_id, actor_staff_member_id, action
  )
  values (
    p_submission_id, current_user_id, current_staff_id, 'evidence_accessed'
  );
  insert into public.staff_audit_logs (
    actor_staff_member_id, actor_user_id, target_user_id, action, details
  )
  values (
    current_staff_id, current_user_id, target_user_id,
    'verification.evidence.accessed',
    jsonb_build_object(
      'submission_id', p_submission_id,
      'evidence_id', p_evidence_id
    )
  );
end;
$$;

revoke all on function public.staff_record_verification_evidence_access(
  uuid, uuid
) from public, anon;
grant execute on function public.staff_record_verification_evidence_access(
  uuid, uuid
) to authenticated;
