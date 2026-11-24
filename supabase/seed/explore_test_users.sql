-- Development-only seed: creates or refreshes 200 confirmed, photo-free test
-- accounts. It never deletes users or profiles.
--
-- Confirm the SQL Editor is connected to the development project, then replace
-- the password placeholder below before running. Never commit the real
-- password or run this script against production.

do $seed$
declare
  v_password text := 'REPLACE_WITH_SHARED_TEST_PASSWORD';
  v_password_hash text;
  v_user_id uuid;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_gender text;
  v_city text;
  v_province text;
  v_latitude double precision;
  v_longitude double precision;
  v_age integer;
  v_birthday date;
  v_profile jsonb;
  v_explore_function text;
  v_index integer;
  v_city_index integer;
  v_first_names_women text[] := array[
    'Amahle', 'Ayanda', 'Buhle', 'Dineo', 'Lindiwe',
    'Masego', 'Nandi', 'Palesa', 'Refilwe', 'Zanele'
  ];
  v_first_names_men text[] := array[
    'Bongani', 'Dumisani', 'Kagiso', 'Karabo', 'Lungelo',
    'Mandla', 'Sandile', 'Sibusiso', 'Thabo', 'Vusi'
  ];
  v_last_names text[] := array[
    'Dlamini', 'Khumalo', 'Mokoena', 'Mthembu', 'Ndlovu',
    'Nkosi', 'Radebe', 'Sithole', 'Molefe', 'Zulu'
  ];
  v_cities text[] := array[
    'Johannesburg', 'Pretoria', 'Durban', 'Cape Town', 'Bloemfontein'
  ];
  v_provinces text[] := array[
    'Gauteng', 'Gauteng', 'KwaZulu-Natal', 'Western Cape', 'Free State'
  ];
  v_latitudes double precision[] := array[
    -26.2041, -25.7479, -29.8587, -33.9249, -29.0852
  ];
  v_longitudes double precision[] := array[
    28.0473, 28.2293, 31.0218, 18.4241, 26.1596
  ];
