alter table public.user_privacy_settings
  add column if not exists timezone text not null default 'Africa/Johannesburg';

create or replace function public.validate_user_privacy_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'A valid IANA timezone is required.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_user_privacy_timezone() from public, anon, authenticated;

drop trigger if exists user_privacy_settings_timezone_valid
  on public.user_privacy_settings;
create trigger user_privacy_settings_timezone_valid
  before insert or update of timezone
  on public.user_privacy_settings
  for each row
  execute function public.validate_user_privacy_timezone();

create table if not exists public.daily_recommendation_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recommendation_date date not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  selected_count integer not null default 0 check (selected_count between 0 and 5),
  unique (user_id, recommendation_date)
);

create index if not exists daily_recommendation_sets_active_idx
  on public.daily_recommendation_sets (user_id, expires_at desc);

create table if not exists public.daily_recommendations (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.daily_recommendation_sets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  recommended_user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  compatibility_score integer not null
    check (compatibility_score between 0 and 100),
  compatibility_confidence integer not null
    check (compatibility_confidence between 1 and 100),
  compatibility_version smallint not null default 1
    check (compatibility_version > 0),
  relationship_intentions_score integer
    check (relationship_intentions_score between 0 and 100),
  core_values_score integer
    check (core_values_score between 0 and 100),
  lifestyle_score integer
    check (lifestyle_score between 0 and 100),
  dating_dna_score integer
    check (dating_dna_score between 0 and 100),
  shared_interests_score integer
    check (shared_interests_score between 0 and 100),
  communication_score integer
    check (communication_score between 0 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'liked', 'superliked', 'passed', 'archived')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (set_id, recommended_user_id),
  unique (set_id, position),
  check (user_id <> recommended_user_id)
);

create index if not exists daily_recommendations_user_set_idx
  on public.daily_recommendations (user_id, set_id, status);

create index if not exists blocked_users_reverse_lookup_idx
  on public.blocked_users (blocked_id, blocker_id);

create table if not exists public.discovery_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('like', 'superlike', 'pass')),
  created_at timestamptz not null default now(),
  unique (user_id, target_user_id),
  check (user_id <> target_user_id)
);

create index if not exists discovery_actions_likes_idx
  on public.discovery_actions (user_id, created_at desc)
  where action in ('like', 'superlike');

alter table public.daily_recommendation_sets enable row level security;
alter table public.daily_recommendations enable row level security;
alter table public.discovery_actions enable row level security;

revoke all on public.daily_recommendation_sets from anon, authenticated;
revoke all on public.daily_recommendations from anon, authenticated;
revoke all on public.discovery_actions from anon, authenticated;
grant all on public.daily_recommendation_sets to service_role;
grant all on public.daily_recommendations to service_role;
grant all on public.discovery_actions to service_role;

create or replace function public.daily_five_overlap_score(
  p_first jsonb,
  p_second jsonb
)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  with first_values as (
    select distinct lower(btrim(value)) as value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_first) = 'array' then p_first
        else '[]'::jsonb
      end
    ) as entry(value)
    where btrim(value) <> ''
  ),
  second_values as (
    select distinct lower(btrim(value)) as value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_second) = 'array' then p_second
        else '[]'::jsonb
      end
    ) as entry(value)
    where btrim(value) <> ''
  ),
  overlap as (
    select
      (select count(*) from first_values) as first_count,
      (select count(*) from second_values) as second_count,
      (
        select count(*)
        from first_values
        join second_values using (value)
      ) as shared_count
  )
  select case
    when first_count = 0 or second_count = 0 then null
    else round(
      100.0 * shared_count
        / (first_count + second_count - shared_count)
    )::integer
  end
  from overlap;
$$;

create or replace function public.daily_five_lifestyle_score(
  p_first jsonb,
  p_second jsonb
)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  with answers as (
    select
      nullif(lower(btrim(p_first->'profile'->>field)), '') as first_answer,
      nullif(lower(btrim(p_second->'profile'->>field)), '') as second_answer
    from unnest(array['exercise', 'smoking', 'drinking', 'children', 'pets'])
      as fields(field)
  ),
  scored as (
    select case when first_answer = second_answer then 100 else 0 end as score
    from answers
    where first_answer is not null and second_answer is not null
  )
  select round(avg(score))::integer
  from scored;
