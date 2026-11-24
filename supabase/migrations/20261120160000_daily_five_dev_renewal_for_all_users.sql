do $migration$
declare
  v_signature regprocedure :=
    'public.ensure_daily_five(uuid,text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_conditional_cleanup constant text := $conditional_cleanup$  if exists (
    select 1
    from auth.users as test_user
    where test_user.id = p_user_id
      and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
  ) then
    delete from public.daily_recommendation_sets
    where user_id = p_user_id
      and recommendation_date = v_cycle_date
      and expires_at <= now();
  end if;
$conditional_cleanup$;
  v_unconditional_cleanup constant text := $unconditional_cleanup$  delete from public.daily_recommendation_sets
  where user_id = p_user_id
    and recommendation_date = v_cycle_date
    and expires_at <= now();
$unconditional_cleanup$;
begin
  v_definition := pg_get_functiondef(v_signature);
  v_updated_definition := replace(
    v_definition,
    v_conditional_cleanup,
    v_unconditional_cleanup
  );

  if v_updated_definition = v_definition
    and position(v_unconditional_cleanup in v_definition) = 0 then
    raise exception
      'Could not find the tagged-user cleanup block in ensure_daily_five. Confirm the five-minute development migration was applied first.';
  end if;

  if v_updated_definition <> v_definition then
    execute v_updated_definition;
  end if;
end;
$migration$;
