create or replace function public.can_view_online_presence(
  p_target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_target_user_id = (select auth.uid())
    or exists (
    select 1
    from public.dating_profiles as viewer
    join auth.users as viewer_auth
      on viewer_auth.id = viewer.user_id
    join public.dating_profiles as candidate
      on candidate.user_id = p_target_user_id
    join auth.users as candidate_auth
      on candidate_auth.id = candidate.user_id
    left join public.user_privacy_settings as viewer_privacy
      on viewer_privacy.user_id = viewer.user_id
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    where viewer.user_id = (select auth.uid())
      and candidate.user_id <> viewer.user_id
      and coalesce(candidate_privacy.show_online_status, false)
      and (viewer_auth.banned_until is null or viewer_auth.banned_until <= now())
      and (
        candidate_auth.banned_until is null
        or candidate_auth.banned_until <= now()
      )
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = viewer.user_id::text
            and blocked.blocked_id = candidate.user_id::text)
          or (blocked.blocker_id = candidate.user_id::text
            and blocked.blocked_id = viewer.user_id::text)
      )
      and not exists (
        select 1
        from public.hidden_profiles as hidden
        where (hidden.user_id = viewer.user_id::text
            and hidden.hidden_user_id = candidate.user_id::text)
          or (hidden.user_id = candidate.user_id::text
            and hidden.hidden_user_id = viewer.user_id::text)
      )
      and (
        exists (
          select 1
          from public.matches as match
          where match.status = 'active'
            and (
              (match.user_one_id = viewer.user_id
                and match.user_two_id = candidate.user_id)
              or (match.user_one_id = candidate.user_id
                and match.user_two_id = viewer.user_id)
            )
        )
        or exists (
          select 1
          from public.video_discovery_sessions as session
          where session.status in (
              'pending_acceptance',
              'accepted',
              'connected'
            )
            and (
              (session.user_one_id = viewer.user_id
                and session.user_two_id = candidate.user_id)
              or (session.user_one_id = candidate.user_id
                and session.user_two_id = viewer.user_id)
            )
        )
        or exists (
          select 1
          from public.daily_recommendations as recommendation
          join public.daily_recommendation_sets as recommendation_set
            on recommendation_set.id = recommendation.set_id
          where recommendation.user_id = viewer.user_id
            and recommendation.recommended_user_id = candidate.user_id
            and recommendation_set.expires_at > now()
        )
        or exists (
          select 1
          from public.discovery_actions as action
          where action.action in ('like', 'superlike')
            and (
              (action.user_id = viewer.user_id
                and action.target_user_id = candidate.user_id)
              or (action.user_id = candidate.user_id
                and action.target_user_id = viewer.user_id)
            )
        )
        or (
          coalesce(candidate_privacy.discoverable, true)
          and (
            coalesce(candidate_privacy.show_in_daily_five, true)
            or coalesce(candidate_privacy.show_in_explore, true)
          )
          and public.video_discovery_profile_age(
            viewer.profile,
            coalesce(viewer_privacy.timezone, 'Africa/Johannesburg')
          ) >= 18
          and public.video_discovery_profile_age(
            candidate.profile,
            coalesce(viewer_privacy.timezone, 'Africa/Johannesburg')
          ) >= 18
          and (
            viewer.profile->'preferences'->'genders'
          ) ? case lower(candidate.profile->'profile'->>'gender')
            when 'woman' then 'Women'
            when 'man' then 'Men'
            when 'non-binary' then 'Non-binary people'
            else ''
          end
          and (
            candidate.profile->'preferences'->'genders'
          ) ? case lower(viewer.profile->'profile'->>'gender')
            when 'woman' then 'Women'
            when 'man' then 'Men'
            when 'non-binary' then 'Non-binary people'
            else ''
          end
          and public.video_discovery_profile_age(candidate.profile,
            coalesce(viewer_privacy.timezone, 'Africa/Johannesburg'))
            between public.video_discovery_profile_age_preference(
              viewer.profile,
              'minAge'
            ) and public.video_discovery_profile_age_preference(
              viewer.profile,
              'maxAge'
            )
          and public.video_discovery_profile_age(viewer.profile,
            coalesce(viewer_privacy.timezone, 'Africa/Johannesburg'))
            between public.video_discovery_profile_age_preference(
              candidate.profile,
              'minAge'
            ) and public.video_discovery_profile_age_preference(
              candidate.profile,
              'maxAge'
            )
          and (
            viewer.latitude is null
            or viewer.longitude is null
            or candidate.latitude is null
            or candidate.longitude is null
            or 6371 * 2 * asin(least(1, sqrt(
              power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
              + cos(radians(viewer.latitude))
                * cos(radians(candidate.latitude))
                * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
            ))) <= least(
              coalesce(viewer.explore_radius_km, 50),
              coalesce(candidate.explore_radius_km, 50)
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_view_online_presence(uuid)
  from public, anon;
grant execute on function public.can_view_online_presence(uuid)
  to authenticated;

drop policy if exists "Eligible members can read user online presence"
  on realtime.messages;
create policy "Eligible members can read user online presence"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and case
      when realtime.topic() ~ '^user-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_view_online_presence(
          split_part(realtime.topic(), ':', 2)::uuid
        )
      else false
    end
  );

drop policy if exists "Users can publish their own online presence"
  on realtime.messages;
create policy "Users can publish their own online presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and exists (
      select 1
      from public.user_privacy_settings as settings
      where settings.user_id = (select auth.uid())
        and settings.show_online_status
    )
    and case
      when realtime.topic() ~ '^user-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(realtime.topic(), ':', 2)::uuid = (select auth.uid())
      else false
    end
  );
