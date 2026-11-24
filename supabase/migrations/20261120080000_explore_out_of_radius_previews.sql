create or replace function public.get_explore_feed_with_fallback(
  p_user_id uuid,
  p_timezone text,
  p_radius_km integer,
  p_intention text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_feed jsonb;
  v_remaining integer;
  v_has_location boolean;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;
  if p_radius_km is null or p_radius_km not between 5 and 200 then
    raise exception 'Explore radius must be between 5 and 200 km.';
  end if;

  select exists (
    select 1
    from public.dating_profiles
    where user_id = p_user_id
      and latitude is not null
      and longitude is not null
  ) into v_has_location;

  select greatest(
    0,
    20 - count(*)::integer
  )
  into v_remaining
  from public.discovery_actions
  where user_id = p_user_id
    and source = 'explore'
    and created_at >= (
      date_trunc('day', now() at time zone p_timezone) at time zone p_timezone
    );

  with viewer as (
    select
      dating_profile.profile,
      dating_profile.latitude,
      dating_profile.longitude,
      (dating_profile.profile->'profile'->>'gender') as gender,
      (dating_profile.profile->'preferences'->>'minAge')::integer as min_age,
      (dating_profile.profile->'preferences'->>'maxAge')::integer as max_age,
      (dating_profile.profile->'profile'->>'birthday')::date as birthday
    from public.dating_profiles as dating_profile
    where dating_profile.user_id = p_user_id
      and dating_profile.latitude is not null
      and dating_profile.longitude is not null
  ),
  eligible as (
    select
      candidate.user_id,
      candidate.profile,
      candidate_privacy.show_age,
      candidate_privacy.show_city,
      candidate_privacy.show_distance,
      candidate_privacy.show_verification_badge,
      candidate_privacy.show_compatibility_score,
      public.daily_five_compatibility(viewer.profile, candidate.profile)
        as compatibility,
      6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
        + cos(radians(viewer.latitude))
          * cos(radians(candidate.latitude))
          * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
      ))) as exact_distance_km
    from public.dating_profiles as candidate
    cross join viewer
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    where candidate.user_id <> p_user_id
      and candidate.latitude is not null
      and candidate.longitude is not null
      and coalesce(candidate_privacy.discoverable, true)
      and coalesce(candidate_privacy.show_in_explore, true)
      and nullif(candidate.profile->'profile'->>'nickname', '') is not null
      and (viewer.profile->'preferences'->'genders')
        ? case lower(candidate.profile->'profile'->>'gender')
            when 'woman' then 'Women'
            when 'man' then 'Men'
            when 'non-binary' then 'Non-binary people'
            else null
          end
      and (candidate.profile->'preferences'->'genders')
        ? case lower(viewer.gender)
            when 'woman' then 'Women'
            when 'man' then 'Men'
            when 'non-binary' then 'Non-binary people'
            else null
          end
      and extract(year from age(
        (now() at time zone p_timezone)::date,
        (candidate.profile->'profile'->>'birthday')::date
      )) between viewer.min_age and viewer.max_age
      and extract(year from age(
        (now() at time zone p_timezone)::date,
        viewer.birthday
      )) between
        (candidate.profile->'preferences'->>'minAge')::integer
        and (candidate.profile->'preferences'->>'maxAge')::integer
      and (p_intention is null
        or candidate.profile->'intentions' ? p_intention)
      and jsonb_typeof(candidate.profile->'profile'->'photos') = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(candidate.profile->'profile'->'photos') = 'array'
              then candidate.profile->'profile'->'photos'
            else '[]'::jsonb
          end
        ) as photo(path)
        where photo.path like candidate.user_id::text || '/%'
      )
      and not exists (
        select 1
        from public.discovery_actions as action
        where action.user_id = p_user_id
          and action.target_user_id = candidate.user_id
      )
      and not exists (
        select 1
        from public.daily_recommendations as recommendation
        join public.daily_recommendation_sets as recommendation_set
          on recommendation_set.id = recommendation.set_id
        where recommendation.user_id = p_user_id
          and recommendation.recommended_user_id = candidate.user_id
          and recommendation.status = 'pending'
          and recommendation_set.expires_at > now()
      )
      and not exists (
        select 1
        from public.hidden_profiles as hidden
        where hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = candidate.user_id::text
      )
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = p_user_id::text
          and blocked.blocked_id = candidate.user_id::text)
          or (blocked.blocker_id = candidate.user_id::text
          and blocked.blocked_id = p_user_id::text)
      )
  ),
  feed_mode as (
    select
      v_has_location
        and not exists (
          select 1
          from eligible
          where exact_distance_km <= p_radius_km
        ) as out_of_radius
  ),
  selected as (
    select
      eligible.*,
      feed_mode.out_of_radius,
      round(eligible.exact_distance_km)::integer as distance_km
    from eligible
    cross join feed_mode
    where (
      not feed_mode.out_of_radius
      and eligible.exact_distance_km <= p_radius_km
    ) or (
      feed_mode.out_of_radius
      and eligible.exact_distance_km > 200
    )
    order by random()
    limit case when (select out_of_radius from feed_mode) then 5
      else v_remaining end
  ),
  cards as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'candidate_id', selected.user_id,
      'nickname', selected.profile->'profile'->>'nickname',
      'age', case when coalesce(selected.show_age, true) then
        extract(year from age(
          (now() at time zone p_timezone)::date,
          (selected.profile->'profile'->>'birthday')::date
        ))::integer else null end,
      'city', case when coalesce(selected.show_city, true)
        then selected.profile->'profile'->>'city' else null end,
      'distance_km', case
        when not selected.out_of_radius
          and coalesce(selected.show_distance, true)
          then selected.distance_km
        else null
      end,
      'bio', selected.profile->'profile'->>'bio',
      'occupation', selected.profile->'profile'->>'occupation',
      'interests', coalesce(
        selected.profile->'profile'->'interests',
        '[]'::jsonb
      ),
      'intentions', coalesce(selected.profile->'intentions', '[]'::jsonb),
      'out_of_radius', selected.out_of_radius,
      'photo_path', (
        select photo.path
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(selected.profile->'profile'->'photos') = 'array'
              then selected.profile->'profile'->'photos'
            else '[]'::jsonb
          end
        ) as photo(path)
        where photo.path like selected.user_id::text || '/%'
        limit 1
      ),
      'identity_verified', coalesce(selected.show_verification_badge, true)
        and exists (
          select 1 from public.user_verifications as verification
          where verification.user_id = selected.user_id::text
            and verification.identity_verification_status = 'verified'
        ),
      'compatibility_score', case
        when coalesce(selected.show_compatibility_score, true)
          then selected.compatibility->'score'
        else null
      end,
      'compatibility_confidence', case
        when coalesce(selected.show_compatibility_score, true)
          then selected.compatibility->'confidence'
        else null
      end,
      'compatibility_breakdown', case
        when coalesce(selected.show_compatibility_score, true)
          and selected.compatibility->>'score' is not null
          then jsonb_build_object(
            'version', 1,
            'relationship_intentions', selected.compatibility->'relationship_intentions',
            'core_values', selected.compatibility->'core_values',
            'lifestyle', selected.compatibility->'lifestyle',
            'dating_dna', selected.compatibility->'dating_dna',
            'shared_interests', selected.compatibility->'shared_interests',
            'communication', selected.compatibility->'communication'
          )
        else null
      end
    ) order by selected.distance_km, random()), '[]'::jsonb) as profiles
    from selected
  )
  select jsonb_build_object(
    'profiles', cards.profiles,
    'remaining_decisions', v_remaining,
    'daily_limit', 20,
    'out_of_radius', feed_mode.out_of_radius
  )
  into v_feed
  from cards
  cross join feed_mode;

  return coalesce(v_feed, jsonb_build_object(
    'profiles', '[]'::jsonb,
    'remaining_decisions', v_remaining,
    'daily_limit', 20,
    'out_of_radius', false
  ));
end;
$$;

revoke all on function public.get_explore_feed_with_fallback(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.get_explore_feed_with_fallback(uuid, text, integer, text)
  to service_role;
