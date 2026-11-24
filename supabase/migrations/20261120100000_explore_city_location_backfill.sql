create or replace function public.set_dating_profile_city_coordinates()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_city text := lower(btrim(new.profile->'profile'->>'city'));
  v_latitude double precision;
  v_longitude double precision;
begin
  if new.latitude is not null and new.longitude is not null then
    return new;
  end if;

  select city.latitude, city.longitude
  into v_latitude, v_longitude
  from (values
    ('johannesburg', -26.2041, 28.0473),
    ('pretoria', -25.7479, 28.2293),
    ('bloemfontein', -29.0852, 26.1596),
    ('durban', -29.8587, 31.0218),
    ('cape town', -33.9249, 18.4241),
    ('gqeberha', -33.9608, 25.6022),
    ('port elizabeth', -33.9608, 25.6022),
    ('east london', -33.0153, 27.9116),
    ('kimberley', -28.7282, 24.7499),
    ('polokwane', -23.9045, 29.4689),
    ('nelspruit', -25.4753, 30.9694),
    ('mbombela', -25.4753, 30.9694),
    ('rustenburg', -25.6676, 27.2421),
    ('george', -33.963, 22.4617),
    ('stellenbosch', -33.9321, 18.8602),
    ('pietermaritzburg', -29.6006, 30.3794),
    ('soweto', -26.2485, 27.854),
    ('midrand', -25.9992, 28.1263),
    ('sandton', -26.1076, 28.0567),
    ('centurion', -25.8603, 28.1894),
    ('benoni', -26.1885, 28.3208),
    ('welkom', -27.9774, 26.7351),
    ('mthatha', -31.5889, 28.7844),
    ('mahikeng', -25.8652, 25.6442)
  ) as city(name, latitude, longitude)
  where city.name = v_city;

  if v_latitude is not null then
    new.latitude := coalesce(new.latitude, v_latitude);
    new.longitude := coalesce(new.longitude, v_longitude);
    new.location_source := 'manual';
  end if;

  return new;
end;
$$;

drop trigger if exists dating_profiles_city_coordinates on public.dating_profiles;
create trigger dating_profiles_city_coordinates
before insert or update of profile, latitude, longitude
on public.dating_profiles
for each row
execute function public.set_dating_profile_city_coordinates();

update public.dating_profiles as dating_profile
set
  latitude = coalesce(dating_profile.latitude, city.latitude),
  longitude = coalesce(dating_profile.longitude, city.longitude),
  location_source = case
    when dating_profile.latitude is null or dating_profile.longitude is null
      then 'manual'
    else dating_profile.location_source
  end
from (values
  ('johannesburg', -26.2041, 28.0473),
  ('pretoria', -25.7479, 28.2293),
  ('bloemfontein', -29.0852, 26.1596),
  ('durban', -29.8587, 31.0218),
  ('cape town', -33.9249, 18.4241),
  ('gqeberha', -33.9608, 25.6022),
  ('port elizabeth', -33.9608, 25.6022),
  ('east london', -33.0153, 27.9116),
  ('kimberley', -28.7282, 24.7499),
  ('polokwane', -23.9045, 29.4689),
  ('nelspruit', -25.4753, 30.9694),
  ('mbombela', -25.4753, 30.9694),
  ('rustenburg', -25.6676, 27.2421),
  ('george', -33.963, 22.4617),
  ('stellenbosch', -33.9321, 18.8602),
  ('pietermaritzburg', -29.6006, 30.3794),
  ('soweto', -26.2485, 27.854),
  ('midrand', -25.9992, 28.1263),
  ('sandton', -26.1076, 28.0567),
  ('centurion', -25.8603, 28.1894),
  ('benoni', -26.1885, 28.3208),
  ('welkom', -27.9774, 26.7351),
  ('mthatha', -31.5889, 28.7844),
  ('mahikeng', -25.8652, 25.6442)
) as city(name, latitude, longitude)
where lower(btrim(dating_profile.profile->'profile'->>'city')) = city.name
  and (
    dating_profile.latitude is null
    or dating_profile.longitude is null
  );
