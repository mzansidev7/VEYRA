insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-view-once',
  'chat-view-once',
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
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Matched participants can upload view once chat media"
  on storage.objects;
create policy "Matched participants can upload view once chat media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-view-once'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_active_conversation_member(
      (storage.foldername(name))[1]::uuid
    )
  );

create table if not exists public.conversation_view_once_settings (
  singleton boolean primary key default true check (singleton),
  retention_days smallint not null default 7
    check (retention_days between 1 and 30)
);

insert into public.conversation_view_once_settings (singleton, retention_days)
values (true, 7)
on conflict (singleton) do nothing;

alter table public.conversation_view_once_settings enable row level security;
revoke all on public.conversation_view_once_settings
  from public, anon, authenticated;
grant all on public.conversation_view_once_settings to service_role;

create table if not exists public.conversation_view_once_media (
  message_id uuid not null references public.messages (id)
    on delete cascade,
  attachment_index smallint not null default 0
    check (attachment_index between 0 and 4),
  conversation_id uuid not null references public.conversations (id)
    on delete cascade,
  sender_id uuid not null references auth.users (id)
    on delete cascade,
  object_path text not null unique,
  media_kind text not null
    check (media_kind in ('image', 'video', 'audio')),
  expires_at timestamptz not null,
  opened_at timestamptz,
  reported_at timestamptz,
  cleanup_started_at timestamptz,
  cleaned_at timestamptz,
  primary key (message_id, attachment_index)
);

alter table public.conversation_view_once_media
  add column if not exists attachment_index smallint not null default 0
    check (attachment_index between 0 and 4);
alter table public.conversation_view_once_media
  drop constraint if exists conversation_view_once_media_pkey;
alter table public.conversation_view_once_media
  add primary key (message_id, attachment_index);

create index if not exists conversation_view_once_expiry_idx
  on public.conversation_view_once_media (expires_at, message_id, attachment_index)
  where cleaned_at is null and reported_at is null;

alter table public.conversation_view_once_media enable row level security;
revoke all on public.conversation_view_once_media from public, anon, authenticated;
grant all on public.conversation_view_once_media to service_role;

create or replace function public.can_delete_unregistered_chat_upload(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
      and p_object_path ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
      and split_part(p_object_path, '/', 2) = (select auth.uid())::text
      then public.is_active_conversation_member(
        split_part(p_object_path, '/', 1)::uuid
      )
    else false
  end
  and not exists (
    select 1
    from public.messages as message
    where position(p_object_path in message.body) > 0
  );
$$;

revoke all on function public.can_delete_unregistered_chat_upload(text)
  from public, anon;
grant execute on function public.can_delete_unregistered_chat_upload(text)
  to authenticated;

drop policy if exists "Senders can remove unregistered chat uploads"
  on storage.objects;
create policy "Senders can remove unregistered chat uploads"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.can_delete_unregistered_chat_upload(name)
  );

create or replace function public.can_delete_unregistered_view_once_upload(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
      and p_object_path ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
      and split_part(p_object_path, '/', 2) = (select auth.uid())::text
      then public.is_active_conversation_member(
        split_part(p_object_path, '/', 1)::uuid
      )
    else false
  end
  and not exists (
      select 1
      from public.conversation_view_once_media as media
      where media.object_path = p_object_path
    );
$$;

revoke all on function public.can_delete_unregistered_view_once_upload(text)
  from public, anon;
grant execute on function public.can_delete_unregistered_view_once_upload(text)
  to authenticated;

drop policy if exists "Senders can remove unregistered view once uploads"
  on storage.objects;
create policy "Senders can remove unregistered view once uploads"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-view-once'
    and public.can_delete_unregistered_view_once_upload(name)
  );

alter table public.conversation_message_events
  drop constraint if exists conversation_message_events_event_type_check;
alter table public.conversation_message_events
  add constraint conversation_message_events_event_type_check
  check (event_type in (
    'deleted_for_everyone',
    'view_once_sent',
    'view_once_opened'
  ));

