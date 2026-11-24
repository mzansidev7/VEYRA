do $migration$
declare
  v_signature regprocedure :=
    'public.ensure_daily_five(uuid,text)'::regprocedure;
  v_definition text;
  v_anchor constant text := $anchor$  v_cycle_date := case
    when v_local_now::time >= time '05:00'
      then v_local_now::date
    else v_local_now::date - 1
  end;
$anchor$;
  v_replacement constant text := $replacement$  v_cycle_date := case
    when v_local_now::time >= time '05:00'
      then v_local_now::date
    else v_local_now::date - 1
  end;

  -- Renew expired Daily Five set
  delete from public.daily_recommendation_sets
  where user_id = p_user_id
    and recommendation_date = v_cycle_date
    and expires_at <= now();
$replacement$;
begin
  v_definition := pg_get_functiondef(v_signature);
  if position('renew expired daily five set' in lower(v_definition)) > 0 then
    return;
  end if;

  if position(v_anchor in v_definition) = 0 then
    raise exception
      'Could not find the Daily 5 cycle-date block in ensure_daily_five.';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;
