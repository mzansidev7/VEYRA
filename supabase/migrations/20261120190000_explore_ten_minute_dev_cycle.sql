do $migration$
declare
  v_feed_signatures regprocedure[] := array[
    'public.get_explore_feed(uuid,text,integer,text)'::regprocedure,
    'public.get_explore_feed_with_fallback(uuid,text,integer,text)'::regprocedure
  ];
  v_feed_signature regprocedure;
  v_definition text;
  v_updated_definition text;
  v_daily_window constant text :=
    'date_trunc(''day'', now() at time zone p_timezone) at time zone p_timezone';
  v_ten_minute_window constant text :=
    'date_bin(''10 minutes'', now(), ''epoch''::timestamptz)';
  v_record_signature regprocedure :=
    'public.record_explore_action(uuid,uuid,text,text,integer,text)'::regprocedure;
  v_record_definition text;
  v_updated_record_definition text;
  v_old_limit_message constant text :=
    'You’ve reached today’s Explore limit. Come back tomorrow.';
  v_new_limit_message constant text :=
    'You’ve reached the Explore limit for this 10-minute window. Try again after it resets.';
begin
  foreach v_feed_signature in array v_feed_signatures loop
    v_definition := pg_get_functiondef(v_feed_signature);
    v_updated_definition := replace(v_definition, v_daily_window, v_ten_minute_window);

    if position('reset_at' in v_updated_definition) = 0 then
      v_updated_definition := regexp_replace(
        v_updated_definition,
        $$'daily_limit',\s*20(,\s*'out_of_radius')?$$,
        $$'daily_limit', 20, 'reset_at',
          date_bin('10 minutes', now(), 'epoch'::timestamptz)
            + interval '10 minutes'\1$$,
        'g'
      );
    end if;

    if position(v_ten_minute_window in v_updated_definition) = 0
      or position('reset_at' in v_updated_definition) = 0 then
      raise exception
        'Could not update the Explore feed quota window for %.',
        v_feed_signature;
    end if;

    if v_updated_definition <> v_definition then
      execute v_updated_definition;
    end if;
  end loop;

  v_record_definition := pg_get_functiondef(v_record_signature);
  v_updated_record_definition := replace(
    v_record_definition,
    v_daily_window,
    v_ten_minute_window
  );
  v_updated_record_definition := replace(
    v_updated_record_definition,
    v_old_limit_message,
    v_new_limit_message
  );

  if position(v_ten_minute_window in v_updated_record_definition) = 0 then
    raise exception 'Could not update the Explore decision quota window.';
  end if;

  if v_updated_record_definition <> v_record_definition then
    execute v_updated_record_definition;
  end if;
end;
$migration$;
