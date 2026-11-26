create table if not exists public.conversation_lock_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  auth_session_id uuid not null,
  expires_at timestamptz not null,
  primary key (user_id, auth_session_id)
);

alter table public.conversation_lock_access enable row level security;
revoke all on public.conversation_lock_access from public, anon, authenticated;
grant all on public.conversation_lock_access to service_role;

create or replace function public.grant_chat_lock_access(
  p_user_id uuid,
  p_auth_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversation_lock_access
  where expires_at <= now();

  if p_user_id is null or p_auth_session_id is null then
    raise exception 'An authenticated session is required.';
  end if;
  if not exists (
    select 1
    from public.conversation_lock_credentials
    where user_id = p_user_id
  ) then
    raise exception 'Lock Chats is not configured.';
  end if;

  insert into public.conversation_lock_access (
    user_id,
    auth_session_id,
    expires_at
  )
  values (p_user_id, p_auth_session_id, now() + interval '15 minutes')
  on conflict (user_id, auth_session_id) do update
  set expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.grant_chat_lock_access(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.grant_chat_lock_access(uuid, uuid)
  to service_role;

create or replace function public.revoke_chat_lock_access(
  p_user_id uuid,
  p_auth_session_id uuid
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.conversation_lock_access
  where user_id = p_user_id
    and auth_session_id = p_auth_session_id;
$$;

revoke all on function public.revoke_chat_lock_access(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_chat_lock_access(uuid, uuid)
  to service_role;

create or replace function public.can_access_chat_conversation(
  p_user_id uuid,
  p_auth_session_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match
      on match.id = conversation.match_id
    where participant.conversation_id = p_conversation_id
      and participant.user_id = p_user_id
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
      and (
        participant.locked_at is null
        or exists (
          select 1
          from public.conversation_lock_access as access
          where access.user_id = p_user_id
            and access.auth_session_id = p_auth_session_id
            and access.expires_at > now()
        )
      )
  );
$$;

revoke all on function public.can_access_chat_conversation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_access_chat_conversation(uuid, uuid, uuid)
  to service_role;

create or replace function public.is_active_conversation_member(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match
      on match.id = conversation.match_id
    where participant.conversation_id = p_conversation_id
      and participant.user_id = auth.uid()
      and match.status = 'active'
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = auth.uid()::text
          and blocked.blocked_id = case
            when match.user_one_id = auth.uid()
              then match.user_two_id::text
            else match.user_one_id::text
          end)
           or (blocked.blocked_id = auth.uid()::text
          and blocked.blocker_id = case
            when match.user_one_id = auth.uid()
              then match.user_two_id::text
            else match.user_one_id::text
          end)
      )
      and (
        participant.locked_at is null
        or exists (
          select 1
          from public.conversation_lock_access as access
          where access.user_id = auth.uid()
            and access.auth_session_id::text = (auth.jwt() ->> 'session_id')
            and access.expires_at > now()
        )
      )
  );
$$;

revoke all on function public.is_active_conversation_member(uuid)
  from public, anon;
grant execute on function public.is_active_conversation_member(uuid)
  to authenticated, service_role;

create or replace function public.enforce_locked_conversation_message_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if new.sender_id <> auth.uid()
      or not public.is_active_conversation_member(new.conversation_id)
    then
      raise exception 'This conversation is not available.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_locked_conversation_message_access()
  from public, anon, authenticated;

drop trigger if exists enforce_locked_conversation_message_access
  on public.messages;
create trigger enforce_locked_conversation_message_access
  before insert on public.messages
  for each row
  execute function public.enforce_locked_conversation_message_access();

create or replace function public.set_conversation_locked(
  p_conversation_id uuid,
  p_locked boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_locked is null then
    raise exception 'Choose whether to lock this conversation.';
  end if;
  if not public.is_active_conversation_member(p_conversation_id) then
    raise exception 'This conversation is not available.';
  end if;
  if p_locked and not exists (
    select 1
    from public.conversation_lock_credentials
    where user_id = v_user_id
  ) then
    raise exception 'Set up your Lock Chats PIN before locking a conversation.';
  end if;

  update public.conversation_participants
  set locked_at = case when p_locked then now() else null end
  where conversation_id = p_conversation_id
    and user_id = v_user_id;

  if not found then
    raise exception 'This conversation is not available.';
  end if;

  if p_locked then
    begin
      v_session_id := (auth.jwt() ->> 'session_id')::uuid;
    exception when invalid_text_representation then
      v_session_id := null;
    end;
    if v_session_id is not null then
      delete from public.conversation_lock_access
      where user_id = v_user_id
        and auth_session_id = v_session_id;
    end if;
  end if;
end;
$$;

revoke all on function public.set_conversation_locked(uuid, boolean)
  from public, anon;
grant execute on function public.set_conversation_locked(uuid, boolean)
  to authenticated, service_role;

create or replace function public.set_chat_lock_pin(
  p_user_id uuid,
  p_pin text,
  p_recent_auth boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'Enter a valid six-digit Lock Chats PIN.';
  end if;

  if exists (
    select 1
    from public.conversation_lock_credentials
    where user_id = p_user_id
  ) and p_recent_auth is distinct from true then
    raise exception 'Recent account authentication is required to reset this PIN.';
  end if;

  insert into public.conversation_lock_credentials (
    user_id,
    pin_hash,
    failed_attempts,
    locked_until,
    updated_at
  )
  values (
    p_user_id,
    extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
    0,
    null,
    now()
  )
  on conflict (user_id) do update
  set pin_hash = excluded.pin_hash,
      failed_attempts = 0,
      locked_until = null,
      updated_at = now();

  delete from public.conversation_lock_access
  where user_id = p_user_id;
end;
$$;

revoke all on function public.set_chat_lock_pin(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_chat_lock_pin(uuid, text, boolean)
  to service_role;

create or replace function public.notify_member_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_sender_name text;
  v_message_context text;
begin
  select coalesce(
    nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
    'Someone'
  )
  into v_sender_name
  from public.dating_profiles as profile
  where profile.user_id = new.sender_id;
  v_sender_name := coalesce(v_sender_name, 'Someone');

  v_message_context := case
    when left(new.body, length('__veyra_view_once__:')) =
      '__veyra_view_once__:'
      then 'Sent you a View Once voice message. Open your conversation to listen.'
    when left(new.body, length('__veyra_attachment__:')) =
      '__veyra_attachment__:'
      then 'Sent you a photo or video. Open your conversation to view it.'
    when left(new.body, length('__veyra_reply__:')) =
      '__veyra_reply__:'
      then 'Replied to your message. Open your conversation to read it.'
    else 'Sent you a message. Open your conversation to read it.'
  end;

  for v_recipient_id in
    select participant.user_id
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match
      on match.id = conversation.match_id
    where participant.conversation_id = new.conversation_id
      and participant.user_id <> new.sender_id
      and participant.locked_at is null
      and match.status = 'active'
  loop
    perform public.emit_member_event_notification(
      v_recipient_id,
      'message',
      new.sender_id,
      'Message from ' || v_sender_name,
      v_sender_name || ' ' || lower(v_message_context)
    );
  end loop;

  return new;
end;
$$;

create or replace function public.get_my_member_notifications(
  p_limit integer default 50
)
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
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '28000';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Choose a valid notification page size.'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(notification)
    order by notification.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      notification.id,
      notification.title,
      notification.body,
      notification.link_url,
      notification.category,
      notification.created_at,
      notification.read_at,
      coalesce(
        nullif(btrim(staff.full_name), ''),
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'VEYRA Support'
      ) as from_name
    from public.member_notifications as notification
    left join public.staff_members as staff
      on staff.user_id = notification.created_by
    left join public.dating_profiles as profile
      on profile.user_id = notification.from_user_id
    where notification.user_id = current_user_id
      and not (
        notification.category is not distinct from 'messages'
        and notification.from_user_id is not null
        and exists (
          select 1
          from public.conversation_participants as participant
          join public.conversations as conversation
            on conversation.id = participant.conversation_id
          where participant.user_id = current_user_id
            and participant.locked_at is not null
            and conversation.match_id in (
              select match.id
              from public.matches as match
              where match.status = 'active'
                and (
                  (match.user_one_id = current_user_id
                    and match.user_two_id = notification.from_user_id)
                  or (match.user_two_id = current_user_id
                    and match.user_one_id = notification.from_user_id)
                )
            )
        )
      )
    order by notification.created_at desc
    limit p_limit
  ) as notification;
  return result;
end;
$$;

revoke all on function public.get_my_member_notifications(integer)
  from public, anon;
grant execute on function public.get_my_member_notifications(integer)
  to authenticated;

create or replace function public.get_my_unread_member_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  unread_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '28000';
  end if;

  select count(*)::integer
  into unread_count
  from public.member_notifications as notification
  where notification.user_id = current_user_id
    and notification.read_at is null
    and not (
      notification.category is not distinct from 'messages'
      and notification.from_user_id is not null
      and exists (
        select 1
        from public.conversation_participants as participant
        join public.conversations as conversation
          on conversation.id = participant.conversation_id
        where participant.user_id = current_user_id
          and participant.locked_at is not null
          and conversation.match_id in (
            select match.id
            from public.matches as match
            where match.status = 'active'
              and (
                (match.user_one_id = current_user_id
                  and match.user_two_id = notification.from_user_id)
                or (match.user_two_id = current_user_id
                  and match.user_one_id = notification.from_user_id)
              )
          )
      )
    );

  return unread_count;
end;
$$;

revoke all on function public.get_my_unread_member_notification_count()
  from public, anon;
grant execute on function public.get_my_unread_member_notification_count()
  to authenticated;
