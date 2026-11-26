create or replace function public.get_app_release_updates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', release.id,
        'version', release.version,
        'description', release.description,
        'download_url', release.download_url,
        'media', release.media,
        'published_at', release.published_at
      )
      order by release.published_at desc, release.id desc
    ),
    '[]'::jsonb
  )
  from public.app_release_updates as release
  where (select auth.uid()) is not null
    and release.deleted_at is null;
$$;

create or replace function public.get_latest_app_release()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', release.id,
    'version', release.version,
    'description', release.description,
    'download_url', release.download_url,
    'media', release.media,
    'published_at', release.published_at
  )
  from public.app_release_updates as release
  where (select auth.uid()) is not null
    and release.deleted_at is null
  order by release.published_at desc, release.id desc
  limit 1;
$$;

create or replace function public.delete_app_release(
  p_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deleted_release record;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '28000';
  end if;
  if not public.staff_has_permission('notifications.send') then
    raise exception 'Notification sending permission is required.'
      using errcode = '42501';
  end if;

  update public.app_release_updates
  set deleted_at = now(),
      deleted_by = current_user_id
  where id = p_release_id
    and deleted_at is null
  returning version, media into deleted_release;

  if not found then
    raise exception 'The published release could not be found.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'version', deleted_release.version,
    'media', deleted_release.media
  );
end;
$$;

revoke all on function public.get_app_release_updates()
  from public, anon;
grant execute on function public.get_app_release_updates()
  to authenticated;

revoke all on function public.get_latest_app_release()
  from public, anon;
grant execute on function public.get_latest_app_release()
  to authenticated;

revoke all on function public.delete_app_release(uuid)
  from public, anon;
grant execute on function public.delete_app_release(uuid)
  to authenticated;
