alter table public.discovery_actions
  drop constraint if exists discovery_actions_source_check,
  add constraint discovery_actions_source_check
    check (source in ('daily_five', 'explore', 'likes', 'video_discovery'));

grant execute on function public.video_discovery_pair_is_eligible(uuid, uuid, text)
  to service_role;

create or replace function public.record_video_discovery_decision(
  p_user_id uuid,
  p_session_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.video_discovery_sessions%rowtype;
  v_target_user_id uuid;
begin
  if p_user_id is null or p_session_id is null or p_action is null
    or p_action not in ('like', 'pass') then
    raise exception 'Choose like or pass for this video conversation.';
  end if;

  select * into v_session
  from public.video_discovery_sessions
  where id = p_session_id
    and p_user_id in (user_one_id, user_two_id)
  for update;

  if not found
    or v_session.status <> 'ended'
    or v_session.connected_at is null then
    raise exception 'This video conversation is not ready for a decision.';
  end if;

  v_target_user_id := case
    when v_session.user_one_id = p_user_id then v_session.user_two_id
    else v_session.user_one_id
  end;

  if exists (
    select 1
    from public.blocked_users as blocked
    where (blocked.blocker_id = p_user_id::text
        and blocked.blocked_id = v_target_user_id::text)
      or (blocked.blocker_id = v_target_user_id::text
        and blocked.blocked_id = p_user_id::text)
  ) then
    raise exception 'This video connection is no longer available.';
  end if;

  insert into public.discovery_actions (
    user_id,
    target_user_id,
    action,
    source
  )
  values (p_user_id, v_target_user_id, p_action, 'video_discovery');

  return jsonb_build_object(
    'success', true,
    'action', p_action,
    'matched', exists (
      select 1
      from public.matches as match
      where match.status = 'active'
        and (
          (match.user_one_id = p_user_id
            and match.user_two_id = v_target_user_id)
          or (match.user_one_id = v_target_user_id
            and match.user_two_id = p_user_id)
        )
    )
  );
end;
$$;

revoke all on function public.record_video_discovery_decision(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_video_discovery_decision(uuid, uuid, text)
  to service_role;

create or replace function public.report_video_discovery_user(
  p_user_id uuid,
  p_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.video_discovery_sessions%rowtype;
  v_reported_user_id uuid;
  v_room_active boolean;
begin
  if p_user_id is null or p_session_id is null
    or p_reason is null
    or p_reason not in (
      'inappropriate',
      'harassment',
      'spam',
      'fake_profile',
      'other'
    ) then
    raise exception 'Choose a valid reason for reporting this member.';
  end if;

  select * into v_session
  from public.video_discovery_sessions
  where id = p_session_id
    and p_user_id in (user_one_id, user_two_id)
  for update;

  if not found then
    raise exception 'This Video Discovery session is unavailable.';
  end if;

  v_reported_user_id := case
    when v_session.user_one_id = p_user_id then v_session.user_two_id
    else v_session.user_one_id
  end;
  v_room_active := v_session.status in ('accepted', 'connected');

  insert into public.user_reports (
    reporter_id,
    reported_user_id,
    reason
  )
  values (p_user_id, v_reported_user_id, p_reason);

  insert into public.blocked_users (blocker_id, blocked_id)
  values (p_user_id::text, v_reported_user_id::text)
  on conflict (blocker_id, blocked_id) do nothing;

  if v_session.status in (
    'pending_acceptance',
    'accepted',
    'connected',
    'ended'
  ) then
    update public.video_discovery_sessions
    set status = case
          when status in ('pending_acceptance', 'accepted', 'connected')
            then 'ended'
          else status
        end,
        end_reason = 'reported',
        ended_at = case
          when status in ('pending_acceptance', 'accepted', 'connected')
            then now()
          else ended_at
        end
    where id = v_session.id;
  end if;

  if v_session.status in ('pending_acceptance', 'accepted', 'connected') then
    update public.video_discovery_queue as queue
    set status = case
          when queue.user_id = p_user_id then 'cancelled'
          when coalesce(privacy.video_discovery_enabled, false) then 'searching'
          else 'cancelled'
        end,
        session_id = null,
        queued_at = case
          when queue.user_id <> p_user_id
            and coalesce(privacy.video_discovery_enabled, false) then now()
          else queue.queued_at
        end,
        expires_at = case
          when queue.user_id <> p_user_id
            and coalesce(privacy.video_discovery_enabled, false)
            then now() + interval '3 minutes'
          else queue.expires_at
        end,
        updated_at = now()
    from public.user_privacy_settings as privacy
    where queue.session_id = v_session.id
      and privacy.user_id = queue.user_id;
  end if;

  return jsonb_build_object('success', true, 'room_active', v_room_active);
end;
$$;

revoke all on function public.report_video_discovery_user(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.report_video_discovery_user(uuid, uuid, text)
  to service_role;
