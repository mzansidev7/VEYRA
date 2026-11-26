alter table public.app_release_updates
  alter column download_url drop not null;

create or replace function public.publish_app_release(
  p_version text,
  p_description text,
  p_download_url text,
  p_media jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  release_record public.app_release_updates%rowtype;
  clean_download_url text := nullif(btrim(p_download_url), '');
begin
  if current_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '28000';
  end if;
  if not public.staff_has_permission('notifications.send') then
    raise exception 'Notification sending permission is required.'
      using errcode = '42501';
  end if;
  if p_version is null or char_length(btrim(p_version)) not between 1 and 40 then
    raise exception 'Version must be between 1 and 40 characters.'
      using errcode = '22023';
  end if;
  if p_description is null
    or char_length(btrim(p_description)) not between 1 and 5000 then
    raise exception 'Description must be between 1 and 5000 characters.'
      using errcode = '22023';
  end if;
  if clean_download_url is not null
    and (
      char_length(clean_download_url) > 2048
      or clean_download_url !~* '^https://[^[:space:]]+$'
    ) then
    raise exception 'Enter a valid HTTPS download link or leave it blank.'
      using errcode = '22023';
  end if;
  if p_media is null
    or jsonb_typeof(p_media) <> 'array'
    or jsonb_array_length(p_media) > 8 then
    raise exception 'Add no more than eight media items.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_media) as media_item(value)
    where jsonb_typeof(media_item.value) <> 'object'
      or coalesce(media_item.value->>'kind', '') not in ('image', 'video')
      or char_length(coalesce(media_item.value->>'url', '')) > 2048
      or coalesce(media_item.value->>'url', '') !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'Release media must contain valid HTTPS image or video links.'
      using errcode = '22023';
  end if;

  insert into public.app_release_updates (
    version,
    description,
    download_url,
    media,
    published_by
  )
  values (
    btrim(p_version),
    btrim(p_description),
    clean_download_url,
    p_media,
    current_user_id
  )
  returning * into release_record;

  return jsonb_build_object(
    'id', release_record.id,
    'version', release_record.version,
    'description', release_record.description,
    'download_url', release_record.download_url,
    'media', release_record.media,
    'published_at', release_record.published_at
  );
end;
$$;
