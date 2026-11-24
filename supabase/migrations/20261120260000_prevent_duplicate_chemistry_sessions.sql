create or replace function public.start_chemistry_session(
  p_match_id uuid,
  p_activity_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_other_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select case when match.user_one_id = v_user_id
    then match.user_two_id else match.user_one_id end
  into v_other_user_id
  from public.matches as match
  where match.id = p_match_id
    and match.status = 'active'
    and v_user_id in (match.user_one_id, match.user_two_id)
    and not exists (
      select 1 from public.blocked_users as blocked
      where (blocked.blocker_id = v_user_id::text
        and blocked.blocked_id = case when match.user_one_id = v_user_id
          then match.user_two_id::text else match.user_one_id::text end)
         or (blocked.blocked_id = v_user_id::text
        and blocked.blocker_id = case when match.user_one_id = v_user_id
          then match.user_two_id::text else match.user_one_id::text end)
    );

  if v_other_user_id is null then
    raise exception 'Chemistry is available only with an active, unblocked match.';
  end if;
  if not exists (
    select 1 from public.chemistry_activities
    where activity_key = p_activity_key
  ) then
    raise exception 'Choose an available Chemistry activity.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_match_id::text || ':' || p_activity_key, 0)
  );

  select session.id
  into v_session_id
  from public.chemistry_sessions as session
  where session.match_id = p_match_id
    and session.activity_key = p_activity_key
    and session.status = 'active'
  order by session.created_at desc
  limit 1;

  if v_session_id is not null then
    return v_session_id;
  end if;

  insert into public.chemistry_sessions(match_id, activity_key, started_by)
  values (p_match_id, p_activity_key, v_user_id)
  returning id into v_session_id;

  insert into public.chemistry_session_participants(session_id, user_id)
  values (v_session_id, v_user_id), (v_session_id, v_other_user_id);

  return v_session_id;
end;
$$;

revoke all on function public.start_chemistry_session(uuid, text)
  from public, anon;
grant execute on function public.start_chemistry_session(uuid, text)
  to authenticated;
