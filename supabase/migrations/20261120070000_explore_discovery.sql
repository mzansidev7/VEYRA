alter table public.dating_profiles
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_source text not null default 'manual',
  add column if not exists province text not null default '',
  add column if not exists country text not null default 'South Africa',
  add column if not exists explore_radius_km integer not null default 50;

alter table public.user_privacy_settings
  add column if not exists show_in_explore boolean not null default true;

alter table public.dating_profiles
  drop constraint if exists dating_profiles_location_source_check,
  add constraint dating_profiles_location_source_check
    check (location_source in ('manual', 'gps')),
  drop constraint if exists dating_profiles_latitude_range_check,
  add constraint dating_profiles_latitude_range_check
    check (latitude is null or latitude between -90 and 90),
  drop constraint if exists dating_profiles_longitude_range_check,
  add constraint dating_profiles_longitude_range_check
    check (longitude is null or longitude between -180 and 180),
  drop constraint if exists dating_profiles_explore_radius_km_check,
  add constraint dating_profiles_explore_radius_km_check
    check (explore_radius_km between 5 and 200);

update public.dating_profiles
set
  province = case lower(profile->'profile'->>'city')
    when 'johannesburg' then 'Gauteng'
    when 'pretoria' then 'Gauteng'
    when 'bloemfontein' then 'Free State'
    when 'durban' then 'KwaZulu-Natal'
    when 'cape town' then 'Western Cape'
    when 'gqeberha' then 'Eastern Cape'
    when 'port elizabeth' then 'Eastern Cape'
    when 'east london' then 'Eastern Cape'
    when 'kimberley' then 'Northern Cape'
    when 'polokwane' then 'Limpopo'
    when 'nelspruit' then 'Mpumalanga'
    when 'mbombela' then 'Mpumalanga'
    when 'rustenburg' then 'North West'
    when 'george' then 'Western Cape'
    when 'stellenbosch' then 'Western Cape'
    when 'pietermaritzburg' then 'KwaZulu-Natal'
    when 'soweto' then 'Gauteng'
    when 'midrand' then 'Gauteng'
    when 'sandton' then 'Gauteng'
    when 'centurion' then 'Gauteng'
    when 'benoni' then 'Gauteng'
    when 'welkom' then 'Free State'
    when 'mthatha' then 'Eastern Cape'
    when 'mahikeng' then 'North West'
    else province
  end,
  latitude = case when latitude is not null then latitude else case lower(profile->'profile'->>'city')
    when 'johannesburg' then -26.2041
    when 'pretoria' then -25.7479
    when 'bloemfontein' then -29.0852
    when 'durban' then -29.8587
    when 'cape town' then -33.9249
    when 'gqeberha' then -33.9608
    when 'port elizabeth' then -33.9608
    when 'east london' then -33.0153
    when 'kimberley' then -28.7282
    when 'polokwane' then -23.9045
    when 'nelspruit' then -25.4753
    when 'mbombela' then -25.4753
    when 'rustenburg' then -25.6676
    when 'george' then -33.963
    when 'stellenbosch' then -33.9321
    when 'pietermaritzburg' then -29.6006
    when 'soweto' then -26.2485
    when 'midrand' then -25.9992
    when 'sandton' then -26.1076
    when 'centurion' then -25.8603
    when 'benoni' then -26.1885
    when 'welkom' then -27.9774
    when 'mthatha' then -31.5889
    when 'mahikeng' then -25.8652
    else null
  end end,
  longitude = case when longitude is not null then longitude else case lower(profile->'profile'->>'city')
    when 'johannesburg' then 28.0473
    when 'pretoria' then 28.2293
    when 'bloemfontein' then 26.1596
    when 'durban' then 31.0218
    when 'cape town' then 18.4241
    when 'gqeberha' then 25.6022
    when 'port elizabeth' then 25.6022
    when 'east london' then 27.9116
    when 'kimberley' then 24.7499
    when 'polokwane' then 29.4689
    when 'nelspruit' then 30.9694
    when 'mbombela' then 30.9694
    when 'rustenburg' then 27.2421
    when 'george' then 22.4617
    when 'stellenbosch' then 18.8602
    when 'pietermaritzburg' then 30.3794
    when 'soweto' then 27.854
    when 'midrand' then 28.1263
    when 'sandton' then 28.0567
    when 'centurion' then 28.1894
    when 'benoni' then 28.3208
    when 'welkom' then 26.7351
    when 'mthatha' then 28.7844
    when 'mahikeng' then 25.6442
    else null
  end end,
  country = coalesce(nullif(profile->'profile'->>'country', ''), 'South Africa'),
  explore_radius_km = coalesce(
    nullif(profile->'preferences'->>'exploreRadiusKm', '')::integer,
    explore_radius_km,
    50
  );

