create or replace function public.mark_my_member_notifications_read()
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
  where user_id = current_user_id
    and read_at is null;
end;
$$;

revoke all on function public.mark_my_member_notifications_read()
  from public, anon;
grant execute on function public.mark_my_member_notifications_read()
  to authenticated;
