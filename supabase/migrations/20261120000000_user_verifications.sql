create table if not exists public.user_verifications (
  user_id text primary key,
  email_verified boolean not null default false,
  photo_verification_status text not null default 'not_started'
    check (photo_verification_status in (
      'not_started',
      'pending',
      'verified',
      'rejected',
      'review_required'
    )),
  identity_verification_status text not null default 'not_started'
    check (identity_verification_status in (
      'not_started',
      'pending',
      'verified',
      'rejected',
      'review_required'
    )),
  photo_verified_at timestamptz,
  identity_verified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_verifications enable row level security;

drop policy if exists "Users can view their own verification status"
  on public.user_verifications;
create policy "Users can view their own verification status"
  on public.user_verifications
  for select
  to authenticated
  using (user_id = (select auth.uid())::text);

revoke all on public.user_verifications from anon, authenticated;
grant select on public.user_verifications to authenticated;

create or replace function public.sync_user_verification_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_verifications (
    user_id,
    email_verified,
    updated_at
  )
  values (
    new.id::text,
    new.email_confirmed_at is not null,
    now()
  )
  on conflict (user_id) do update
  set
    email_verified = excluded.email_verified,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_user_verification_from_auth() from public;

drop trigger if exists sync_user_verification_after_auth_change
  on auth.users;
create trigger sync_user_verification_after_auth_change
  after insert or update
  on auth.users
  for each row
  execute function public.sync_user_verification_from_auth();

insert into public.user_verifications (
  user_id,
  email_verified,
  updated_at
)
select
  id::text,
  email_confirmed_at is not null,
  now()
from auth.users
on conflict (user_id) do update
set
  email_verified = excluded.email_verified,
  updated_at = now();