alter table public.discovery_actions
  add column if not exists source text not null default 'daily_five';

alter table public.discovery_actions
  drop constraint if exists discovery_actions_source_check,
  add constraint discovery_actions_source_check
    check (source in ('daily_five', 'explore'));

create or replace function public.get_explore_feed(
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
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;
  if p_radius_km is null or p_radius_km not between 5 and 200 then
    raise exception 'Explore radius must be between 5 and 200 km.';
  end if;

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
      round(6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
        + cos(radians(viewer.latitude))
          * cos(radians(candidate.latitude))
          * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
      ))))::integer as distance_km
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
      and 6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
        + cos(radians(viewer.latitude))
          * cos(radians(candidate.latitude))
          * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
      ))) <= p_radius_km
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
  cards as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'candidate_id', eligible.user_id,
      'nickname', eligible.profile->'profile'->>'nickname',
      'age', case when coalesce(eligible.show_age, true) then
        extract(year from age(
          (now() at time zone p_timezone)::date,
          (eligible.profile->'profile'->>'birthday')::date
        ))::integer else null end,
      'city', case when coalesce(eligible.show_city, true)
        then eligible.profile->'profile'->>'city' else null end,
      'distance_km', case when coalesce(eligible.show_distance, true)
        then eligible.distance_km else null end,
      'bio', eligible.profile->'profile'->>'bio',
      'occupation', eligible.profile->'profile'->>'occupation',
      'interests', coalesce(
        eligible.profile->'profile'->'interests',
        '[]'::jsonb
      ),
      'intentions', coalesce(eligible.profile->'intentions', '[]'::jsonb),
      'photo_path', (
        select photo.path
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(eligible.profile->'profile'->'photos') = 'array'
              then eligible.profile->'profile'->'photos'
            else '[]'::jsonb
          end
        ) as photo(path)
        where photo.path like eligible.user_id::text || '/%'
        limit 1
      ),
      'identity_verified', coalesce(eligible.show_verification_badge, true)
        and exists (
          select 1 from public.user_verifications as verification
          where verification.user_id = eligible.user_id::text
            and verification.identity_verification_status = 'verified'
        ),
      'compatibility_score', case
        when coalesce(eligible.show_compatibility_score, true)
          then eligible.compatibility->'score'
        else null
      end,
      'compatibility_confidence', case
        when coalesce(eligible.show_compatibility_score, true)
          then eligible.compatibility->'confidence'
        else null
      end,
      'compatibility_breakdown', case
        when coalesce(eligible.show_compatibility_score, true)
          and eligible.compatibility->>'score' is not null
          then jsonb_build_object(
            'version', 1,
            'relationship_intentions', eligible.compatibility->'relationship_intentions',
            'core_values', eligible.compatibility->'core_values',
            'lifestyle', eligible.compatibility->'lifestyle',
            'dating_dna', eligible.compatibility->'dating_dna',
            'shared_interests', eligible.compatibility->'shared_interests',
            'communication', eligible.compatibility->'communication'
          )
        else null
      end
    ) order by eligible.distance_km, random()), '[]'::jsonb) as profiles
    from (
      select * from eligible
      order by distance_km, random()
      limit v_remaining
    ) as eligible
  )
  select jsonb_build_object(
    'profiles', cards.profiles,
    'remaining_decisions', v_remaining,
    'daily_limit', 20
  )
  into v_feed
  from cards;

  return coalesce(v_feed, jsonb_build_object(
    'profiles', '[]'::jsonb,
    'remaining_decisions', v_remaining,
    'daily_limit', 20
  ));
end;
$$;