begin
  if v_password = 'REPLACE_WITH_SHARED_TEST_PASSWORD'
    or length(v_password) < 8 then
    raise exception
      'Replace the password placeholder with the shared development password (at least 8 characters).';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null
    or to_regprocedure('extensions.gen_salt(text)') is null then
    raise exception 'The pgcrypto extension is required to hash test passwords.';
  end if;
  if to_regprocedure(
    'public.get_explore_feed_with_fallback(uuid,text,integer,text)'
  ) is null then
    raise exception
      'Apply the Discovery and Explore migrations before creating test accounts.';
  end if;
  if to_regprocedure(
    'public.record_explore_action(uuid,uuid,text,text,integer,text)'
  ) is null then
    raise exception
      'Apply the Explore decision migration before creating test accounts.';
  end if;
  v_explore_function := pg_get_functiondef(
    'public.get_explore_feed_with_fallback(uuid,text,integer,text)'::regprocedure
  );
  if position(
    'photo.path like candidate.user_id::text' in v_explore_function
  ) > 0 then
    raise exception
      'Apply 20261120090000_explore_profiles_without_photos.sql first.';
  end if;

  v_password_hash := extensions.crypt(
    v_password,
    extensions.gen_salt('bf')
  );

  for i in 1..200 loop
    v_index := (i + 1) / 2;
    v_city_index := ((i - 1) / 40) + 1;
    v_gender := case when i % 2 = 1 then 'Woman' else 'Man' end;
    v_first_name := case
      when v_gender = 'Woman' then
        v_first_names_women[((v_index - 1) % 10) + 1]
      else
        v_first_names_men[((v_index - 1) % 10) + 1]
    end;
    v_last_name := v_last_names[((v_index - 1) / 10) + 1];
    v_email := 'loadtest' || lpad(i::text, 3, '0') || '@veyra.dev';
    v_user_id := (
      'e9f10000-0000-4000-8000-' || lpad(i::text, 12, '0')
    )::uuid;
    v_city := v_cities[v_city_index];
    v_province := v_provinces[v_city_index];
    v_latitude := v_latitudes[v_city_index];
    v_longitude := v_longitudes[v_city_index];
    v_age := 22 + ((i * 7) % 23);
    v_birthday := make_date(
      extract(year from current_date)::integer - v_age,
      1,
      1
    );

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_password_hash,
      now(),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'veyra_test_user', true
      ),
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'full_name', v_first_name || ' ' || v_last_name
      ),
      now(),
      now()
    )
    on conflict (id) do update
    set
      email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at,
      raw_app_meta_data = excluded.raw_app_meta_data,
      raw_user_meta_data = excluded.raw_user_meta_data,
      updated_at = now();

    insert into auth.identities (
      user_id,
      identity_data,
      provider,
      provider_id,
      created_at,
      updated_at
    )
    values (
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true
      ),
      'email',
      v_user_id::text,
      now(),
      now()
    )
    on conflict (provider_id, provider) do update
    set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

    v_profile := jsonb_build_object(
      'version', 1,
      'intentions', jsonb_build_array(
        'Meaningful connection',
        'A genuine relationship',
        'Taking things slowly',
        'Growing together'
      ),
      'profile', jsonb_build_object(
        'nickname', 'LoadTest' || lpad(i::text, 3, '0'),
        'birthday', v_birthday,
        'gender', v_gender,
        'photos', '[]'::jsonb,
        'city', v_city,
        'province', v_province,
        'country', 'South Africa',
        'bio', format(
          'Test profile %s. Enjoys good conversation, exploring the city, and making time for friends and family.',
          lpad(i::text, 3, '0')
        ),
        'interests', jsonb_build_array(
          'Travel',
          'Food',
          'Live music',
          'Nature',
          case when i % 2 = 0 then 'Books' else 'Fitness' end
        ),
        'occupation', case i % 5
          when 0 then 'Teacher'
          when 1 then 'Designer'
          when 2 then 'Engineer'
          when 3 then 'Healthcare professional'
          else 'Small business owner'
        end,
        'education', 'University',
        'height', '',
        'languages', 'English, isiZulu',
        'exercise', case when i % 2 = 0 then 'Regularly' else 'Sometimes' end,
        'smoking', 'No',
        'drinking', case when i % 3 = 0 then 'Socially' else 'Rarely' end,
        'children', 'Open to children',
        'pets', case when i % 2 = 0 then 'Love pets' else 'No pets' end,
        'perfectSunday', 'A relaxed morning, good food, and time outdoors.',
        'greenFlag', 'Kindness and honest communication.',
        'wantToLearn', 'A new recipe or a new place to visit.',
        'relationshipVision', 'A supportive partnership built on trust.',
        'voiceIntroUri', ''
      ),
      'datingDNA', jsonb_build_object(
        'relationshipGoals', jsonb_build_array(
          'Long-term partnership',
          'Meaningful connection'
        ),
        'communicationStyle', case i % 4
          when 0 then 'Quality time'
          when 1 then 'Words that mean something'
          when 2 then 'Thoughtful gestures'
          else 'Open conversations'
        end,
        'values', jsonb_build_array(
          'Kindness',
          'Family',
          case when i % 2 = 0 then 'Curiosity' else 'Adventure' end
        ),
        'idealWeekend', 'Good conversation, a walk, and discovering somewhere new.'
      ),
      'preferences', jsonb_build_object(
        'genders', jsonb_build_array('Women', 'Men', 'Non-binary people'),
        'minAge', 18,
        'maxAge', 99,
        'exploreRadiusKm', 200
      )
    );

    insert into public.dating_profiles (
      user_id,
      profile,
      latitude,
      longitude,
      location_source,
      province,
      country,
      explore_radius_km,
      updated_at
    )
    values (
      v_user_id,
      v_profile,
      v_latitude,
      v_longitude,
      'manual',
      v_province,
      'South Africa',
      200,
      now()
    )
    on conflict (user_id) do update
    set
      profile = excluded.profile,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_source = excluded.location_source,
      province = excluded.province,
      country = excluded.country,
      explore_radius_km = excluded.explore_radius_km,
      updated_at = now();

    insert into public.user_privacy_settings (
      user_id,
      discoverable,
      show_in_daily_five,
      show_in_explore
    )
    values (v_user_id, true, true, true)
    on conflict (user_id) do update
    set
      discoverable = true,
      show_in_daily_five = true,
      show_in_explore = true,
      updated_at = now();
  end loop;

  raise notice 'Seeded 200 confirmed Explore test users across five cities.';
end;
$seed$;
