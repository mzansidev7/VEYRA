alter table public.video_discovery_sessions
  add column if not exists source text not null default 'discovery'
  check (source in ('discovery', 'match'));

create or replace function public.video_discovery_pair_is_eligible(
  p_user_id uuid,
  p_candidate_id uuid,
  p_timezone text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dating_profiles as viewer
    join public.dating_profiles as candidate
      on candidate.user_id = p_candidate_id
    join auth.users as viewer_auth
      on viewer_auth.id = viewer.user_id
    join auth.users as candidate_auth
      on candidate_auth.id = candidate.user_id
    left join public.user_privacy_settings as viewer_privacy
      on viewer_privacy.user_id = viewer.user_id
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    cross join lateral (
      select
        case lower(candidate.profile->'profile'->>'gender')
          when 'woman' then 'Women'
          when 'man' then 'Men'
          when 'non-binary' then 'Non-binary people'
          else null
        end as candidate_gender_preference,
        case lower(viewer.profile->'profile'->>'gender')
          when 'woman' then 'Women'
          when 'man' then 'Men'
          when 'non-binary' then 'Non-binary people'
          else null
        end as viewer_gender_preference,
        case
          when viewer.latitude is null
            or viewer.longitude is null
            or candidate.latitude is null
            or candidate.longitude is null
            then null
          else 6371 * 2 * asin(least(1, sqrt(
            power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
            + cos(radians(viewer.latitude))
              * cos(radians(candidate.latitude))
              * power(
                sin(radians(candidate.longitude - viewer.longitude) / 2),
                2
              )
          )))
        end as distance_km
    ) as pair_data
    where viewer.user_id = p_user_id
      and viewer.user_id <> candidate.user_id
      and (viewer_auth.banned_until is null or viewer_auth.banned_until <= now())
      and (
        candidate_auth.banned_until is null
        or candidate_auth.banned_until <= now()
      )
      and coalesce(viewer_privacy.discoverable, true)
      and coalesce(viewer_privacy.show_in_explore, true)
      and coalesce(viewer_privacy.video_discovery_enabled, false)
      and coalesce(candidate_privacy.discoverable, true)
      and coalesce(candidate_privacy.show_in_explore, true)
      and coalesce(candidate_privacy.video_discovery_enabled, false)
      and nullif(btrim(viewer.profile->'profile'->>'nickname'), '') is not null
      and nullif(btrim(candidate.profile->'profile'->>'nickname'), '') is not null
      and public.video_discovery_profile_has_photo(
        viewer.profile,
        viewer.user_id
      )
      and public.video_discovery_profile_has_photo(
        candidate.profile,
        candidate.user_id
      )
      and public.video_discovery_profile_age(viewer.profile, p_timezone) >= 18
      and public.video_discovery_profile_age(candidate.profile, p_timezone) >= 18
      and (viewer.profile->'preferences'->'genders')
        ? pair_data.candidate_gender_preference
      and (candidate.profile->'preferences'->'genders')
        ? pair_data.viewer_gender_preference
      and public.video_discovery_profile_age(candidate.profile, p_timezone)
        between
          public.video_discovery_profile_age_preference(
            viewer.profile,
            'minAge'
          )
          and public.video_discovery_profile_age_preference(
            viewer.profile,
            'maxAge'
          )
      and public.video_discovery_profile_age(viewer.profile, p_timezone)
        between
          public.video_discovery_profile_age_preference(
            candidate.profile,
            'minAge'
          )
          and public.video_discovery_profile_age_preference(
            candidate.profile,
            'maxAge'
          )
      and pair_data.distance_km is not null
      and pair_data.distance_km <= least(
        200,
        coalesce(viewer.explore_radius_km, 200),
        coalesce(candidate.explore_radius_km, 200)
      )
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = p_candidate_id::text)
          or (blocked.blocker_id = p_candidate_id::text
            and blocked.blocked_id = p_user_id::text)
      )
      and not exists (
        select 1
        from public.hidden_profiles as hidden
        where (hidden.user_id = p_user_id::text
            and hidden.hidden_user_id = p_candidate_id::text)
          or (hidden.user_id = p_candidate_id::text
            and hidden.hidden_user_id = p_user_id::text)
      )
      and not exists (
        select 1
        from public.discovery_actions as action
        where (action.user_id = p_user_id
            and action.target_user_id = p_candidate_id)
          or (action.user_id = p_candidate_id
            and action.target_user_id = p_user_id)
      )
      and not exists (
        select 1
        from public.matches as match
        where match.status = 'active'
          and (
            (match.user_one_id = p_user_id
              and match.user_two_id = p_candidate_id)
            or (match.user_one_id = p_candidate_id
              and match.user_two_id = p_user_id)
          )
      )
      and not exists (
        select 1
        from public.video_discovery_sessions as previous_session
        where previous_session.status in ('declined', 'cancelled', 'expired')
          and previous_session.created_at > now() - interval '24 hours'
          and (
            (previous_session.user_one_id = p_user_id
              and previous_session.user_two_id = p_candidate_id)
            or (previous_session.user_one_id = p_candidate_id
              and previous_session.user_two_id = p_user_id)
          )
      )
  );