revoke all on function public.get_explore_feed(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.get_explore_feed(uuid, text, integer, text)
  to service_role;

create or replace function public.record_explore_action(
  p_user_id uuid,
  p_target_user_id uuid,
  p_action text,
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
  v_action_count integer;
begin
  if p_action not in ('like', 'superlike', 'pass') then
    raise exception 'Unsupported Explore action.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;
  if p_radius_km is null or p_radius_km not between 5 and 200 then
    raise exception 'Explore radius must be between 5 and 200 km.';
  end if;
  if p_user_id = p_target_user_id then
    raise exception 'You cannot take action on your own profile.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select count(*)::integer into v_action_count
  from public.discovery_actions
  where user_id = p_user_id
    and source = 'explore'
    and created_at >= (
      date_trunc('day', now() at time zone p_timezone) at time zone p_timezone
    );
  if v_action_count >= 20 then
    raise exception 'You’ve reached today’s Explore limit. Come back tomorrow.';
  end if;

  if exists (
    select 1 from public.discovery_actions
    where user_id = p_user_id and target_user_id = p_target_user_id
  ) then
    raise exception 'You’ve already viewed this profile.';
  end if;

  if not exists (
    select 1
    from public.dating_profiles as viewer
    join public.dating_profiles as candidate
      on candidate.user_id = p_target_user_id
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    where viewer.user_id = p_user_id
      and viewer.latitude is not null
      and viewer.longitude is not null
      and candidate.latitude is not null
      and candidate.longitude is not null
      and coalesce(candidate_privacy.discoverable, true)
      and coalesce(candidate_privacy.show_in_explore, true)
      and nullif(candidate.profile->'profile'->>'nickname', '') is not null
      and candidate.profile->'profile'->>'gender' is not null
      and extract(year from age(
        (now() at time zone p_timezone)::date,
        (candidate.profile->'profile'->>'birthday')::date
      )) between
        (viewer.profile->'preferences'->>'minAge')::integer
        and (viewer.profile->'preferences'->>'maxAge')::integer
      and extract(year from age(
        (now() at time zone p_timezone)::date,
        (viewer.profile->'profile'->>'birthday')::date
      )) between
        (candidate.profile->'preferences'->>'minAge')::integer
        and (candidate.profile->'preferences'->>'maxAge')::integer
      and (viewer.profile->'preferences'->'genders')
        ? case lower(candidate.profile->'profile'->>'gender')
            when 'woman' then 'Women'
            when 'man' then 'Men'
            when 'non-binary' then 'Non-binary people'
            else null
          end
      and (candidate.profile->'preferences'->'genders')
        ? case lower(viewer.profile->'profile'->>'gender')
            when 'woman' then 'Women'
            when 'man' then 'Men'
            when 'non-binary' then 'Non-binary people'
            else null
          end
      and (p_intention is null
        or candidate.profile->'intentions' ? p_intention)
      and 6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
        + cos(radians(viewer.latitude))
          * cos(radians(candidate.latitude))
          * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
      ))) <= p_radius_km
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
        select 1 from public.hidden_profiles as hidden
        where hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = p_target_user_id::text
      )
      and not exists (
        select 1 from public.blocked_users as blocked
        where (blocked.blocker_id = p_user_id::text
          and blocked.blocked_id = p_target_user_id::text)
          or (blocked.blocker_id = p_target_user_id::text
          and blocked.blocked_id = p_user_id::text)
      )
      and not exists (
        select 1
        from public.daily_recommendations as recommendation
        join public.daily_recommendation_sets as recommendation_set
          on recommendation_set.id = recommendation.set_id
        where recommendation.user_id = p_user_id
          and recommendation.recommended_user_id = p_target_user_id
          and recommendation.status = 'pending'
          and recommendation_set.expires_at > now()
      )
  ) then
    raise exception 'This profile is no longer available.';
  end if;

  insert into public.discovery_actions (
    user_id,
    target_user_id,
    action,
    source
  )
  values (p_user_id, p_target_user_id, p_action, 'explore');

  return jsonb_build_object(
    'success', true,
    'action', p_action,
    'remaining_decisions', 19 - v_action_count
  );
end;
$$;

