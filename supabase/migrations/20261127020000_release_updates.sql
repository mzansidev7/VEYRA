create table if not exists public.app_release_updates (
  id uuid primary key default gen_random_uuid(),
  version text not null
    check (char_length(btrim(version)) between 1 and 40),
  description text not null
    check (char_length(btrim(description)) between 1 and 5000),
  download_url text not null
    check (
      char_length(download_url) <= 2048
      and download_url ~* '^https://[^[:space:]]+$'
    ),
  media jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media) = 'array'),
  published_by uuid not null references auth.users (id) on delete restrict,
  published_at timestamptz not null default now()
);

create index if not exists app_release_updates_published_idx
  on public.app_release_updates (published_at desc);

alter table public.app_release_updates enable row level security;
revoke all on public.app_release_updates from public, anon, authenticated;
grant all on public.app_release_updates to service_role;

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
  order by release.published_at desc
  limit 1;
$$;

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
  if p_download_url is null
    or char_length(p_download_url) > 2048
    or p_download_url !~* '^https://[^[:space:]]+$' then
    raise exception 'Enter a valid HTTPS download link.'
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
    btrim(p_download_url),
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

revoke all on function public.get_latest_app_release()
  from public, anon;
revoke all on function public.publish_app_release(text, text, text, jsonb)
  from public, anon;
grant execute on function public.get_latest_app_release()
  to authenticated;
grant execute on function public.publish_app_release(text, text, text, jsonb)
  to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'app-release-media',
  'app-release-media',
  true,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ];

drop policy if exists "Release managers upload app release media"
  on storage.objects;
create policy "Release managers upload app release media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'app-release-media'
    and public.staff_has_permission('notifications.send')
  );

drop policy if exists "Release managers delete app release media"
  on storage.objects;
create policy "Release managers delete app release media"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'app-release-media'
    and public.staff_has_permission('notifications.send')
  );
