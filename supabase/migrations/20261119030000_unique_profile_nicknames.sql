update public.dating_profiles
set profile =
  (profile - 'name') ||
  jsonb_build_object(
    'nickname',
    coalesce(
      nullif(btrim(profile->>'nickname'), ''),
      nullif(btrim(profile->>'name'), ''),
      ''
    )
  );

do $$
declare
  duplicate_profile record;
  unique_nickname text;
begin
  for duplicate_profile in
    select user_id, profile->>'nickname' as nickname
    from (
      select
        user_id,
        profile,
        row_number() over (
          partition by lower(btrim(profile->>'nickname'))
          order by user_id
        ) as nickname_position
      from public.dating_profiles
    ) ranked_profiles
    where nickname_position > 1
      and nullif(btrim(profile->>'nickname'), '') is not null
    order by user_id
  loop
    unique_nickname :=
      btrim(duplicate_profile.nickname) || '-' || left(duplicate_profile.user_id::text, 8);

    while exists (
      select 1
      from public.dating_profiles
      where user_id <> duplicate_profile.user_id
        and lower(btrim(profile->>'nickname')) = lower(unique_nickname)
    ) loop
      unique_nickname := unique_nickname || '-';
    end loop;

    update public.dating_profiles
    set profile = jsonb_set(profile, '{nickname}', to_jsonb(unique_nickname))
    where user_id = duplicate_profile.user_id;
  end loop;
end
$$;

create unique index if not exists dating_profiles_nickname_unique
  on public.dating_profiles (
    lower(nullif(btrim(profile->>'nickname'), ''))
  );