create or replace function public.send_view_once_conversation_message(
  p_conversation_id uuid,
  p_media_kind text,
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_extension text;
  v_expires_at timestamptz;
  v_retention_days smallint;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;
  if p_media_kind not in ('image', 'video', 'audio') then
    raise exception 'Choose a supported photo, video, or voice note.'
      using errcode = '22023';
  end if;
  if p_object_path is null
    or p_object_path not like
      p_conversation_id::text || '/' || v_user_id::text || '/%'
    or position('..' in p_object_path) > 0
    or position('://' in p_object_path) > 0
  then
    raise exception 'The protected attachment path is invalid.'
      using errcode = '22023';
  end if;

  v_extension := lower(split_part(p_object_path, '.', -1));
  if (p_media_kind = 'image'
      and v_extension not in ('jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'))
    or (p_media_kind = 'video'
      and v_extension not in ('mp4', 'mov', 'webm', '3gp'))
    or (p_media_kind = 'audio'
      and v_extension not in ('m4a', 'aac', 'wav', 'mp3', 'webm', '3gp'))
  then
    raise exception 'The protected attachment format is invalid.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match on match.id = conversation.match_id
    where participant.conversation_id = p_conversation_id
      and participant.user_id = v_user_id
      and match.status = 'active'
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = v_user_id::text
          and blocked.blocked_id = case
            when match.user_one_id = v_user_id
              then match.user_two_id::text
            else match.user_one_id::text
          end)
           or (blocked.blocked_id = v_user_id::text
          and blocked.blocker_id = case
            when match.user_one_id = v_user_id
              then match.user_two_id::text
            else match.user_one_id::text
          end)
      )
  ) then
    raise exception 'This conversation is not available.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from storage.objects as stored
    where stored.bucket_id = 'chat-view-once'
      and stored.name = p_object_path
  ) then
    raise exception 'The protected attachment upload could not be found.'
      using errcode = '22023';
  end if;

  select retention_days
  into v_retention_days
  from public.conversation_view_once_settings
  where singleton = true;
  if v_retention_days is null then
    raise exception 'View Once retention is not configured.'
      using errcode = '55000';
  end if;
  v_expires_at := now() + make_interval(days => v_retention_days);

  insert into public.messages (conversation_id, sender_id, body)
  values (
    p_conversation_id,
    v_user_id,
    '__veyra_view_once__:' || p_media_kind
  )
  returning * into v_message;

  insert into public.conversation_view_once_media (
    message_id,
    conversation_id,
    sender_id,
    object_path,
    media_kind,
    expires_at
  )
  values (
    v_message.id,
    p_conversation_id,
    v_user_id,
    p_object_path,
    p_media_kind,
    v_expires_at
  );

  update public.conversations
  set updated_at = v_message.created_at
  where id = p_conversation_id;

  insert into public.conversation_message_events (
    conversation_id,
    message_id,
    event_type
  )
  values (p_conversation_id, v_message.id, 'view_once_sent');

  return jsonb_build_object(
    'id', v_message.id,
    'sender_id', v_message.sender_id,
    'body', v_message.body,
    'created_at', v_message.created_at,
    'read_at', v_message.read_at,
    'view_once', true,
    'view_once_kind', p_media_kind,
    'view_once_opened_at', null,
    'view_once_expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.send_view_once_conversation_message(uuid, text, text)
  from public, anon;
grant execute on function public.send_view_once_conversation_message(uuid, text, text)
  to authenticated;

create or replace function public.send_view_once_conversation_message(
  p_conversation_id uuid,
  p_body text,
  p_media_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_item jsonb;
  v_body_item jsonb;
  v_body_data jsonb;
  v_index integer;
  v_kind text;
  v_object_path text;
  v_expected_protected_count integer := 0;
  v_body_path text;
  v_extension text;
  v_expires_at timestamptz;
  v_retention_days smallint;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;
  if p_body is null
    or char_length(btrim(p_body)) not between 1 and 2000
    or left(p_body, length('__veyra_attachment__:')) <>
      '__veyra_attachment__:'
  then
    raise exception 'The composed message is invalid.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_media_items) is distinct from 'array' then
    raise exception 'Choose between one and five protected attachments.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_media_items) not between 1 and 5 then
    raise exception 'Choose between one and five protected attachments.'
      using errcode = '22023';
  end if;

  begin
    v_body_data := substring(
      p_body from length('__veyra_attachment__:') + 1
    )::jsonb;
  exception when invalid_text_representation then
    raise exception 'The composed message payload is invalid.'
      using errcode = '22023';
  end;
  if jsonb_typeof(v_body_data) is distinct from 'object'
    or v_body_data->>'kind' <> 'draft'
  then
    raise exception 'The composed message attachments are invalid.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_body_data->'items') is distinct from 'array' then
    raise exception 'The composed message attachments are invalid.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_body_data->'items') not between 1 and 5 then
    raise exception 'The composed message attachments are invalid.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_body_data->'text') is distinct from 'string'
    or (
      v_body_data ? 'replyQuote'
      and v_body_data->'replyQuote' <> 'null'::jsonb
      and jsonb_typeof(v_body_data->'replyQuote') is distinct from 'string'
    )
  then
    raise exception 'The composed message text is invalid.'
      using errcode = '22023';
  end if;

  for v_body_item in
    select item.value from jsonb_array_elements(v_body_data->'items') as item(value)
  loop
    if jsonb_typeof(v_body_item) is distinct from 'object'
      or v_body_item->>'kind' not in ('image', 'video')
    then
      raise exception 'A composed attachment was invalid.'
        using errcode = '22023';
    end if;
    if v_body_item->'viewOnce' = 'true'::jsonb then
      v_expected_protected_count := v_expected_protected_count + 1;
      if v_body_item ? 'path' then
        raise exception 'Protected attachment paths cannot be included in the message.'
          using errcode = '22023';
      end if;
    else
      if v_body_item ? 'viewOnce'
        or jsonb_typeof(v_body_item->'path') is distinct from 'string'
      then
        raise exception 'A normal attachment path is invalid.'
          using errcode = '22023';
      end if;
      v_body_path := v_body_item->>'path';
      if v_body_path not like
        p_conversation_id::text || '/' || v_user_id::text || '/%'
        or position('..' in v_body_path) > 0
        or position('://' in v_body_path) > 0
        or not exists (
          select 1
          from storage.objects as stored
          where stored.bucket_id = 'chat-attachments'
            and stored.name = v_body_path
        )
      then
        raise exception 'A normal attachment upload could not be verified.'
          using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_expected_protected_count <> jsonb_array_length(p_media_items) then
    raise exception 'The protected attachment list does not match the message.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match on match.id = conversation.match_id
    where participant.conversation_id = p_conversation_id
      and participant.user_id = v_user_id
      and match.status = 'active'
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = v_user_id::text
          and blocked.blocked_id = case
            when match.user_one_id = v_user_id
              then match.user_two_id::text
            else match.user_one_id::text
          end)
           or (blocked.blocked_id = v_user_id::text
          and blocked.blocker_id = case
            when match.user_one_id = v_user_id
              then match.user_two_id::text
            else match.user_one_id::text
          end)
      )
  ) then
    raise exception 'This conversation is not available.'
      using errcode = '42501';
  end if;

  select retention_days
  into v_retention_days
  from public.conversation_view_once_settings
  where singleton = true;
  if v_retention_days is null then
    raise exception 'View Once retention is not configured.'
      using errcode = '55000';
  end if;
  v_expires_at := now() + make_interval(days => v_retention_days);

  for v_item in select value from jsonb_array_elements(p_media_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item->>'attachment_index', '') !~ '^[0-4]$'
      or jsonb_typeof(v_item->'media_kind') is distinct from 'string'
      or jsonb_typeof(v_item->'object_path') is distinct from 'string'
    then
      raise exception 'A protected attachment was invalid.'
        using errcode = '22023';
    end if;
    v_index := (v_item->>'attachment_index')::integer;
    v_kind := v_item->>'media_kind';
    v_object_path := v_item->>'object_path';
    if v_index < 0 or v_index > 4
      or v_kind not in ('image', 'video')
      or v_object_path not like
        p_conversation_id::text || '/' || v_user_id::text || '/%'
      or position('..' in v_object_path) > 0
      or position('://' in v_object_path) > 0
    then
      raise exception 'A protected attachment was invalid.'
        using errcode = '22023';
    end if;

    v_body_item := v_body_data->'items'->v_index;
    if jsonb_typeof(v_body_item) is distinct from 'object'
      or v_body_item->>'kind' is distinct from v_kind
      or v_body_item->'viewOnce' is distinct from 'true'::jsonb
      or v_body_item ? 'path'
    then
      raise exception 'The protected attachment does not match the message.'
        using errcode = '22023';
    end if;

    v_extension := lower(split_part(v_object_path, '.', -1));
    if (v_kind = 'image'
        and v_extension not in ('jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'))
      or (v_kind = 'video'
        and v_extension not in ('mp4', 'mov', 'webm', '3gp'))
    then
      raise exception 'The protected attachment format is invalid.'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
      from storage.objects as stored
      where stored.bucket_id = 'chat-view-once'
        and stored.name = v_object_path
    ) then
      raise exception 'The protected attachment upload could not be found.'
        using errcode = '22023';
    end if;
  end loop;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user_id, btrim(p_body))
  returning * into v_message;

  for v_item in select value from jsonb_array_elements(p_media_items)
  loop
    insert into public.conversation_view_once_media (
      message_id,
      attachment_index,
      conversation_id,
      sender_id,
      object_path,
      media_kind,
      expires_at
    )
    values (
      v_message.id,
      (v_item->>'attachment_index')::smallint,
      p_conversation_id,
      v_user_id,
      v_item->>'object_path',
      v_item->>'media_kind',
      v_expires_at
    );
    insert into public.conversation_message_events (
      conversation_id,
      message_id,
      event_type
    )
    values (p_conversation_id, v_message.id, 'view_once_sent');
  end loop;

  update public.conversations
  set updated_at = v_message.created_at
  where id = p_conversation_id;

  return jsonb_build_object(
    'id', v_message.id,
    'sender_id', v_message.sender_id,
    'body', v_message.body,
    'created_at', v_message.created_at,
    'read_at', v_message.read_at,
    'view_once', false,
    'view_once_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'attachment_index', media.attachment_index,
        'media_kind', media.media_kind,
        'opened_at', media.opened_at,
        'expires_at', media.expires_at
      ) order by media.attachment_index), '[]'::jsonb)
      from public.conversation_view_once_media as media
      where media.message_id = v_message.id
    )
  );
