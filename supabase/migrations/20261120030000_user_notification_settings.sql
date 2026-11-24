create table if not exists public.user_notification_settings (
  user_id text primary key,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  new_likes boolean not null default true,
  new_matches boolean not null default true,
  daily_five boolean not null default true,
  profile_activity boolean not null default false,
  new_messages boolean not null default true,
  voice_messages boolean not null default true,
  date_invitations boolean not null default true,
  dating_reminders boolean not null default false,
  upcoming_dates boolean not null default true,
  verification_updates boolean not null default true,
  security_alerts boolean not null default true check (security_alerts),
  product_updates boolean not null default false,
  promotions boolean not null default false,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '07:00',
  show_notification_preview boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_notification_settings enable row level security;

drop policy if exists "Users can read their own notification settings"
  on public.user_notification_settings;
create policy "Users can read their own notification settings"
  on public.user_notification_settings
  for select
  to authenticated
  using (user_id = (select auth.uid())::text);

drop policy if exists "Users can create their own notification settings"
  on public.user_notification_settings;
create policy "Users can create their own notification settings"
  on public.user_notification_settings
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())::text
    and security_alerts
  );

drop policy if exists "Users can update their own notification settings"
  on public.user_notification_settings;
create policy "Users can update their own notification settings"
  on public.user_notification_settings
  for update
  to authenticated
  using (user_id = (select auth.uid())::text)
  with check (
    user_id = (select auth.uid())::text
    and security_alerts
  );

revoke all on public.user_notification_settings from anon, authenticated;
grant select, insert, update on public.user_notification_settings to authenticated;
