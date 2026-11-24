do $migration$
declare
  v_signature regprocedure :=
    'public.ensure_daily_five(uuid,text)'::regprocedure;
  v_definition text;
  v_anchor constant text := $anchor$  select id into v_set_id
  from public.daily_recommendation_sets
  where user_id = p_user_id
    and expires_at > now()
  order by created_at desc
  limit 1;
$anchor$;
  v_replacement constant text := $replacement$  -- Retry an empty set on the next feed request
  delete from public.daily_recommendation_sets as empty_set
  where empty_set.user_id = p_user_id
    and empty_set.expires_at > now()
    and empty_set.selected_count = 0
    and not exists (
      select 1
      from public.daily_recommendations as recommendation
      where recommendation.set_id = empty_set.id
    );

  select id into v_set_id
  from public.daily_recommendation_sets
  where user_id = p_user_id
    and expires_at > now()
  order by created_at desc
  limit 1;
$replacement$;
begin
  v_definition := pg_get_functiondef(v_signature);
  if position('retry an empty set on the next feed request' in lower(v_definition)) > 0 then
    return;
  end if;

  if position(v_anchor in v_definition) = 0 then
    raise exception
      'Could not find the active-set lookup in ensure_daily_five.';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;
