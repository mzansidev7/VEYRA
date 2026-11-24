do $migration$
declare
  v_ensure_signature regprocedure :=
    'public.ensure_daily_five(uuid,text)'::regprocedure;
  v_action_signature regprocedure :=
    'public.record_daily_five_action(uuid,uuid,text)'::regprocedure;
  v_ensure_definition text;
  v_updated_ensure_definition text;
  v_updated_ensure_ranked text;
  v_action_definition text;
  v_updated_action_definition text;
  v_action_filter constant text := $action_filter$      and not exists (
        select 1
        from public.discovery_actions as action
        where action.user_id = p_user_id
          and action.target_user_id = candidate.user_id
      )
$action_filter$;
  v_test_action_filter constant text := $test_action_filter$      and not exists (
        select 1
        from public.discovery_actions as action
        where action.user_id = p_user_id
          and action.target_user_id = candidate.user_id
          and (
            action.action in ('like', 'superlike')
            or not exists (
              select 1
              from auth.users as test_user
              where test_user.id = candidate.user_id
                and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
            )
          )
      )
$test_action_filter$;
  v_ranked_block constant text := $ranked_block$  ranked as (
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
$ranked_block$;
  v_test_ranked_block constant text := $test_ranked_block$  ranked as (
    select
      eligible.user_id,
      eligible.compatibility,
      case when exists (
        select 1
        from public.discovery_actions as action
        where action.user_id = p_user_id
          and action.target_user_id = eligible.user_id
          and action.action = 'pass'
      ) then 1 else 0 end as previously_passed,
      floor(((eligible.compatibility->>'score')::numeric + 2.5) / 5) as score_band,
      gen_random_uuid() as variety_order
    from eligible
    where eligible.compatibility->>'score' is not null
  ),
  selected as (
    select
      user_id,
      compatibility,
      row_number() over (
        order by previously_passed, score_band desc, variety_order
      )::smallint as position
    from ranked
    order by previously_passed, score_band desc, variety_order
    limit 5
  )
$test_ranked_block$;
  v_existing_action_branch constant text := $existing_action_branch$  if v_existing_action is not null then
    if v_existing_action <> p_action then
      raise exception 'A different action was already recorded for this profile.';
    end if;
    return jsonb_build_object('success', true, 'action', v_existing_action);
  end if;
$existing_action_branch$;
  v_replayable_pass_branch constant text := $replayable_pass_branch$  if v_existing_action is not null then
    if v_existing_action <> p_action then
      raise exception 'A different action was already recorded for this profile.';
    end if;

    if v_existing_action = 'pass' and exists (
      select 1
      from public.daily_recommendations as recommendation
      join auth.users as test_user
        on test_user.id = recommendation.recommended_user_id
      where recommendation.id = p_recommendation_id
        and recommendation.user_id = p_user_id
        and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
    ) then
      update public.daily_recommendations as recommendation
      set status = 'passed', decided_at = now()
      from public.daily_recommendation_sets as recommendation_set
      where recommendation.id = p_recommendation_id
        and recommendation.user_id = p_user_id
        and recommendation.status = 'pending'
        and recommendation.set_id = recommendation_set.id
        and recommendation_set.expires_at > now()
        and exists (
          select 1
          from auth.users as test_user
          where test_user.id = recommendation.recommended_user_id
            and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
        );

      if not found then
        raise exception 'This Daily 5 profile is no longer available.';
      end if;
    end if;

    return jsonb_build_object('success', true, 'action', v_existing_action);
  end if;
$replayable_pass_branch$;
begin
  v_ensure_definition := pg_get_functiondef(v_ensure_signature);
  v_updated_ensure_definition := replace(
    v_ensure_definition,
    v_action_filter,
    v_test_action_filter
  );
  if v_updated_ensure_definition = v_ensure_definition
    and position(v_test_action_filter in v_ensure_definition) = 0 then
    raise exception
      'Could not find the Daily 5 action exclusion. Apply the Daily 5 and test-profile migrations first.';
  end if;
  v_updated_ensure_ranked := replace(
    v_updated_ensure_definition,
    v_ranked_block,
    v_test_ranked_block
  );
  if v_updated_ensure_ranked = v_updated_ensure_definition
    and position(v_test_ranked_block in v_updated_ensure_definition) = 0 then
    raise exception
      'Could not find the Daily 5 ranking block to prioritize fresh profiles.';
  end if;

  v_action_definition := pg_get_functiondef(v_action_signature);
  v_updated_action_definition := replace(
    v_action_definition,
    v_existing_action_branch,
    v_replayable_pass_branch
  );
  if v_updated_action_definition = v_action_definition
    and position(v_replayable_pass_branch in v_action_definition) = 0 then
    raise exception
      'Could not find the existing Daily 5 action branch.';
  end if;

  if v_updated_ensure_ranked <> v_ensure_definition then
    execute v_updated_ensure_ranked;
  end if;
  if v_updated_action_definition <> v_action_definition then
    execute v_updated_action_definition;
  end if;
end;
$migration$;
