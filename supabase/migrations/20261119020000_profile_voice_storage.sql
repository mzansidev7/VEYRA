insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-voice-intros',
  'profile-voice-intros',
  false,
  10485760,
  array[
    'audio/mp4',
    'audio/m4a',
    'audio/aac',
    'audio/wav',
    'audio/mpeg',
    'audio/3gpp',
    'audio/webm'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own voice introductions"
  on storage.objects;
create policy "Users can read their own voice introductions"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-voice-intros'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can upload their own voice introductions"
  on storage.objects;
create policy "Users can upload their own voice introductions"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-voice-intros'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own voice introductions"
  on storage.objects;
create policy "Users can delete their own voice introductions"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-voice-intros'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
