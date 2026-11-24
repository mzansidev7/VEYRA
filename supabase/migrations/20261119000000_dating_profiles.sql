create table if not exists public.dating_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dating_profiles enable row level security;

drop policy if exists "Users can read their own dating profile"
  on public.dating_profiles;
create policy "Users can read their own dating profile"
  on public.dating_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own dating profile"
  on public.dating_profiles;
create policy "Users can create their own dating profile"
  on public.dating_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own dating profile"
  on public.dating_profiles;
create policy "Users can update their own dating profile"
  on public.dating_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.dating_profiles to authenticated;