$$;

create or replace function public.daily_five_lifestyle_answer_count(
  p_first jsonb,
  p_second jsonb
)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from unnest(array['exercise', 'smoking', 'drinking', 'children', 'pets'])
    as fields(field)
  where nullif(lower(btrim(p_first->'profile'->>field)), '') is not null
    and nullif(lower(btrim(p_second->'profile'->>field)), '') is not null;
$$;

create or replace function public.daily_five_compatibility(
  p_first jsonb,
  p_second jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  with scores as (
    select
      public.daily_five_overlap_score(
        p_first->'intentions',
        p_second->'intentions'
      ) as relationship_intentions,
      public.daily_five_overlap_score(
        p_first->'datingDNA'->'values',
        p_second->'datingDNA'->'values'
      ) as core_values,
      public.daily_five_lifestyle_score(p_first, p_second) as lifestyle,
      public.daily_five_overlap_score(
        p_first->'datingDNA'->'relationshipGoals',
        p_second->'datingDNA'->'relationshipGoals'
      ) as dating_dna,
      public.daily_five_lifestyle_answer_count(
        p_first,
        p_second
      ) as lifestyle_answer_count,
      public.daily_five_overlap_score(
        p_first->'profile'->'interests',
        p_second->'profile'->'interests'
      ) as shared_interests,
      case
        when nullif(btrim(p_first->'datingDNA'->>'communicationStyle'), '')
          is null
          or nullif(btrim(p_second->'datingDNA'->>'communicationStyle'), '')
            is null
          then null
        when lower(btrim(p_first->'datingDNA'->>'communicationStyle'))
          = lower(btrim(p_second->'datingDNA'->>'communicationStyle'))
          then 100
        else 0
      end as communication
  ),
  weighted as (
    select dimensions.score, dimensions.effective_weight
    from scores
    cross join lateral (values
      (
        scores.relationship_intentions,
        case when scores.relationship_intentions is null then 0 else 25 end
      ),
      (scores.core_values, case when scores.core_values is null then 0 else 25 end),
      (scores.lifestyle, 3 * scores.lifestyle_answer_count),
      (scores.dating_dna, case when scores.dating_dna is null then 0 else 15 end),
      (
        scores.shared_interests,
        case when scores.shared_interests is null then 0 else 10 end
      ),
      (scores.communication, case when scores.communication is null then 0 else 10 end)
    ) as dimensions(score, effective_weight)
  )
  select jsonb_build_object(
    'score',
    round(
      sum(score::numeric * effective_weight)
        filter (where score is not null and effective_weight > 0)
      / nullif(
        (
          sum(effective_weight)
          filter (where score is not null and effective_weight > 0)
        )::numeric,
        0
      )
    )::integer,
    'confidence',
    sum(effective_weight)
      filter (where score is not null and effective_weight > 0),
    'relationship_intentions', max(scores.relationship_intentions),
    'core_values', max(scores.core_values),
    'lifestyle', max(scores.lifestyle),
    'dating_dna', max(scores.dating_dna),
    'shared_interests', max(scores.shared_interests),
    'communication', max(scores.communication)
  )
  from scores
  cross join weighted;
$$;

revoke all on function public.daily_five_overlap_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.daily_five_lifestyle_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.daily_five_lifestyle_answer_count(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.daily_five_compatibility(jsonb, jsonb) from public, anon, authenticated;

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
  v_timezone text;
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
          candidate.profile->'profile'->'photos'
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

revoke all on function public.ensure_daily_five(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_daily_five(uuid, text) to service_role;

create or replace function public.get_daily_five_feed(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set_id uuid;
  v_feed jsonb;
begin
  v_set_id := public.ensure_daily_five(p_user_id, p_timezone);

  with active_set as (
    select *
    from public.daily_recommendation_sets
    where id = v_set_id
  ),
  visible_recommendations as (
    select
      recommendation.id,
      recommendation.position,
      recommendation.status,
      recommendation.created_at,
      candidate.user_id as candidate_id,
      candidate.profile,
      coalesce(candidate_privacy.show_age, true) as show_age,
      coalesce(candidate_privacy.show_city, true) as show_city,
      coalesce(candidate_privacy.show_verification_badge, true)
        as show_verification_badge,
      coalesce(candidate_privacy.show_compatibility_score, true)
        as show_compatibility_score,
      recommendation.compatibility_score,
      recommendation.compatibility_confidence,
      recommendation.compatibility_version,
      recommendation.relationship_intentions_score,
      recommendation.core_values_score,
      recommendation.lifestyle_score,
      recommendation.dating_dna_score,
      recommendation.shared_interests_score,
      recommendation.communication_score
    from public.daily_recommendations as recommendation
    join public.dating_profiles as candidate
      on candidate.user_id = recommendation.recommended_user_id
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    where recommendation.set_id = v_set_id
      and recommendation.status = 'pending'
      and coalesce(candidate_privacy.discoverable, true)
      and coalesce(candidate_privacy.show_in_daily_five, true)
      and not exists (
        select 1
        from public.hidden_profiles as hidden
        where hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = recommendation.recommended_user_id::text
      )
      and not exists (
        select 1
        from public.blocked_users as blocked
        where
          (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = recommendation.recommended_user_id::text)
          or
          (blocked.blocker_id = recommendation.recommended_user_id::text
            and blocked.blocked_id = p_user_id::text)
      )
  ),
  user_likes as (
    select
      action.id,
      action.action,
      action.created_at,
      candidate.user_id as candidate_id,
      candidate.profile,
      coalesce(candidate_privacy.show_age, true) as show_age,
      coalesce(candidate_privacy.show_city, true) as show_city,
      coalesce(candidate_privacy.show_verification_badge, true)
        as show_verification_badge,
      coalesce(candidate_privacy.show_compatibility_score, true)
        as show_compatibility_score,
      recommendation_score.compatibility_score,
      recommendation_score.compatibility_confidence,
      recommendation_score.compatibility_version,
      recommendation_score.relationship_intentions_score,
      recommendation_score.core_values_score,
      recommendation_score.lifestyle_score,
      recommendation_score.dating_dna_score,
      recommendation_score.shared_interests_score,
      recommendation_score.communication_score
    from public.discovery_actions as action
    join public.dating_profiles as candidate
      on candidate.user_id = action.target_user_id
    left join public.user_privacy_settings as candidate_privacy
      on candidate_privacy.user_id = candidate.user_id
    left join lateral (
      select
        recommendation.compatibility_score,
        recommendation.compatibility_confidence,
        recommendation.compatibility_version,
        recommendation.relationship_intentions_score,
        recommendation.core_values_score,
        recommendation.lifestyle_score,
        recommendation.dating_dna_score,
        recommendation.shared_interests_score,
        recommendation.communication_score
      from public.daily_recommendations as recommendation
      where recommendation.user_id = action.user_id
        and recommendation.recommended_user_id = action.target_user_id
      order by recommendation.created_at desc
      limit 1
    ) as recommendation_score on true
    where action.user_id = p_user_id
      and action.action in ('like', 'superlike')
      and not exists (
        select 1
        from public.blocked_users as blocked
        where
          (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = action.target_user_id::text)
          or
          (blocked.blocker_id = action.target_user_id::text
            and blocked.blocked_id = p_user_id::text)
      )
  ),
  make_recommendations as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'recommendation_id', recommendation.id,
      'candidate_id', recommendation.candidate_id,
      'nickname', recommendation.profile->'profile'->>'nickname',
      'age', case when recommendation.show_age then
        extract(year from age(
          (now() at time zone p_timezone)::date,
          (recommendation.profile->'profile'->>'birthday')::date
        ))::integer
        else null end,
      'city', case when recommendation.show_city
        then recommendation.profile->'profile'->>'city'
        else null end,
      'bio', recommendation.profile->'profile'->>'bio',
      'occupation', recommendation.profile->'profile'->>'occupation',
      'interests', coalesce(
        recommendation.profile->'profile'->'interests',
        '[]'::jsonb
      ),
      'intentions', coalesce(
        recommendation.profile->'intentions',
        '[]'::jsonb
      ),
      'photo_path', (
        select photo.path
        from jsonb_array_elements_text(
          recommendation.profile->'profile'->'photos'
        ) as photo(path)
        where photo.path like recommendation.candidate_id::text || '/%'
        limit 1
      ),
      'identity_verified', recommendation.show_verification_badge
        and exists (
          select 1 from public.user_verifications as verification
          where verification.user_id = recommendation.candidate_id::text
            and verification.identity_verification_status = 'verified'
        ),
      'compatibility_score', case
        when recommendation.show_compatibility_score
          then recommendation.compatibility_score
        else null
      end,
      'compatibility_confidence', case
        when recommendation.show_compatibility_score
          then recommendation.compatibility_confidence
        else null
      end,
      'compatibility_breakdown', case
        when recommendation.show_compatibility_score then jsonb_build_object(
          'version', recommendation.compatibility_version,
          'relationship_intentions', recommendation.relationship_intentions_score,
          'core_values', recommendation.core_values_score,
          'lifestyle', recommendation.lifestyle_score,
          'dating_dna', recommendation.dating_dna_score,
          'shared_interests', recommendation.shared_interests_score,
          'communication', recommendation.communication_score
        )
        else null
      end
    ) order by recommendation.position), '[]'::jsonb) as records
    from visible_recommendations as recommendation
  ),
  make_likes as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'candidate_id', liked.candidate_id,
      'nickname', liked.profile->'profile'->>'nickname',
      'age', case when liked.show_age then
        extract(year from age(
          (now() at time zone p_timezone)::date,
          (liked.profile->'profile'->>'birthday')::date
        ))::integer
        else null end,
      'city', case when liked.show_city
        then liked.profile->'profile'->>'city'
        else null end,
      'bio', liked.profile->'profile'->>'bio',
      'occupation', liked.profile->'profile'->>'occupation',
      'interests', coalesce(
        liked.profile->'profile'->'interests',
        '[]'::jsonb
      ),
      'intentions', coalesce(liked.profile->'intentions', '[]'::jsonb),
      'photo_path', (
        select photo.path
        from jsonb_array_elements_text(
          liked.profile->'profile'->'photos'
        ) as photo(path)
        where photo.path like liked.candidate_id::text || '/%'
        limit 1
      ),
      'identity_verified', liked.show_verification_badge
        and exists (
          select 1 from public.user_verifications as verification
          where verification.user_id = liked.candidate_id::text
            and verification.identity_verification_status = 'verified'
        ),
      'action', liked.action,
      'compatibility_score', case
        when liked.show_compatibility_score then liked.compatibility_score
        else null
      end,
      'compatibility_confidence', case
        when liked.show_compatibility_score
          then liked.compatibility_confidence
        else null
      end,
      'compatibility_breakdown', case
        when liked.show_compatibility_score then jsonb_build_object(
          'version', liked.compatibility_version,
          'relationship_intentions', liked.relationship_intentions_score,
          'core_values', liked.core_values_score,
          'lifestyle', liked.lifestyle_score,
          'dating_dna', liked.dating_dna_score,
          'shared_interests', liked.shared_interests_score,
          'communication', liked.communication_score
        )
        else null
      end
    ) order by liked.created_at desc), '[]'::jsonb) as records
    from user_likes as liked
  )
  select jsonb_build_object(
    'recommendations', make_recommendations.records,
    'likes', make_likes.records,
    'selected_count', active_set.selected_count,
    'explored_count', greatest(
      active_set.selected_count - (
        select count(*)::integer
        from visible_recommendations
      ),
      0
    ),
    'expires_at', active_set.expires_at
  )
  into v_feed
  from active_set
  cross join make_recommendations
  cross join make_likes;

  return coalesce(v_feed, jsonb_build_object(
    'recommendations', '[]'::jsonb,
    'likes', '[]'::jsonb,
    'selected_count', 0,
    'explored_count', 0,
    'expires_at', null
  ));