revoke all on function public.record_explore_action(uuid, uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_explore_action(uuid, uuid, text, text, integer, text)
  to service_role;

create or replace function public.ensure_daily_five(
  p_user_id uuid,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_local_now timestamp without time zone;
  v_cycle_date date;
  v_expires_at timestamptz;
  v_set_id uuid;
  v_profile jsonb;
  v_selected_count integer;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  insert into public.user_privacy_settings (user_id, timezone)
  values (p_user_id, p_timezone)
  on conflict (user_id) do update
    set timezone = excluded.timezone
    where public.user_privacy_settings.timezone
      is distinct from excluded.timezone;

  select profile into v_profile
  from public.dating_profiles
  where user_id = p_user_id;

  if v_profile is null then
    raise exception 'A completed dating profile is required for Discovery.';
  end if;

  select id into v_set_id
  from public.daily_recommendation_sets
  where user_id = p_user_id
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_set_id is not null then
    return v_set_id;
  end if;

  update public.daily_recommendations as recommendation
  set status = 'archived'
  from public.daily_recommendation_sets as recommendation_set
  where recommendation.set_id = recommendation_set.id
    and recommendation.user_id = p_user_id
    and recommendation_set.expires_at <= now()
    and recommendation.status = 'pending';

  v_local_now := now() at time zone p_timezone;
  v_cycle_date := case
    when v_local_now::time >= time '05:00'
      then v_local_now::date
    else v_local_now::date - 1
  end;
  v_expires_at :=
    ((v_cycle_date + 1)::timestamp + time '05:00') at time zone p_timezone;

  insert into public.daily_recommendation_sets (
    user_id,
    recommendation_date,
    expires_at
  )
  values (p_user_id, v_cycle_date, v_expires_at)
  on conflict (user_id, recommendation_date) do nothing
  returning id into v_set_id;

  if v_set_id is null then
    select id into v_set_id
    from public.daily_recommendation_sets
    where user_id = p_user_id
      and recommendation_date = v_cycle_date;
    return v_set_id;
  end if;

  with viewer as (
    select
      profile,
      latitude,
      longitude,
      explore_radius_km,
      (profile->'profile'->>'gender') as gender,
      (profile->'preferences'->>'minAge')::integer as min_age,
      (profile->'preferences'->>'maxAge')::integer as max_age,
      (profile->'profile'->>'birthday')::date as birthday
    from public.dating_profiles
    where user_id = p_user_id
  ),
  eligible as (
    select
      candidate.user_id,
      candidate.profile,
      public.daily_five_compatibility(
        viewer.profile,
        candidate.profile
      ) as compatibility
    from public.dating_profiles as candidate
    cross join viewer
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    where candidate.user_id <> p_user_id
      and candidate.latitude is not null
      and candidate.longitude is not null
      and 6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
        + cos(radians(viewer.latitude))
          * cos(radians(candidate.latitude))
          * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
      ))) <= viewer.explore_radius_km
      and coalesce(candidate_privacy.discoverable, true)
      and coalesce(candidate_privacy.show_in_daily_five, true)
      and nullif(candidate.profile->'profile'->>'nickname', '') is not null
      and candidate.profile->'profile'->>'gender' is not null
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
        v_local_now::date,
        (candidate.profile->'profile'->>'birthday')::date
      )) between viewer.min_age and viewer.max_age
      and extract(year from age(
        v_local_now::date,
        viewer.birthday
      )) between
        (candidate.profile->'preferences'->>'minAge')::integer
        and (candidate.profile->'preferences'->>'maxAge')::integer
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
        from public.hidden_profiles as hidden
        where hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = candidate.user_id::text
      )
      and not exists (
        select 1
        from public.blocked_users as blocked
        where
          (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = candidate.user_id::text)
          or
          (blocked.blocker_id = candidate.user_id::text
            and blocked.blocked_id = p_user_id::text)
      )
  ),
  ranked as (
    select
      user_id,
      compatibility,
      floor(((compatibility->>'score')::numeric + 2.5) / 5) as score_band,
      gen_random_uuid() as variety_order
    from eligible
    where compatibility->>'score' is not null
  ),
  selected as (
    select
      user_id,
      compatibility,
      row_number() over (
        order by score_band desc, variety_order
      )::smallint as position
    from ranked
    order by score_band desc, variety_order
    limit 5
  )
  insert into public.daily_recommendations (
    set_id,
    user_id,
    recommended_user_id,
    position,
    compatibility_score,
    compatibility_confidence,
    compatibility_version,
    relationship_intentions_score,
    core_values_score,
    lifestyle_score,
    dating_dna_score,
    shared_interests_score,
    communication_score
  )
  select
    v_set_id,
    p_user_id,
    selected.user_id,
    selected.position,
    (selected.compatibility->>'score')::integer,
    (selected.compatibility->>'confidence')::integer,
    1,
    nullif(selected.compatibility->>'relationship_intentions', '')::integer,
    nullif(selected.compatibility->>'core_values', '')::integer,
    nullif(selected.compatibility->>'lifestyle', '')::integer,
    nullif(selected.compatibility->>'dating_dna', '')::integer,
    nullif(selected.compatibility->>'shared_interests', '')::integer,
    nullif(selected.compatibility->>'communication', '')::integer
  from selected;

  get diagnostics v_selected_count = row_count;
  update public.daily_recommendation_sets
  set selected_count = v_selected_count
  where id = v_set_id;

  return v_set_id;
end;
$$;

revoke all on function public.ensure_daily_five(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ensure_daily_five(uuid, text)
  to service_role;
