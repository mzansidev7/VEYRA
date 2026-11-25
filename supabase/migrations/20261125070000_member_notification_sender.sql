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
    select
      notification.id,
      notification.title,
      notification.body,
      notification.link_url,
      notification.created_at,
      notification.read_at,
      coalesce(nullif(btrim(staff.full_name), ''), 'VEYRA Support') as from_name
    from public.member_notifications as notification
    left join public.staff_members as staff
      on staff.user_id = notification.created_by
    where notification.user_id = current_user_id
    order by notification.created_at desc
    limit p_limit
  ) as notification;
  return result;
end;
$$;

revoke all on function public.get_my_member_notifications(integer)
  from public, anon;
grant execute on function public.get_my_member_notifications(integer)
  to authenticated;
