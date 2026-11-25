create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

alter table public.user_notification_devices
  add column if not exists platform text
    check (platform is null or platform in ('android', 'ios'));

alter table public.member_notifications
  add column if not exists category text not null default 'updates'
    check (category in ('updates', 'matches', 'messages', 'activity', 'account'));

alter table public.profile_views
  add column if not exists last_notified_at timestamptz;

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
      notification.category,
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

create or replace function public.emit_member_event_notification(
  p_user_id uuid,
  p_event_type text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
  v_notification_id uuid := gen_random_uuid();
  v_push_enabled boolean;
  v_in_app_enabled boolean;
  v_preview_enabled boolean;
  v_event_enabled boolean;
  v_push_title text;
  v_push_body text;
  v_device record;
  v_payload jsonb;
begin
  if p_user_id is null or p_event_type not in (
    'like', 'match', 'message', 'visitor', 'video', 'chemistry'
  ) then
    raise exception 'A valid member notification event is required.';
  end if;

  v_category := case p_event_type
    when 'like' then 'activity'
    when 'match' then 'matches'
    when 'message' then 'messages'
    when 'visitor' then 'activity'
    when 'video' then 'matches'
    when 'chemistry' then 'messages'
  end;

  select
    settings.push_enabled,
    settings.in_app_enabled,
    settings.show_notification_preview,
    case p_event_type
      when 'like' then settings.new_likes
      when 'match' then settings.new_matches
      when 'message' then settings.new_messages
      when 'visitor' then settings.profile_activity
      when 'video' then settings.new_matches
      when 'chemistry' then settings.new_messages
    end
  into
    v_push_enabled,
    v_in_app_enabled,
    v_preview_enabled,
    v_event_enabled
  from public.user_notification_settings as settings
  where settings.user_id = p_user_id::text;

  if not found then
    v_push_enabled := true;
    v_in_app_enabled := true;
    v_preview_enabled := true;
    v_event_enabled := p_event_type <> 'visitor';
  end if;

  if not v_event_enabled then
    return;
  end if;

  if v_in_app_enabled then
    insert into public.member_notifications (
      id,
      user_id,
      title,
      body,
      category
    )
    values (
      v_notification_id,
      p_user_id,
      p_title,
      p_body,
      v_category
    );
  end if;

  if not v_push_enabled then
    return;
  end if;

  v_push_title := case when v_preview_enabled then p_title else 'VEYRA' end;
  v_push_body := case
    when v_preview_enabled then p_body
    else 'You have a new notification.'
  end;

  for v_device in
    select device.expo_push_token, device.platform
    from public.user_notification_devices as device
    where device.user_id = p_user_id
  loop
    if v_device.platform = 'android' then
      v_payload := jsonb_build_object(
        'to', v_device.expo_push_token,
        'contentAvailable', true,
        'priority', 'high',
        'data', jsonb_build_object(
          'payload',
          jsonb_build_object(
            'id', v_notification_id,
            'type', 'member_event',
            'category', v_category,
            'title', v_push_title,
            'body', v_push_body
          )::text
        )
      );
    else
      v_payload := jsonb_build_object(
        'to', v_device.expo_push_token,
        'title', v_push_title,
        'body', v_push_body,
        'sound', 'default',
        'priority', 'high',
        'channelId', 'veyra_updates',
        'data', jsonb_build_object(
          'notificationId', v_notification_id,
          'category', v_category
        )
      );
    end if;

    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_payload,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 2000
    );
  end loop;
end;
$$;

revoke all on function public.emit_member_event_notification(
  uuid, text, text, text
) from public, anon, authenticated;

