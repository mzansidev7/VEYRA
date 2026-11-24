create table if not exists public.user_privacy_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discoverable boolean not null default true,
  show_in_daily_five boolean not null default true,
  show_distance boolean not null default true,
  show_online_status boolean not null default false,
  show_last_active boolean not null default false,
  show_age boolean not null default true,
  show_city boolean not null default true,
  show_voice_intro boolean not null default true,
  show_compatibility_score boolean not null default true,
  show_verification_badge boolean not null default true,
  read_receipts boolean not null default true,
  allow_profile_sharing boolean not null default true,
  messages_from_matches_only boolean not null default true,
  allow_voice_messages boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_privacy_settings enable row level security;

drop policy if exists "Users can read their own privacy settings"
  on public.user_privacy_settings;
create policy "Users can read their own privacy settings"
  on public.user_privacy_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own privacy settings"
  on public.user_privacy_settings;
create policy "Users can create their own privacy settings"
  on public.user_privacy_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own privacy settings"
  on public.user_privacy_settings;
create policy "Users can update their own privacy settings"
  on public.user_privacy_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_privacy_settings to authenticated;
