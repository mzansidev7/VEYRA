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

alter table public.user_verifications
  drop column if exists phone_verified;
