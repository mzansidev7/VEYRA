create or replace function public.auto_assign_my_support_ticket(
  p_ticket_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_staff_id uuid;
  ticket_user_id uuid;
  ticket_assignee_id uuid;
  ticket_status text;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.view')
    or not public.staff_has_permission('support.manage')
  then
    raise exception 'Support management permission is required to claim a ticket.'
      using errcode = '42501';
  end if;

  select member.id
  into current_staff_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';

  if current_staff_id is null then
    raise exception 'An active support staff membership is required.'
      using errcode = '42501';
  end if;

  select ticket.user_id, ticket.assigned_staff_member_id, ticket.status
  into ticket_user_id, ticket_assignee_id, ticket_status
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'Support ticket not found.'
      using errcode = 'P0002';
  end if;

  if ticket_assignee_id is not null
    or ticket_status not in ('open', 'pending')
  then
    return false;
  end if;

  update public.support_tickets as ticket
  set assigned_staff_member_id = current_staff_id,
      updated_at = now()
  where ticket.id = p_ticket_id;

  insert into public.support_ticket_events (
    ticket_id,
    actor_user_id,
    actor_staff_member_id,
    action,
    old_assigned_staff_member_id,
    new_assigned_staff_member_id
  )
  values (
    p_ticket_id,
    current_user_id,
    current_staff_id,
    'assigned',
    null,
    current_staff_id
  );

  insert into public.staff_audit_logs (
    actor_staff_member_id,
    actor_user_id,
    target_user_id,
    action,
    details
  )
  values (
    current_staff_id,
    current_user_id,
    ticket_user_id,
    'support.ticket.auto_assigned',
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'new_assignee_id', current_staff_id
    )
  );

  return true;
end;
$$;

revoke all on function public.auto_assign_my_support_ticket(uuid)
  from public, anon;
grant execute on function public.auto_assign_my_support_ticket(uuid)
  to authenticated;
