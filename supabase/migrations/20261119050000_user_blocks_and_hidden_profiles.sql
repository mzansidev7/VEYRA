create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id text not null,
  blocked_id text not null,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

do $$
begin
  if to_regclass('public.user_blocks') is not null then
    insert into public.blocked_users (blocker_id, blocked_id, created_at)
    select user_id::text, blocked_user_id::text, created_at
    from public.user_blocks
    on conflict do nothing;

    drop table public.user_blocks;
  end if;
end
$$;

do $$
begin
  if
    to_regclass('public.hidden_profiles') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hidden_profiles'
        and column_name = 'hidden_user_id'
        and data_type = 'uuid'
    )
  then
    alter table public.hidden_profiles rename to hidden_profiles_legacy;
  end if;
end
$$;

create table if not exists public.hidden_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  hidden_user_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, hidden_user_id),
  check (user_id <> hidden_user_id)
);

do $$
begin
  if to_regclass('public.hidden_profiles_legacy') is not null then
    insert into public.hidden_profiles (user_id, hidden_user_id, created_at)
    select user_id::text, hidden_user_id::text, created_at
    from public.hidden_profiles_legacy
    on conflict do nothing;

    drop table public.hidden_profiles_legacy;
  end if;
end
$$;

alter table public.blocked_users enable row level security;
alter table public.hidden_profiles enable row level security;

drop policy if exists "Blockers can view their blocked users"
  on public.blocked_users;
create policy "Blockers can view their blocked users"
  on public.blocked_users
  for select
  to authenticated
  using (blocker_id = (select auth.uid())::text);

drop policy if exists "Blockers can create blocked users"
  on public.blocked_users;
create policy "Blockers can create blocked users"
  on public.blocked_users
  for insert
  to authenticated
  with check (
    blocker_id = (select auth.uid())::text
    and blocked_id <> blocker_id
  );

drop policy if exists "Blockers can delete blocked users"
  on public.blocked_users;
create policy "Blockers can delete blocked users"
  on public.blocked_users
  for delete
  to authenticated
  using (blocker_id = (select auth.uid())::text);

drop policy if exists "Users can view their hidden profiles"
  on public.hidden_profiles;
create policy "Users can view their hidden profiles"
  on public.hidden_profiles
  for select
  to authenticated
  using (user_id = (select auth.uid())::text);

drop policy if exists "Users can hide profiles"
  on public.hidden_profiles;
create policy "Users can hide profiles"
  on public.hidden_profiles
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())::text
    and hidden_user_id <> user_id
  );

drop policy if exists "Users can restore hidden profiles"
  on public.hidden_profiles;
create policy "Users can restore hidden profiles"
  on public.hidden_profiles
  for delete
  to authenticated
  using (user_id = (select auth.uid())::text);

grant select, insert, delete on public.blocked_users to authenticated;
grant select, insert, delete on public.hidden_profiles to authenticated;

create or replace function public.hidden_profile_exists(
  user_id text,
  hidden_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hidden_profiles
    where hidden_profiles.user_id = hidden_profile_exists.user_id
      and hidden_profiles.hidden_user_id = hidden_profile_exists.hidden_user_id
  );
$$;

revoke execute on function public.hidden_profile_exists(text, text) from public;
grant execute on function public.hidden_profile_exists(text, text) to authenticated;

create or replace function public.block_relationship_exists(
  first_user_id text,
  second_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocked_users
    where
      (blocker_id = first_user_id and blocked_id = second_user_id)
      or
      (blocker_id = second_user_id and blocked_id = first_user_id)
  );
$$;

revoke execute on function public.block_relationship_exists(text, text) from public;
grant execute on function public.block_relationship_exists(text, text) to authenticated;
