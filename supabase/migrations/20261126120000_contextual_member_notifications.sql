alter table public.member_notifications
  add column if not exists from_user_id uuid
    references auth.users (id) on delete set null;

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
      coalesce(
        nullif(btrim(staff.full_name), ''),
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'VEYRA Support'
      ) as from_name
    from public.member_notifications as notification
    left join public.staff_members as staff
      on staff.user_id = notification.created_by
    left join public.dating_profiles as profile
      on profile.user_id = notification.from_user_id
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
  p_actor_user_id uuid,
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
  v_actor_name text;
  v_push_title text;
  v_push_body text;
  v_device record;
  v_payload jsonb;
begin
  if p_user_id is null
    or p_actor_user_id is null
    or p_event_type not in (
      'like', 'match', 'message', 'visitor', 'video', 'chemistry'
    )
  then
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
  select coalesce(
    nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
    'A VEYRA member'
  )
  into v_actor_name
  from public.dating_profiles as profile
  where profile.user_id = p_actor_user_id;
  v_actor_name := coalesce(v_actor_name, 'A VEYRA member');

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
      from_user_id,
      title,
      body,
      category
    )
    values (
      v_notification_id,
      p_user_id,
      p_actor_user_id,
      left(p_title, 100),
      left(p_body, 1000),
      v_category
    );
  end if;

  if not v_push_enabled then
    return;
  end if;

  v_push_title := case
    when v_preview_enabled then left(p_title, 100)
    else 'VEYRA'
  end;
  v_push_body := case
    when v_preview_enabled then left(p_body, 1000)
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
        'channelId', 'veyra_' || v_category,
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
  uuid, text, uuid, text, text
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
      new.sender_id,
      'New like from ' || coalesce((
        select nullif(btrim(profile.profile->'profile'->>'nickname'), '')
        from public.dating_profiles as profile
        where profile.user_id = new.sender_id
      ), 'a VEYRA member'),
      coalesce((
        select nullif(btrim(profile.profile->'profile'->>'nickname'), '')
        from public.dating_profiles as profile
        where profile.user_id = new.sender_id
      ), 'Someone') || ' liked your profile. Open Likes to view their profile.'
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
declare
  v_user_id uuid;
  v_match_user_id uuid;
  v_match_name text;
begin
  if new.status = 'active' then
    foreach v_user_id in array array[new.user_one_id, new.user_two_id]
    loop
      v_match_user_id := case
        when v_user_id = new.user_one_id then new.user_two_id
        else new.user_one_id
      end;
      select coalesce(
        nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
        'your match'
      )
      into v_match_name
      from public.dating_profiles as profile
      where profile.user_id = v_match_user_id;
      v_match_name := coalesce(v_match_name, 'your match');

      perform public.emit_member_event_notification(
        v_user_id,
        'match',
        v_match_user_id,
        'You matched with ' || v_match_name,
        'You and ' || v_match_name || ' liked each other. Start a conversation!'
      );
    end loop;
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
  v_sender_name text;
  v_message_context text;
begin
  select coalesce(
    nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
    'Someone'
  )
  into v_sender_name
  from public.dating_profiles as profile
  where profile.user_id = new.sender_id;
  v_sender_name := coalesce(v_sender_name, 'Someone');

  v_message_context := case
    when left(new.body, length('__veyra_view_once__:')) =
      '__veyra_view_once__:'
      then 'Sent you a View Once voice message. Open your conversation to listen.'
    when left(new.body, length('__veyra_attachment__:')) =
      '__veyra_attachment__:'
      then 'Sent you a photo or video. Open your conversation to view it.'
    when left(new.body, length('__veyra_reply__:')) =
      '__veyra_reply__:'
      then 'Replied to your message. Open your conversation to read it.'
    else 'Sent you a message. Open your conversation to read it.'
  end;

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
      new.sender_id,
      'Message from ' || v_sender_name,
      v_sender_name || ' ' || lower(v_message_context)
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
declare
  v_viewer_name text;
begin
  if new.last_notified_at is not null
    and new.last_notified_at > now() - interval '24 hours' then
    return new;
  end if;

  update public.profile_views
  set last_notified_at = now()
  where viewer_id = new.viewer_id
    and viewed_user_id = new.viewed_user_id;

  select coalesce(
    nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
    'Someone'
  )
  into v_viewer_name
  from public.dating_profiles as profile
  where profile.user_id = new.viewer_id;
  v_viewer_name := coalesce(v_viewer_name, 'Someone');

  perform public.emit_member_event_notification(
    new.viewed_user_id,
    'visitor',
    new.viewer_id,
    v_viewer_name || ' viewed your profile',
    v_viewer_name || ' visited your profile. Open profile activity to learn more.'
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
declare
  v_recipient_id uuid;
  v_initiator_name text;
begin
  if new.status = 'pending_acceptance' then
    v_recipient_id := case
      when new.initiated_by = new.user_one_id then new.user_two_id
      else new.user_one_id
    end;
    select coalesce(
      nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
      'Someone'
    )
    into v_initiator_name
    from public.dating_profiles as profile
    where profile.user_id = new.initiated_by;
    v_initiator_name := coalesce(v_initiator_name, 'Someone');

    perform public.emit_member_event_notification(
      v_recipient_id,
      'video',
      new.initiated_by,
      case
        when new.source = 'match' then
          'Video call request from ' || v_initiator_name
        else
          'Video invitation from ' || v_initiator_name
      end,
      case
        when new.source = 'match' then
          v_initiator_name || ' wants to start a video call. Open your conversation to respond.'
        else
          v_initiator_name || ' invited you to connect on Video Discovery.'
      end
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
  v_starter_name text;
begin
  select
    case
      when match.user_one_id = new.started_by then match.user_two_id
      else match.user_one_id
    end,
    coalesce(
      nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
      'Your match'
    )
  into v_recipient_id, v_starter_name
  from public.matches as match
  left join public.dating_profiles as profile
    on profile.user_id = new.started_by
  where match.id = new.match_id
    and match.status = 'active';

  if v_recipient_id is not null then
    perform public.emit_member_event_notification(
      v_recipient_id,
      'chemistry',
      new.started_by,
      v_starter_name || ' started a Chemistry activity',
      v_starter_name || ' invited you to join a Chemistry activity.'
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
  v_responder_name text;
begin
  select
    case
      when match.user_one_id = new.user_id then match.user_two_id
      else match.user_one_id
    end,
    coalesce(
      nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
      'Your match'
    )
  into v_recipient_id, v_responder_name
  from public.chemistry_sessions as session
  join public.matches as match on match.id = session.match_id
  left join public.dating_profiles as profile
    on profile.user_id = new.user_id
  where session.id = new.session_id
    and match.status = 'active';

  if v_recipient_id is not null then
    perform public.emit_member_event_notification(
      v_recipient_id,
      'chemistry',
      new.user_id,
      v_responder_name || ' replied in Chemistry',
      v_responder_name || ' replied to your Chemistry activity. Open it to continue.'
    );
  end if;

  return new;
end;
$$;
