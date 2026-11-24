-- Development-only profile backfill. Run only after confirming the SQL Editor
-- is connected to the development project.
set veyra.seed_environment = 'development';

do $backfill$
declare
  v_photos constant jsonb := '[
    "bf499a76-8965-4eba-b941-5e5125fd1541/209030c6-14c8-43e5-9c7a-834cd183f804.jpeg",
    "bf499a76-8965-4eba-b941-5e5125fd1541/c394142e-e043-4a49-9668-59c9b59fa64f.jpeg",
    "bf499a76-8965-4eba-b941-5e5125fd1541/f8f71db1-022b-483a-99b5-6f712965fdf0.jpeg"
  ]'::jsonb;
  v_updated integer;
begin
  if current_setting('veyra.seed_environment', true)
      is distinct from 'development' then
    raise exception
      'Refusing to update test photos: confirm the SQL Editor is connected to development.';
  end if;

  update public.dating_profiles as dating_profile
  set profile = jsonb_set(
    dating_profile.profile,
    '{profile}',
    jsonb_set(
      case
        when jsonb_typeof(dating_profile.profile->'profile') = 'object'
          then dating_profile.profile->'profile'
        else '{}'::jsonb
      end,
      '{photos}',
      v_photos,
      true
    ),
    true
  ),
  updated_at = now()
  from auth.users as test_user
  where test_user.id = dating_profile.user_id
    and test_user.raw_app_meta_data->>'veyra_test_user' = 'true'
    and (
      jsonb_typeof(dating_profile.profile #> '{profile,photos}')
        is distinct from 'array'
      or dating_profile.profile #> '{profile,photos}' = '[]'::jsonb
    );

  get diagnostics v_updated = row_count;
  raise notice 'Updated % tagged development profiles.', v_updated;
end;
$backfill$;
