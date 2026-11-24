do $migration$
declare
  v_signature regprocedure :=
    'public.respond_to_received_like(uuid,uuid,text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_action_insert constant text := $action_insert$  insert into public.discovery_actions (
    user_id,
    target_user_id,
    action,
    source
  )
  values (p_user_id, p_sender_id, 'like', 'likes');

  select id into v_match_id$action_insert$;
  v_action_insert_with_daily_update constant text :=
    $action_insert_with_daily_update$  insert into public.discovery_actions (
    user_id,
    target_user_id,
    action,
    source
  )
  values (p_user_id, p_sender_id, 'like', 'likes');

  update public.daily_recommendations as recommendation
  set status = 'liked', decided_at = now()
  from public.daily_recommendation_sets as recommendation_set
  where recommendation.set_id = recommendation_set.id
    and recommendation.user_id = p_user_id
    and recommendation.recommended_user_id = p_sender_id
    and recommendation.status = 'pending'
    and recommendation_set.expires_at > now();

  select id into v_match_id$action_insert_with_daily_update$;
begin
  v_definition := pg_get_functiondef(v_signature);
  v_updated_definition := replace(
    v_definition,
    v_action_insert,
    v_action_insert_with_daily_update
  );

  if v_updated_definition = v_definition
    and position(v_action_insert_with_daily_update in v_definition) = 0 then
    raise exception
      'Could not update the received-like action handler. Apply the Likes and Matches migration first.';
  end if;

  if v_updated_definition <> v_definition then
    execute v_updated_definition;
  end if;
end;
$migration$;
