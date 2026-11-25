create table if not exists public.profile_views (
  viewer_id uuid not null references auth.users (id) on delete cascade,
  viewed_user_id uuid not null references auth.users (id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (viewer_id, viewed_user_id),
  check (viewer_id <> viewed_user_id)
);

create index if not exists profile_views_viewed_user_recent_idx
  on public.profile_views (viewed_user_id, last_viewed_at desc);

alter table public.profile_views enable row level security;
revoke all on public.profile_views from public, anon, authenticated;
grant all on public.profile_views to service_role;

create or replace function public.record_profile_view(
  p_viewer_id uuid,
  p_viewed_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer := 0;
begin
  if p_viewer_id is null or p_viewed_user_id is null
    or p_viewer_id = p_viewed_user_id then
    return false;
  end if;

  insert into public.profile_views (
    viewer_id,
    viewed_user_id,
    last_viewed_at
  )
  select p_viewer_id, p_viewed_user_id, now()
  where exists (
    select 1
    from public.dating_profiles as viewer
    join public.dating_profiles as viewed
      on viewed.user_id = p_viewed_user_id
    where viewer.user_id = p_viewer_id
  )
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_viewer_id::text
          and blocked.blocked_id = p_viewed_user_id::text)
         or (blocked.blocker_id = p_viewed_user_id::text
          and blocked.blocked_id = p_viewer_id::text)
    )
    and not exists (
      select 1
      from public.hidden_profiles as hidden
      where (hidden.user_id = p_viewer_id::text
          and hidden.hidden_user_id = p_viewed_user_id::text)
         or (hidden.user_id = p_viewed_user_id::text
          and hidden.hidden_user_id = p_viewer_id::text)
    )
  on conflict (viewer_id, viewed_user_id)
  do update set last_viewed_at = excluded.last_viewed_at;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.record_profile_view(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_profile_view(uuid, uuid)
  to service_role;

create or replace function public.get_profile_visitors(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visitors jsonb;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  if not exists (
    select 1 from public.dating_profiles where user_id = p_user_id
  ) then
    raise exception 'A completed profile is required to view profile visitors.';
  end if;

  select coalesce(jsonb_agg(
    public.build_likes_profile_card(
      p_user_id,
      profile_view.viewer_id,
      p_timezone
    ) || jsonb_build_object(
      'visitor_id', profile_view.viewer_id,
      'viewed_at', profile_view.last_viewed_at
    )
    order by profile_view.last_viewed_at desc
  ), '[]'::jsonb)
  into v_visitors
  from public.profile_views as profile_view
  join public.dating_profiles as visitor
    on visitor.user_id = profile_view.viewer_id
  join auth.users as visitor_auth
    on visitor_auth.id = profile_view.viewer_id
  where profile_view.viewed_user_id = p_user_id
    and (visitor_auth.banned_until is null
      or visitor_auth.banned_until <= now())
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_user_id::text
          and blocked.blocked_id = profile_view.viewer_id::text)
         or (blocked.blocker_id = profile_view.viewer_id::text
          and blocked.blocked_id = p_user_id::text)
    )
    and not exists (
      select 1
      from public.hidden_profiles as hidden
      where (hidden.user_id = p_user_id::text
          and hidden.hidden_user_id = profile_view.viewer_id::text)
         or (hidden.user_id = profile_view.viewer_id::text
          and hidden.hidden_user_id = p_user_id::text)
    );

  return v_visitors;
end;
$$;

revoke all on function public.get_profile_visitors(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_profile_visitors(uuid, text)
  to service_role;
