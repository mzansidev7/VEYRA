insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp',
    'audio/mp4',
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

drop policy if exists "Matched participants can read chat attachments"
  on storage.objects;
create policy "Matched participants can read chat attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_active_conversation_member(
      (storage.foldername(name))[1]::uuid
    )
  );

drop policy if exists "Matched participants can upload chat attachments"
  on storage.objects;
create policy "Matched participants can upload chat attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_active_conversation_member(
      (storage.foldername(name))[1]::uuid
    )
  );
