alter table public.user_privacy_settings
  add column if not exists incognito_mode boolean not null default false,
  add column if not exists profile_visitor_history_enabled boolean not null default true;

alter table public.profile_views
  add column if not exists first_viewed_at timestamptz,
  add column if not exists owner_action text not null default 'pending'
    check (owner_action in ('pending', 'liked', 'passed'));

update public.profile_views
set first_viewed_at = last_viewed_at
where first_viewed_at is null;

alter table public.profile_views
  alter column first_viewed_at set default now(),
  alter column first_viewed_at set not null;

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
    first_viewed_at,
    last_viewed_at
  )
  select p_viewer_id, p_viewed_user_id, now(), now()
  where exists (
    select 1
    from public.dating_profiles as viewer
    join public.dating_profiles as viewed
      on viewed.user_id = p_viewed_user_id
    where viewer.user_id = p_viewer_id
  )
    and not exists (
      select 1
      from public.user_privacy_settings as viewer_privacy
      where viewer_privacy.user_id = p_viewer_id
        and viewer_privacy.incognito_mode
    )
    and coalesce((
      select owner_privacy.profile_visitor_history_enabled
      from public.user_privacy_settings as owner_privacy
      where owner_privacy.user_id = p_viewed_user_id
    ), true)
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
      'first_viewed_at', profile_view.first_viewed_at,
      'viewed_at', profile_view.last_viewed_at,
      'active_match', exists (
        select 1
        from public.matches as match
        where match.status = 'active'
          and (
            (match.user_one_id = p_user_id
              and match.user_two_id = profile_view.viewer_id)
            or (match.user_one_id = profile_view.viewer_id
              and match.user_two_id = p_user_id)
          )
      )
    )
    order by profile_view.last_viewed_at desc
  ), '[]'::jsonb)
  into v_visitors
  from public.profile_views as profile_view
  join public.dating_profiles as visitor
    on visitor.user_id = profile_view.viewer_id
  join auth.users as visitor_auth
    on visitor_auth.id = profile_view.viewer_id
  left join public.user_privacy_settings as visitor_privacy
    on visitor_privacy.user_id = profile_view.viewer_id
  where profile_view.viewed_user_id = p_user_id
    and profile_view.owner_action = 'pending'
    and not coalesce(visitor_privacy.incognito_mode, false)
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

create or replace function public.respond_to_profile_visitor(
  p_user_id uuid,
  p_visitor_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_action text;
  v_matched boolean;
begin
  if p_action not in ('like', 'pass') then
    raise exception 'Choose like or pass for this profile visitor.';
  end if;
  if p_user_id is null or p_visitor_id is null or p_user_id = p_visitor_id then
    raise exception 'This profile visitor is no longer available.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(least(p_user_id::text, p_visitor_id::text) || ':' ||
      greatest(p_user_id::text, p_visitor_id::text))
  );

  if not exists (
    select 1
    from public.profile_views as profile_view
    where profile_view.viewer_id = p_visitor_id
      and profile_view.viewed_user_id = p_user_id
      and profile_view.owner_action = 'pending'
  ) or exists (
    select 1
    from public.user_privacy_settings as privacy
    where privacy.user_id = p_visitor_id
      and privacy.incognito_mode
  ) or exists (
    select 1
    from public.blocked_users as blocked
    where (blocked.blocker_id = p_user_id::text
        and blocked.blocked_id = p_visitor_id::text)
       or (blocked.blocker_id = p_visitor_id::text
        and blocked.blocked_id = p_user_id::text)
  ) or exists (
    select 1
    from public.hidden_profiles as hidden
    where (hidden.user_id = p_user_id::text
        and hidden.hidden_user_id = p_visitor_id::text)
       or (hidden.user_id = p_visitor_id::text
        and hidden.hidden_user_id = p_user_id::text)
  ) then
    raise exception 'This profile visitor is no longer available.';
  end if;

  select exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and (
        (match.user_one_id = p_user_id and match.user_two_id = p_visitor_id)
        or (match.user_one_id = p_visitor_id and match.user_two_id = p_user_id)
      )
  ) into v_matched;

  if v_matched then
    return jsonb_build_object(
      'success', true,
      'matched', true,
      'action', 'message'
    );
  end if;

  if p_action = 'pass' then
    update public.profile_views
    set owner_action = 'passed'
    where viewer_id = p_visitor_id
      and viewed_user_id = p_user_id;

    return jsonb_build_object(
      'success', true,
      'matched', false,
      'action', 'pass'
    );
  end if;

  select action into v_existing_action
  from public.discovery_actions
  where user_id = p_user_id
    and target_user_id = p_visitor_id;

  if v_existing_action = 'pass' then
    raise exception 'You have already passed on this profile.';
  end if;

  if v_existing_action is null then
    insert into public.discovery_actions (
      user_id,
      target_user_id,
      action,
      source
    )
    values (p_user_id, p_visitor_id, 'like', 'likes');
  end if;

  update public.profile_views
  set owner_action = 'liked'
  where viewer_id = p_visitor_id
    and viewed_user_id = p_user_id;

  select exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and (
        (match.user_one_id = p_user_id and match.user_two_id = p_visitor_id)
        or (match.user_one_id = p_visitor_id and match.user_two_id = p_user_id)
      )
  ) into v_matched;

  return jsonb_build_object(
    'success', true,
    'matched', v_matched,
    'action', case when v_matched then 'message' else 'like' end
  );
end;
$$;

revoke all on function public.respond_to_profile_visitor(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.respond_to_profile_visitor(uuid, uuid, text)
  to service_role;