$$;

create or replace function public.join_video_discovery_queue(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue_id uuid;
  v_candidate_queue_id uuid;
  v_candidate_id uuid;
  v_session_id uuid;
  v_user_one_id uuid;
  v_user_two_id uuid;
  v_session_status text;
  v_expires_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'A user is required to join Video Discovery.';
  end if;
  if not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('veyra-video-discovery-queue'));

  update public.video_discovery_queue
  set status = 'expired', session_id = null, updated_at = now()
  where status = 'searching'
    and expires_at <= now();

  update public.video_discovery_sessions
  set status = 'expired', end_reason = 'expired', ended_at = now()
  where status in ('pending_acceptance', 'accepted')
    and expires_at <= now();

  update public.video_discovery_queue
  set status = 'expired', session_id = null, updated_at = now()
  where status = 'matched'
    and session_id in (
      select id
      from public.video_discovery_sessions
      where status = 'expired'
    );

  if not exists (
    select 1
    from public.dating_profiles as profile
    join public.user_privacy_settings as privacy
      on privacy.user_id = profile.user_id
    where profile.user_id = p_user_id
      and privacy.video_discovery_enabled
      and privacy.discoverable
      and privacy.show_in_explore
      and public.video_discovery_profile_age(profile.profile, p_timezone) >= 18
      and public.video_discovery_profile_has_photo(profile.profile, p_user_id)
  ) then
    raise exception
      'Enable Video Discovery and make sure your eligible adult profile is discoverable before searching.';
  end if;

  select session.id, session.status,
    case
      when session.user_one_id = p_user_id then session.user_two_id
      else session.user_one_id
    end
  into v_session_id, v_session_status, v_candidate_id
  from public.video_discovery_sessions as session
  where p_user_id in (session.user_one_id, session.user_two_id)
    and session.status in ('pending_acceptance', 'accepted', 'connected')
  order by session.created_at desc
  limit 1;

  if v_session_id is not null then
    return jsonb_build_object(
      'state', 'session',
      'session_id', v_session_id,
      'status', v_session_status,
      'other_user_id', v_candidate_id
    );
  end if;

  insert into public.video_discovery_queue (user_id)
  values (p_user_id)
  on conflict (user_id) where status = 'searching' do nothing;

  select id, expires_at into v_queue_id, v_expires_at
  from public.video_discovery_queue
  where user_id = p_user_id
    and status = 'searching'
    and expires_at > now();

  if v_queue_id is null then
    raise exception 'Could not add you to Video Discovery. Please try again.';
  end if;

  select candidate_queue.id, candidate.user_id
  into v_candidate_queue_id, v_candidate_id
  from public.dating_profiles as viewer
  join public.dating_profiles as candidate
    on candidate.user_id <> p_user_id
  left join public.video_discovery_queue as candidate_queue
    on candidate_queue.user_id = candidate.user_id
    and candidate_queue.status = 'searching'
    and candidate_queue.expires_at > now()
  where viewer.user_id = p_user_id
    and public.video_discovery_pair_is_eligible(
      p_user_id,
      candidate.user_id,
      p_timezone
    )
    and not exists (
      select 1
      from public.video_discovery_sessions as active_session
      where active_session.status in (
          'pending_acceptance',
          'accepted',
          'connected'
        )
        and (
          active_session.user_one_id in (p_user_id, candidate.user_id)
          or active_session.user_two_id in (p_user_id, candidate.user_id)
        )
    )
  order by
    (public.daily_five_compatibility(viewer.profile, candidate.profile)
      ->>'score')::integer desc nulls last,
    candidate_queue.queued_at asc nulls last,
    candidate.user_id
  limit 1;

  if v_candidate_id is null then
    return jsonb_build_object(
      'state', 'searching',
      'queue_id', v_queue_id,
      'expires_at', v_expires_at
    );
  end if;

  v_user_one_id := least(p_user_id, v_candidate_id);
  v_user_two_id := greatest(p_user_id, v_candidate_id);

  insert into public.video_discovery_sessions (
    user_one_id,
    user_two_id,
    initiated_by,
    source,
    expires_at
  )
  values (
    v_user_one_id,
    v_user_two_id,
    p_user_id,
    'discovery',
    now() + interval '45 seconds'
  )
  returning id, expires_at into v_session_id, v_expires_at;

  update public.video_discovery_queue
  set status = 'matched',
      session_id = v_session_id,
      expires_at = v_expires_at,
      updated_at = now()
  where id in (v_queue_id, v_candidate_queue_id);

  return jsonb_build_object(
    'state', 'session',
    'session_id', v_session_id,
    'status', 'pending_acceptance',
    'other_user_id', v_candidate_id,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.create_video_match_call_invitation(
  p_user_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_other_user_id uuid;
  v_session_id uuid;
  v_expires_at timestamptz;
  v_user_one_id uuid;
  v_user_two_id uuid;
begin
  if p_user_id is null or p_match_id is null then
    raise exception 'A valid match is required to request a video call.';
  end if;

  perform pg_advisory_xact_lock(hashtext('veyra-video-discovery-queue'));

  select case
      when match.user_one_id = p_user_id then match.user_two_id
      else match.user_one_id
    end
  into v_other_user_id
  from public.matches as match
  where match.id = p_match_id
    and match.status = 'active'
    and p_user_id in (match.user_one_id, match.user_two_id)
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_user_id::text
          and blocked.blocked_id = case
            when match.user_one_id = p_user_id
              then match.user_two_id::text
            else match.user_one_id::text
          end)
        or (blocked.blocker_id = case
            when match.user_one_id = p_user_id
              then match.user_two_id::text
            else match.user_one_id::text
          end
          and blocked.blocked_id = p_user_id::text)
    );

  if v_other_user_id is null then
    raise exception 'Video calls are only available for active, unblocked matches.';
  end if;

  if exists (
    select 1
    from public.video_discovery_sessions as session
    where p_user_id in (session.user_one_id, session.user_two_id)
      and session.status in ('pending_acceptance', 'accepted', 'connected')
  ) then
    raise exception 'End your other video invitation or call before starting another.';
  end if;

  if exists (
    select 1
    from public.video_discovery_sessions as previous
    where previous.source = 'match'
      and previous.initiated_by = p_user_id
      and previous.user_one_id = least(p_user_id, v_other_user_id)
      and previous.user_two_id = greatest(p_user_id, v_other_user_id)
      and previous.status = 'declined'
      and previous.created_at > now() - interval '1 minute'
  ) then
    raise exception 'Please wait a moment before requesting another call.';
  end if;

  v_user_one_id := least(p_user_id, v_other_user_id);
  v_user_two_id := greatest(p_user_id, v_other_user_id);

  insert into public.video_discovery_sessions (
    user_one_id,
    user_two_id,
    initiated_by,
    user_one_accepted,
    user_two_accepted,
    source,
    expires_at
  )
  values (
    v_user_one_id,
    v_user_two_id,
    p_user_id,
    p_user_id = v_user_one_id,
    p_user_id = v_user_two_id,
    'match',
    now() + interval '60 seconds'
  )
  returning id, expires_at into v_session_id, v_expires_at;

  return jsonb_build_object(
    'session_id', v_session_id,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.video_match_call_pair_is_eligible(
  p_user_id uuid,
  p_candidate_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and p_candidate_id is not null
    and p_user_id <> p_candidate_id
    and exists (
      select 1
      from public.matches as match
      where match.status = 'active'
        and (
          (match.user_one_id = p_user_id
            and match.user_two_id = p_candidate_id)
          or (match.user_one_id = p_candidate_id
            and match.user_two_id = p_user_id)
        )
    )
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_user_id::text
          and blocked.blocked_id = p_candidate_id::text)
        or (blocked.blocker_id = p_candidate_id::text
          and blocked.blocked_id = p_user_id::text)
    );
$$;

revoke all on function public.create_video_match_call_invitation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_video_match_call_invitation(uuid, uuid)
  to service_role;
revoke all on function public.video_match_call_pair_is_eligible(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.video_match_call_pair_is_eligible(uuid, uuid)
  to service_role;

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
      case
        when new.source = 'match' then 'Your match is requesting a video call'
        else 'Video Discovery invitation'
      end,
      case
        when new.source = 'match' then 'Open your conversation to accept or decline the call.'
        else 'Someone is ready to connect with you.'
      end
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_member_video_event()
  from public, anon, authenticated;
