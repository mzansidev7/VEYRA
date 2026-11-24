create or replace view public.verified_identity_badges
with (security_invoker = false, security_barrier = true)
as
select user_id
from public.user_verifications
where identity_verification_status = 'verified';

comment on view public.verified_identity_badges is
  'Exposes only user IDs whose identity verification was approved by a trusted process.';

revoke all on public.verified_identity_badges from anon, authenticated;
grant select on public.verified_identity_badges to authenticated;
