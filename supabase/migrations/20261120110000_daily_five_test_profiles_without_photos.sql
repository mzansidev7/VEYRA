update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('veyra_test_user', true)
where email ~ '^loadtest[0-9]{3}@veyra[.]dev$';

do $migration$
declare
  v_signature regprocedure :=
    'public.ensure_daily_five(uuid,text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_photo_filter constant text := $photo_filter$      and jsonb_typeof(candidate.profile->'profile'->'photos') = 'array'
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
$photo_filter$;
  v_legacy_photo_filter constant text := $legacy_photo_filter$      and jsonb_typeof(candidate.profile->'profile'->'photos') = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(
          candidate.profile->'profile'->'photos'
        ) as photo(path)
        where photo.path like candidate.user_id::text || '/%'
      )
$legacy_photo_filter$;
  v_test_photo_filter constant text := $test_photo_filter$      and (
        exists (
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
        or exists (
          select 1
          from auth.users as test_user
          where test_user.id = candidate.user_id
            and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
        )
      )
$test_photo_filter$;
  v_expiry_expression constant text := $expiry_expression$  v_expires_at :=
    ((v_cycle_date + 1)::timestamp + time '05:00') at time zone p_timezone;
$expiry_expression$;
  v_test_expiry_expression constant text := $test_expiry_expression$  v_expires_at := now() + interval '5 minutes';
$test_expiry_expression$;
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
  v_updated_definition := replace(
    v_definition,
    v_photo_filter,
    v_test_photo_filter
  );

  if v_updated_definition = v_definition then
    v_updated_definition := replace(
      v_definition,
      v_legacy_photo_filter,
      v_test_photo_filter
    );
  end if;

  if position('veyra_test_user' in v_updated_definition) = 0 then
    raise exception
      'Could not find a supported profile-photo filter in ensure_daily_five. Apply the Daily 5 and Explore migrations first.';
  end if;

  if position('interval ''5 minutes''' in v_updated_definition) = 0 then
    v_updated_definition := replace(
      v_updated_definition,
      v_expiry_expression,
      v_test_expiry_expression
    );
    if position('interval ''5 minutes''' in v_updated_definition) = 0 then
      raise exception
        'Could not find the expected Daily 5 expiry expression in ensure_daily_five.';
    end if;
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
        'Could not add test-only Daily 5 set renewal to ensure_daily_five.';
    end if;
  end if;

  execute v_updated_definition;
end;
$migration$;

update public.daily_recommendation_sets as recommendation_set
set expires_at = least(recommendation_set.expires_at, now() + interval '5 minutes')
where recommendation_set.expires_at > now();

delete from public.daily_recommendation_sets as recommendation_set
where recommendation_set.expires_at > now()
  and recommendation_set.selected_count = 0
  and not exists (
    select 1
    from public.daily_recommendations as recommendation
    where recommendation.set_id = recommendation_set.id
  );
