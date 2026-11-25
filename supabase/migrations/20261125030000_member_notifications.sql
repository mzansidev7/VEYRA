create table if not exists public.user_notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique
    check (expo_push_token like 'ExponentPushToken[%]'
      or expo_push_token like 'ExpoPushToken[%]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notification_devices_user_id_idx
  on public.user_notification_devices (user_id);

alter table public.user_notification_devices enable row level security;
revoke all on public.user_notification_devices from public, anon, authenticated;
grant select, insert, update, delete on public.user_notification_devices
  to authenticated;
grant all on public.user_notification_devices to service_role;

drop policy if exists "Members manage their own notification devices"
  on public.user_notification_devices;
create policy "Members manage their own notification devices"
  on public.user_notification_devices
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.member_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists member_notifications_user_created_idx
  on public.member_notifications (user_id, created_at desc);

alter table public.member_notifications enable row level security;
revoke all on public.member_notifications from public, anon, authenticated;
grant all on public.member_notifications to service_role;

drop policy if exists "Members read their own notifications"
  on public.member_notifications;
create policy "Members read their own notifications"
  on public.member_notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

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
    select id, title, body, created_at, read_at
    from public.member_notifications
    where user_id = current_user_id
    order by created_at desc
    limit p_limit
  ) as notification;
  return result;
end;
$$;

create or replace function public.mark_my_member_notification_read(
  p_notification_id uuid
)
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
      using errcode = '28000';
  end if;
  update public.member_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id
    and user_id = current_user_id;
end;
$$;

revoke all on function public.get_my_member_notifications(integer)
  from public, anon;
revoke all on function public.mark_my_member_notification_read(uuid)
  from public, anon;
grant execute on function public.get_my_member_notifications(integer)
  to authenticated;
grant execute on function public.mark_my_member_notification_read(uuid)
  to authenticated;
