create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id)
    on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete restrict,
  sender_staff_member_id uuid not null references public.staff_members (id)
    on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_ticket_messages enable row level security;
revoke all on public.support_ticket_messages from public, anon, authenticated;
grant all on public.support_ticket_messages to service_role;

alter table public.support_ticket_events
  drop constraint if exists support_ticket_events_action_check;
alter table public.support_ticket_events
  add constraint support_ticket_events_action_check
  check (action in (
    'created',
    'status_changed',
    'priority_changed',
    'assigned',
    'reply_sent'
  ));

create or replace function public.log_support_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.support_ticket_events (
    ticket_id, actor_user_id, actor_staff_member_id, action
  )
  values (
    new.ticket_id, new.sender_user_id, new.sender_staff_member_id, 'reply_sent'
  );
  return new;
end;
$$;

drop trigger if exists support_ticket_reply_event
  on public.support_ticket_messages;
create trigger support_ticket_reply_event
  after insert on public.support_ticket_messages
  for each row execute function public.log_support_ticket_reply();

revoke all on function public.log_support_ticket_reply()
  from public, anon, authenticated;

create or replace function public.get_support_ticket_inbox(
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
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
  search_term text := nullif(btrim(p_search), '');
begin
  if not public.staff_has_permission('support.view') then
    raise exception 'Support viewing permission is required.'
      using errcode = '42501';
  end if;

  if p_status is not null
    and p_status not in ('open', 'pending', 'resolved', 'closed') then
    raise exception 'Choose a valid support ticket status.'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 then
    raise exception 'Choose a valid support inbox page.'
      using errcode = '22023';
  end if;

  if search_term is not null and char_length(search_term) > 120 then
    raise exception 'Search text must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  with filtered as materialized (
    select
      ticket.id,
      ticket.user_id,
      auth_user.email,
      ticket.category,
      ticket.subject,
      ticket.status,
      ticket.priority,
      ticket.created_at,
      ticket.updated_at,
      (
        select count(*)
        from public.support_ticket_messages as reply
        where reply.ticket_id = ticket.id
      ) as reply_count
    from public.support_tickets as ticket
    join auth.users as auth_user on auth_user.id = ticket.user_id
    where (p_status is null or ticket.status = p_status)
      and (
        search_term is null
        or ticket.subject ilike '%' || search_term || '%'
        or auth_user.email ilike '%' || search_term || '%'
        or ticket.message ilike '%' || search_term || '%'
      )
  ),
  page as (
    select *
    from filtered
    order by
      case when status in ('open', 'pending') then 0 else 1 end,
      updated_at desc,
      id
    limit p_limit
    offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'tickets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ticket.id,
          'email', ticket.email,
          'category', ticket.category,
          'subject', ticket.subject,
          'status', ticket.status,
          'priority', ticket.priority,
          'created_at', ticket.created_at,
          'updated_at', ticket.updated_at,
          'reply_count', ticket.reply_count
        )
        order by
          case when ticket.status in ('open', 'pending') then 0 else 1 end,
          ticket.updated_at desc,
          ticket.id
      )
      from page as ticket
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_support_ticket_detail(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ticket_record public.support_tickets%rowtype;
  ticket_email text;
begin
  if not public.staff_has_permission('support.view') then
    raise exception 'Support viewing permission is required.'
      using errcode = '42501';
  end if;

  select ticket.*
  into ticket_record
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id;

  if not found then
    raise exception 'Support ticket not found.';
  end if;
  select auth_user.email
  into ticket_email
  from auth.users as auth_user
  where auth_user.id = ticket_record.user_id;

  return jsonb_build_object(
    'id', ticket_record.id,
    'email', ticket_email,
    'category', ticket_record.category,
    'subject', ticket_record.subject,
    'message', ticket_record.message,
    'status', ticket_record.status,
    'priority', ticket_record.priority,
    'created_at', ticket_record.created_at,
    'updated_at', ticket_record.updated_at,
    'reply_count', (
      select count(*)
      from public.support_ticket_messages as reply
      where reply.ticket_id = ticket_record.id
    ),
    'replies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reply.id,
          'body', reply.body,
          'created_at', reply.created_at,
          'sender', 'staff'
        )
        order by reply.created_at
      )
      from public.support_ticket_messages as reply
      where reply.ticket_id = ticket_record.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.send_support_ticket_reply(
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
  current_staff_member_id uuid;
  new_message_id uuid;
  ticket_status text;
begin
  if current_user_id is null
    or not public.staff_has_permission('support.manage')
  then
    raise exception 'Support management permission is required.'
      using errcode = '42501';
  end if;

  if p_message is null or char_length(btrim(p_message)) not between 1 and 4000
  then
    raise exception 'Reply must be between 1 and 4000 characters.'
      using errcode = '22023';
  end if;

  select member.id
  into current_staff_member_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';

  if current_staff_member_id is null then
    raise exception 'An active staff membership is required.'
      using errcode = '42501';
  end if;

  select ticket.status
  into ticket_status
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
  for update;

  if not found then
    raise exception 'Support ticket not found.';
  end if;

  if ticket_status = 'closed' then
    raise exception 'Closed tickets cannot receive replies.'
      using errcode = '22023';
  end if;

  insert into public.support_ticket_messages (
    ticket_id, sender_user_id, sender_staff_member_id, body
  )
  values (
    p_ticket_id, current_user_id, current_staff_member_id, btrim(p_message)
  )
  returning id into new_message_id;

  update public.support_tickets
  set updated_at = now()
  where id = p_ticket_id;

  return new_message_id;
end;
$$;

create or replace function public.get_my_support_ticket_detail(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ticket_record public.support_tickets%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to view this support request.'
      using errcode = '42501';
  end if;

  select ticket.*
  into ticket_record
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
    and ticket.user_id = (select auth.uid());

  if not found then
    raise exception 'Support request not found.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', ticket_record.id,
    'category', ticket_record.category,
    'subject', ticket_record.subject,
    'message', ticket_record.message,
    'status', ticket_record.status,
    'priority', ticket_record.priority,
    'created_at', ticket_record.created_at,
    'updated_at', ticket_record.updated_at,
    'reply_count', (
      select count(*)
      from public.support_ticket_messages as reply
      where reply.ticket_id = ticket_record.id
    ),
    'replies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reply.id,
          'body', reply.body,
          'created_at', reply.created_at
        )
        order by reply.created_at
      )
      from public.support_ticket_messages as reply
      where reply.ticket_id = ticket_record.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_support_ticket_inbox(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_support_ticket_detail(uuid)
  from public, anon, authenticated;
revoke all on function public.send_support_ticket_reply(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_my_support_ticket_detail(uuid)
  from public, anon;

grant execute on function public.get_support_ticket_inbox(text, text, integer, integer)
  to authenticated;
grant execute on function public.get_support_ticket_detail(uuid)
  to authenticated;
grant execute on function public.send_support_ticket_reply(uuid, text)
  to authenticated;
grant execute on function public.get_my_support_ticket_detail(uuid)
  to authenticated;