end;
$$;

revoke all on function public.send_view_once_conversation_message(
  uuid, text, jsonb
) from public, anon;
grant execute on function public.send_view_once_conversation_message(
  uuid, text, jsonb
) to authenticated;

create or replace function public.claim_view_once_message(
  p_message_id uuid,
  p_actor_id uuid,
  p_attachment_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.conversation_view_once_media%rowtype;
begin
  if p_actor_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;
  if p_attachment_index is null or p_attachment_index < 0
    or p_attachment_index > 4
  then
    raise exception 'The protected attachment index is invalid.'
      using errcode = '22023';
  end if;

  select media.*
  into v_media
  from public.conversation_view_once_media as media
  join public.messages as message on message.id = media.message_id
  join public.conversation_participants as participant
    on participant.conversation_id = media.conversation_id
    and participant.user_id = p_actor_id
  join public.conversations as conversation
    on conversation.id = media.conversation_id
  join public.matches as match on match.id = conversation.match_id
  where media.message_id = p_message_id
    and media.attachment_index = p_attachment_index
    and media.sender_id <> p_actor_id
    and media.opened_at is null
    and media.expires_at > now()
    and media.reported_at is null
    and message.deleted_for_everyone_at is null
    and match.status = 'active'
    and not exists (
      select 1
      from public.blocked_users as blocked
      where (blocked.blocker_id = p_actor_id::text
        and blocked.blocked_id = case
          when match.user_one_id = p_actor_id
            then match.user_two_id::text
          else match.user_one_id::text
        end)
         or (blocked.blocked_id = p_actor_id::text
        and blocked.blocker_id = case
          when match.user_one_id = p_actor_id
            then match.user_two_id::text
          else match.user_one_id::text
        end)
    )
  for update of media;

  if not found then
    raise exception 'This View Once attachment is no longer available.'
      using errcode = '42501';
  end if;

  update public.conversation_view_once_media
  set opened_at = now()
  where message_id = p_message_id
    and attachment_index = p_attachment_index
    and opened_at is null
    and expires_at > now()
    and reported_at is null
  returning * into v_media;

  if not found then
    raise exception 'This View Once attachment has already been opened.'
      using errcode = '42501';
  end if;

  insert into public.conversation_message_events (
    conversation_id,
    message_id,
    event_type
  )
  values (v_media.conversation_id, v_media.message_id, 'view_once_opened');

  return jsonb_build_object(
    'object_path', v_media.object_path,
    'media_kind', v_media.media_kind,
    'attachment_index', v_media.attachment_index
  );
end;
$$;

revoke all on function public.claim_view_once_message(uuid, uuid, integer)
  from public, anon, authenticated;
drop function public.claim_view_once_message(uuid, uuid);
create function public.claim_view_once_message(
  p_message_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.claim_view_once_message(p_message_id, p_actor_id, 0);
$$;

revoke all on function public.claim_view_once_message(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_view_once_message(uuid, uuid)
  to service_role;
grant execute on function public.claim_view_once_message(uuid, uuid, integer)
  to service_role;

create or replace function public.claim_expired_view_once_media(
  p_limit integer default 100
)
returns table (message_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'A valid cleanup batch size is required.'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select media.message_id, media.attachment_index
    from public.conversation_view_once_media as media
    join public.messages as message on message.id = media.message_id
    where media.cleaned_at is null
      and media.reported_at is null
      and (
        media.expires_at <= now()
        or message.deleted_for_everyone_at is not null
      )
      and (
        media.cleanup_started_at is null
        or media.cleanup_started_at < now() - interval '15 minutes'
      )
    order by media.expires_at, media.message_id, media.attachment_index
    limit p_limit
    for update of media skip locked
  )
  update public.conversation_view_once_media as media
  set cleanup_started_at = now()
  from candidates
  where media.message_id = candidates.message_id
    and media.attachment_index = candidates.attachment_index
  returning media.message_id, media.object_path;
end;
$$;

revoke all on function public.claim_expired_view_once_media(integer)
  from public, anon, authenticated;
grant execute on function public.claim_expired_view_once_media(integer)
  to service_role;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_messages jsonb;
begin
  if v_user_id is null
    or not public.is_active_conversation_member(p_conversation_id) then
    raise exception 'This conversation is not available.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', message.id,
    'sender_id', message.sender_id,
    'body', case
      when message.deleted_for_everyone_at is not null
        then 'You deleted this message.'
      else message.body
    end,
    'created_at', message.created_at,
    'read_at', message.read_at,
    'deleted_for_everyone', message.deleted_for_everyone_at is not null,
    'view_once', left(
      message.body,
      length('__veyra_view_once__:')
    ) = '__veyra_view_once__:'
      and message.deleted_for_everyone_at is null,
    'view_once_kind', case
      when message.deleted_for_everyone_at is null
        and left(message.body, length('__veyra_view_once__:')) =
          '__veyra_view_once__:'
        then view_once.single_kind
      else null
    end,
    'view_once_opened_at', case
      when message.deleted_for_everyone_at is null
        and left(message.body, length('__veyra_view_once__:')) =
          '__veyra_view_once__:'
        then view_once.single_opened_at
      else null
    end,
    'view_once_expires_at', case
      when message.deleted_for_everyone_at is null
        and left(message.body, length('__veyra_view_once__:')) =
          '__veyra_view_once__:'
        then view_once.single_expires_at
      else null
    end,
    'view_once_items', case
      when message.deleted_for_everyone_at is not null then '[]'::jsonb
      else view_once.items
    end,
    'reactions', case
      when message.deleted_for_everyone_at is not null then '[]'::jsonb
      else coalesce(reaction_summary.reactions, '[]'::jsonb)
    end
  ) order by message.created_at, message.id), '[]'::jsonb)
  into v_messages
  from public.messages as message
  left join lateral (
    select
      (array_agg(media.media_kind order by media.attachment_index))[1]
        as single_kind,
      (array_agg(media.opened_at order by media.attachment_index))[1]
        as single_opened_at,
      (array_agg(media.expires_at order by media.attachment_index))[1]
        as single_expires_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'attachment_index', media.attachment_index,
        'media_kind', media.media_kind,
        'opened_at', media.opened_at,
        'expires_at', media.expires_at
      ) order by media.attachment_index), '[]'::jsonb) as items
    from public.conversation_view_once_media as media
    where media.message_id = message.id
  ) as view_once on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'value', grouped.reaction,
      'count', grouped.reaction_count,
      'reacted_by_me', grouped.reacted_by_me
    ) order by grouped.reaction) as reactions
    from (
      select
        reaction.reaction,
        count(*)::integer as reaction_count,
        bool_or(reaction.user_id = v_user_id) as reacted_by_me
      from public.conversation_message_reactions as reaction
      where reaction.message_id = message.id
      group by reaction.reaction
    ) as grouped
  ) as reaction_summary on true
  where message.conversation_id = p_conversation_id
    and not exists (
      select 1
      from public.conversation_message_hidden as hidden
      where hidden.message_id = message.id
        and hidden.user_id = v_user_id
    );

  return v_messages;
end;
$$;

revoke all on function public.get_conversation_messages(uuid)
  from public, anon;
grant execute on function public.get_conversation_messages(uuid)
  to authenticated, service_role;

create or replace function public.mark_view_once_message_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content_type = 'message' and new.message_id is not null then
    update public.conversation_view_once_media
    set reported_at = coalesce(reported_at, new.created_at)
    where message_id = new.message_id;
  end if;
  return new;
end;
$$;

revoke all on function public.mark_view_once_message_reported()
  from public, anon, authenticated;

drop trigger if exists user_reports_preserve_view_once_media
  on public.user_reports;
create trigger user_reports_preserve_view_once_media
  after insert on public.user_reports
  for each row
  execute function public.mark_view_once_message_reported();