create or replace function public.notify_member_like_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' and not exists (
    select 1
    from public.likes as reciprocal
    where reciprocal.sender_id = new.receiver_id
      and reciprocal.receiver_id = new.sender_id
      and reciprocal.status in ('pending', 'matched')
  ) then
    perform public.emit_member_event_notification(
      new.receiver_id,
      'like',
      'Someone liked your profile',
      'Open VEYRA to see your likes.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_member_match_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform public.emit_member_event_notification(
      new.user_one_id,
      'match',
      'It''s a match!',
      'You have a new connection on VEYRA.'
    );
    perform public.emit_member_event_notification(
      new.user_two_id,
      'match',
      'It''s a match!',
      'You have a new connection on VEYRA.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_member_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
begin
  for v_recipient_id in
    select participant.user_id
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match
      on match.id = conversation.match_id
    where participant.conversation_id = new.conversation_id
      and participant.user_id <> new.sender_id
      and match.status = 'active'
  loop
    perform public.emit_member_event_notification(
      v_recipient_id,
      'message',
      'New message',
      'You have a new message in VEYRA.'
    );
  end loop;

  return new;
end;
$$;

create or replace function public.notify_member_profile_visitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_notified_at is not null
    and new.last_notified_at > now() - interval '24 hours' then
    return new;
  end if;

  update public.profile_views
  set last_notified_at = now()
  where viewer_id = new.viewer_id
    and viewed_user_id = new.viewed_user_id;

  perform public.emit_member_event_notification(
    new.viewed_user_id,
    'visitor',
    'Someone viewed your profile',
    'Open VEYRA to see your profile activity.'
  );

  return new;
end;
$$;

create or replace function public.notify_member_video_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending_acceptance' then
    perform public.emit_member_event_notification(
      case
        when new.initiated_by = new.user_one_id then new.user_two_id
        else new.user_one_id
      end,
      'video',
      'Video Discovery invitation',
      'Someone is ready to connect with you.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_member_chemistry_session_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
begin
  select case
    when match.user_one_id = new.started_by then match.user_two_id
    else match.user_one_id
  end
  into v_recipient_id
  from public.matches as match
  where match.id = new.match_id
    and match.status = 'active';

  if v_recipient_id is not null then
    perform public.emit_member_event_notification(
      v_recipient_id,
      'chemistry',
      'Your match started a Chemistry activity',
      'Open VEYRA to join the activity.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_member_chemistry_response_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
begin
  select case
    when match.user_one_id = new.user_id then match.user_two_id
    else match.user_one_id
  end
  into v_recipient_id
  from public.chemistry_sessions as session
  join public.matches as match on match.id = session.match_id
  where session.id = new.session_id
    and match.status = 'active';

  if v_recipient_id is not null then
    perform public.emit_member_event_notification(
      v_recipient_id,
      'chemistry',
      'Your match replied in Chemistry',
      'Open VEYRA to continue your activity.'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_member_like_event()
  from public, anon, authenticated;
revoke all on function public.notify_member_match_event()
  from public, anon, authenticated;
revoke all on function public.notify_member_message_event()
  from public, anon, authenticated;
revoke all on function public.notify_member_profile_visitor()
  from public, anon, authenticated;
revoke all on function public.notify_member_video_event()
  from public, anon, authenticated;
revoke all on function public.notify_member_chemistry_session_event()
  from public, anon, authenticated;
revoke all on function public.notify_member_chemistry_response_event()
  from public, anon, authenticated;

drop trigger if exists member_notification_on_like on public.likes;
create trigger member_notification_on_like
  after insert on public.likes
  for each row
  execute function public.notify_member_like_event();

drop trigger if exists member_notification_on_match on public.matches;
create trigger member_notification_on_match
  after insert on public.matches
  for each row
  execute function public.notify_member_match_event();

drop trigger if exists member_notification_on_message on public.messages;
create trigger member_notification_on_message
  after insert on public.messages
  for each row
  execute function public.notify_member_message_event();

drop trigger if exists member_notification_on_profile_view
  on public.profile_views;
create trigger member_notification_on_profile_view
  after insert or update of last_viewed_at on public.profile_views
  for each row
  execute function public.notify_member_profile_visitor();

drop trigger if exists member_notification_on_video_session
  on public.video_discovery_sessions;
create trigger member_notification_on_video_session
  after insert on public.video_discovery_sessions
  for each row
  execute function public.notify_member_video_event();

drop trigger if exists member_notification_on_chemistry_session
  on public.chemistry_sessions;
create trigger member_notification_on_chemistry_session
  after insert on public.chemistry_sessions
  for each row
  execute function public.notify_member_chemistry_session_event();

drop trigger if exists member_notification_on_chemistry_response
  on public.chemistry_responses;
create trigger member_notification_on_chemistry_response
  after insert on public.chemistry_responses
  for each row
  execute function public.notify_member_chemistry_response_event();
