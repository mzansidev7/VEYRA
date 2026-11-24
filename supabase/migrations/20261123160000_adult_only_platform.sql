create or replace function public.enforce_adult_dating_profile()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_birthday_text text;
  v_birthday date;
begin
  v_birthday_text := nullif(
    btrim(new.profile #>> '{profile,birthday}'),
    ''
  );

  if v_birthday_text is null then
    return new;
  end if;

  if v_birthday_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'VEYRA is for adults 18 and older. Enter a valid birthday.'
      using errcode = '23514';
  end if;

  begin
    v_birthday := v_birthday_text::date;
  exception
    when others then
      raise exception 'VEYRA is for adults 18 and older. Enter a valid birthday.'
        using errcode = '23514';
  end;

  if v_birthday::text <> v_birthday_text
    or v_birthday > (current_date - interval '18 years')::date then
    raise exception 'VEYRA is for adults 18 and older.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists dating_profiles_adult_only on public.dating_profiles;
create trigger dating_profiles_adult_only
before insert or update of profile on public.dating_profiles
for each row
execute function public.enforce_adult_dating_profile();
