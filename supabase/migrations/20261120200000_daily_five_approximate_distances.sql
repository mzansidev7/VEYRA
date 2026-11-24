create or replace function public.get_daily_five_approximate_distances(
  p_viewer_id uuid,
  p_candidate_ids uuid[]
)
returns table (
  candidate_id uuid,
  distance_km integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select latitude, longitude
    from public.dating_profiles
    where user_id = p_viewer_id
  )
  select
    candidate.user_id as candidate_id,
    round(6371 * 2 * asin(least(1, sqrt(
      power(sin(radians(candidate.latitude - viewer.latitude) / 2), 2)
      + cos(radians(viewer.latitude))
        * cos(radians(candidate.latitude))
        * power(sin(radians(candidate.longitude - viewer.longitude) / 2), 2)
    ))))::integer as distance_km
  from public.dating_profiles as candidate
  cross join viewer
  left join public.user_privacy_settings as privacy
    on privacy.user_id = candidate.user_id
  where candidate.user_id = any(p_candidate_ids)
    and viewer.latitude is not null
    and viewer.longitude is not null
    and candidate.latitude is not null
    and candidate.longitude is not null
    and coalesce(privacy.show_distance, true);
$$;

revoke all on function public.get_daily_five_approximate_distances(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_daily_five_approximate_distances(uuid, uuid[])
  to service_role;
