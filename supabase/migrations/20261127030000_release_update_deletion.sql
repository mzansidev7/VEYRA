alter table public.app_release_updates
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid
    references auth.users (id) on delete set null;

update public.app_release_updates
set archived_at = published_at
where archived_at is null
  and id <> (
    select id
    from public.app_release_updates
    where deleted_at is null
    order by published_at desc, id desc
    limit 1
  );

create unique index if not exists app_release_updates_one_current_idx
  on public.app_release_updates ((true))
  where archived_at is null and deleted_at is null;

create or replace function public.archive_previous_app_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.app_release_updates
  set archived_at = now()
  where archived_at is null and deleted_at is null;
  return new;
end;
$$;

revoke all on function public.archive_previous_app_release()
  from public, anon, authenticated;

drop trigger if exists archive_previous_app_release_before_insert
  on public.app_release_updates;
create trigger archive_previous_app_release_before_insert
  before insert on public.app_release_updates
  for each row execute function public.archive_previous_app_release();

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
    and release.archived_at is null
    and release.deleted_at is null
  order by release.published_at desc
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
    and archived_at is null
    and deleted_at is null
  returning version, media into deleted_release;

  if not found then
    raise exception 'The current published release could not be found.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'version', deleted_release.version,
    'media', deleted_release.media
  );
end;
$$;

revoke all on function public.delete_app_release(uuid)
  from public, anon;
grant execute on function public.delete_app_release(uuid)
  to authenticated;
