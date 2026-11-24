do $migration$
declare
  v_signature regprocedure :=
    'public.ensure_daily_five(uuid,text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_expiry_expression constant text := $expiry_expression$  v_expires_at :=
    ((v_cycle_date + 1)::timestamp + time '05:00') at time zone p_timezone;
$expiry_expression$;
  v_test_expiry_expression constant text := $test_expiry_expression$  v_expires_at := now() + interval '5 minutes';
$test_expiry_expression$;
  v_conditional_expiry_expression constant text := $conditional_expiry_expression$  v_expires_at := case
    when exists (
      select 1
      from auth.users as test_user
      where test_user.id = p_user_id
        and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
    ) then now() + interval '5 minutes'
    else ((v_cycle_date + 1)::timestamp + time '05:00') at time zone p_timezone
  end;
$conditional_expiry_expression$;
  v_set_insert constant text := $set_insert$  insert into public.daily_recommendation_sets (
$set_insert$;
  v_test_set_insert constant text := $test_set_insert$  delete from public.daily_recommendation_sets
  where user_id = p_user_id
    and recommendation_date = v_cycle_date
    and expires_at <= now();

  insert into public.daily_recommendation_sets (
$test_set_insert$;
begin
  v_definition := pg_get_functiondef(v_signature);
  v_updated_definition := v_definition;

  if position(
    'v_expires_at := now() + interval ''5 minutes'';'
    in v_updated_definition
  ) = 0 then
    v_updated_definition := replace(
      v_updated_definition,
      v_expiry_expression,
      v_test_expiry_expression
    );
  end if;

  if position(
    'v_expires_at := now() + interval ''5 minutes'';'
    in v_updated_definition
  ) = 0 then
    v_updated_definition := replace(
      v_updated_definition,
      v_conditional_expiry_expression,
      v_test_expiry_expression
    );
  end if;

  if position(
    'v_expires_at := now() + interval ''5 minutes'';'
    in v_updated_definition
  ) = 0 then
    raise exception
      'Could not find the Daily 5 expiry expression. Apply the Daily 5 discovery migration first.';
  end if;

  if position(
    'delete from public.daily_recommendation_sets' in lower(v_updated_definition)
  ) = 0 then
    v_updated_definition := replace(
      v_updated_definition,
      v_set_insert,
      v_test_set_insert
    );
    if v_updated_definition not like '%recommendation_date = v_cycle_date%' then
      raise exception
        'Could not enable Daily 5 renewal during the same daily cycle.';
    end if;
  end if;

  if v_updated_definition <> v_definition then
    execute v_updated_definition;
  end if;
end;
$migration$;

update public.daily_recommendation_sets
set expires_at = least(expires_at, now() + interval '5 minutes')
where expires_at > now();