end;
$$;

revoke all on function public.get_daily_five_feed(uuid, text) from public, anon, authenticated;
grant execute on function public.get_daily_five_feed(uuid, text) to service_role;

create or replace function public.record_daily_five_action(
  p_user_id uuid,
  p_recommendation_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recommendation public.daily_recommendations%rowtype;
  v_existing_action text;
  v_status text;
begin
  if p_action not in ('like', 'superlike', 'pass') then
    raise exception 'Unsupported Discovery action.';
  end if;

  select action into v_existing_action
  from public.discovery_actions
  where user_id = p_user_id
    and target_user_id = (
      select recommended_user_id
      from public.daily_recommendations
      where id = p_recommendation_id
        and user_id = p_user_id
    );

  if v_existing_action is not null then
    if v_existing_action <> p_action then
      raise exception 'A different action was already recorded for this profile.';
    end if;
    return jsonb_build_object('success', true, 'action', v_existing_action);
  end if;

  select recommendation.* into v_recommendation
  from public.daily_recommendations as recommendation
  join public.daily_recommendation_sets as recommendation_set
    on recommendation_set.id = recommendation.set_id
  where recommendation.id = p_recommendation_id
    and recommendation.user_id = p_user_id
    and recommendation.status = 'pending'
    and recommendation_set.expires_at > now()
  for update of recommendation;

  if not found then
    raise exception 'This Daily 5 profile is no longer available.';
  end if;

  if exists (
    select 1
    from public.hidden_profiles as hidden
    where hidden.user_id = p_user_id::text
      and hidden.hidden_user_id = v_recommendation.recommended_user_id::text
  ) or exists (
    select 1
    from public.blocked_users as blocked
    where
      (blocked.blocker_id = p_user_id::text
        and blocked.blocked_id = v_recommendation.recommended_user_id::text)
      or
      (blocked.blocker_id = v_recommendation.recommended_user_id::text
        and blocked.blocked_id = p_user_id::text)
  ) or exists (
    select 1
    from public.user_privacy_settings as privacy
    where privacy.user_id = v_recommendation.recommended_user_id
      and (
        not privacy.discoverable
        or not privacy.show_in_daily_five
      )
  ) then
    raise exception 'This profile is no longer available.';
  end if;

  insert into public.discovery_actions (user_id, target_user_id, action)
  values (
    p_user_id,
    v_recommendation.recommended_user_id,
    p_action
  );

  v_status := case p_action
    when 'like' then 'liked'
    when 'superlike' then 'superliked'
    else 'passed'
  end;

  update public.daily_recommendations
  set status = v_status, decided_at = now()
  where id = p_recommendation_id;

  return jsonb_build_object('success', true, 'action', p_action);
end;
$$;

revoke all on function public.record_daily_five_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_daily_five_action(uuid, uuid, text) to service_role;

create or replace function public.refresh_daily_five()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user record;
  v_processed integer := 0;
begin
  for v_user in
    select profile.user_id, privacy.timezone
    from public.user_privacy_settings as privacy
    join public.dating_profiles as profile
      on profile.user_id = privacy.user_id
    where (now() at time zone privacy.timezone)::time >= time '05:00'
      and (now() at time zone privacy.timezone)::time < time '05:15'
  loop
    perform public.ensure_daily_five(v_user.user_id, v_user.timezone);
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.refresh_daily_five() from public, anon, authenticated;
grant execute on function public.refresh_daily_five() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'veyra-daily-five-renewal';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'veyra-daily-five-renewal',
    '*/15 * * * *',
    'select public.refresh_daily_five();'
  );
end
$$;
