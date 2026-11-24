do $migration$
declare
  v_signature regprocedure;
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
begin
  foreach v_signature in array array[
    'public.get_explore_feed_with_fallback(uuid,text,integer,text)'::regprocedure,
    'public.record_explore_action(uuid,uuid,text,text,integer,text)'::regprocedure
  ]
  loop
    v_definition := pg_get_functiondef(v_signature);
    v_updated_definition := replace(v_definition, v_photo_filter, '');

    if v_updated_definition = v_definition then
      raise exception
        'Could not find the expected Explore photo filter in function %.',
        v_signature;
    end if;

    execute v_updated_definition;
  end loop;
end;
$migration$;
