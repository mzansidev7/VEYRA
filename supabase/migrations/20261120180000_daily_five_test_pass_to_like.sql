do $migration$
declare
  v_action_signature regprocedure :=
    'public.record_daily_five_action(uuid,uuid,text)'::regprocedure;
  v_action_definition text;
  v_updated_action_definition text;
  v_base_action_branch constant text := $base_action_branch$  if v_existing_action is not null then
    if v_existing_action <> p_action then
      raise exception 'A different action was already recorded for this profile.';
    end if;
    return jsonb_build_object('success', true, 'action', v_existing_action);
  end if;
$base_action_branch$;
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
  v_updated_action_branch constant text := $updated_action_branch$  if v_existing_action is not null then
    if v_existing_action <> p_action then
      if v_existing_action <> 'pass'
        or p_action not in ('like', 'superlike')
        or not exists (
          select 1
          from public.daily_recommendations as recommendation
          join public.daily_recommendation_sets as recommendation_set
            on recommendation_set.id = recommendation.set_id
          join auth.users as test_user
            on test_user.id = recommendation.recommended_user_id
          where recommendation.id = p_recommendation_id
            and recommendation.user_id = p_user_id
            and recommendation.status = 'pending'
            and recommendation_set.expires_at > now()
            and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
        ) then
        raise exception 'A different action was already recorded for this profile.';
      end if;

      if exists (
        select 1
        from public.hidden_profiles as hidden
        where hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = (
            select recommendation.recommended_user_id::text
            from public.daily_recommendations as recommendation
            where recommendation.id = p_recommendation_id
              and recommendation.user_id = p_user_id
          )
      ) or exists (
        select 1
        from public.blocked_users as blocked
        where
          (blocked.blocker_id = p_user_id::text
            and blocked.blocked_id = (
              select recommendation.recommended_user_id::text
              from public.daily_recommendations as recommendation
              where recommendation.id = p_recommendation_id
                and recommendation.user_id = p_user_id
            ))
          or
          (blocked.blocker_id = (
            select recommendation.recommended_user_id::text
            from public.daily_recommendations as recommendation
            where recommendation.id = p_recommendation_id
              and recommendation.user_id = p_user_id
          )
            and blocked.blocked_id = p_user_id::text)
      ) or exists (
        select 1
        from public.user_privacy_settings as privacy
        where privacy.user_id = (
          select recommendation.recommended_user_id
          from public.daily_recommendations as recommendation
          where recommendation.id = p_recommendation_id
            and recommendation.user_id = p_user_id
        )
          and (
            not privacy.discoverable
            or not privacy.show_in_daily_five
          )
      ) then
        raise exception 'This profile is no longer available.';
      end if;

      update public.daily_recommendations as recommendation
      set
        status = case p_action
          when 'like' then 'liked'
          else 'superliked'
        end,
        decided_at = now()
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

      update public.discovery_actions
      set action = p_action, created_at = now()
      where user_id = p_user_id
        and target_user_id = (
          select recommendation.recommended_user_id
          from public.daily_recommendations as recommendation
          where recommendation.id = p_recommendation_id
            and recommendation.user_id = p_user_id
        )
        and action = 'pass';

      if not found then
        raise exception 'This profile action has already changed.';
      end if;

      return jsonb_build_object('success', true, 'action', p_action);
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
$updated_action_branch$;
begin
  v_action_definition := pg_get_functiondef(v_action_signature);
  v_updated_action_definition := replace(
    v_action_definition,
    v_replayable_pass_branch,
    v_updated_action_branch
  );
  if v_updated_action_definition = v_action_definition
    and position(v_updated_action_branch in v_action_definition) = 0 then
    v_updated_action_definition := replace(
      v_action_definition,
      v_base_action_branch,
      v_updated_action_branch
    );
  end if;
  if v_updated_action_definition = v_action_definition
    and position(v_updated_action_branch in v_action_definition) = 0 then
    raise exception
      'Could not update the Daily 5 action handler. Apply the Daily 5 migration first.';
  end if;

  if v_updated_action_definition <> v_action_definition then
    execute v_updated_action_definition;
  end if;

  drop trigger if exists discovery_actions_sync_like
    on public.discovery_actions;
  create trigger discovery_actions_sync_like
    after insert or update on public.discovery_actions
    for each row
    execute function public.sync_discovery_like();
end;
$migration$;
