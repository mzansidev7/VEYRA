alter table public.user_notification_settings
  alter column product_updates set default true,
  alter column promotions set default true;

create or replace function public.get_my_unread_member_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  unread_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '28000';
  end if;

  select count(*)::integer
  into unread_count
  from public.member_notifications
  where user_id = current_user_id
    and read_at is null;

  return unread_count;
end;
$$;

revoke all on function public.get_my_unread_member_notification_count()
  from public, anon;
grant execute on function public.get_my_unread_member_notification_count()
  to authenticated;
