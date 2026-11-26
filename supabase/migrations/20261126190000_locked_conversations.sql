create extension if not exists pgcrypto with schema extensions;

alter table public.conversation_participants
  add column if not exists locked_at timestamptz;

create table if not exists public.conversation_lock_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text not null,
  failed_attempts smallint not null default 0
    check (failed_attempts between 0 and 4),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversation_lock_credentials enable row level security;
revoke all on public.conversation_lock_credentials from public, anon, authenticated;
grant all on public.conversation_lock_credentials to service_role;

create or replace function public.has_chat_lock_pin(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_lock_credentials
    where user_id = p_user_id
  );
$$;

revoke all on function public.has_chat_lock_pin(uuid) from public, anon, authenticated;
grant execute on function public.has_chat_lock_pin(uuid) to service_role;

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
end;
$$;

revoke all on function public.set_chat_lock_pin(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_chat_lock_pin(uuid, text, boolean)
  to service_role;

create or replace function public.verify_chat_lock_pin(
  p_user_id uuid,
  p_pin text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credential public.conversation_lock_credentials%rowtype;
  v_failed_attempts smallint;
begin
  if p_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into v_credential
  from public.conversation_lock_credentials
  where user_id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if v_credential.locked_until is not null
    and v_credential.locked_until > now() then
    raise exception 'Too many incorrect PIN attempts. Try again later.';
  end if;

  if p_pin is not null
    and p_pin ~ '^[0-9]{6}$'
    and extensions.crypt(p_pin, v_credential.pin_hash) = v_credential.pin_hash then
    update public.conversation_lock_credentials
    set failed_attempts = 0,
        locked_until = null,
        updated_at = now()
    where user_id = p_user_id;
    return true;
  end if;

  v_failed_attempts := v_credential.failed_attempts + 1;
  update public.conversation_lock_credentials
  set failed_attempts = case when v_failed_attempts >= 5 then 0
    else v_failed_attempts end,
      locked_until = case when v_failed_attempts >= 5
        then now() + interval '15 minutes'
        else null end,
      updated_at = now()
  where user_id = p_user_id;
  return false;
end;
$$;

revoke all on function public.verify_chat_lock_pin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_chat_lock_pin(uuid, text)
  to service_role;

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
end;
$$;

revoke all on function public.set_conversation_locked(uuid, boolean)
  from public, anon;
grant execute on function public.set_conversation_locked(uuid, boolean)
  to authenticated, service_role;
