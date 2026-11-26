alter table public.messages
  add column if not exists deleted_for_everyone_at timestamptz,
  add column if not exists deleted_by uuid;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_deleted_for_everyone_consistency_check'
  ) then
    alter table public.messages
      add constraint messages_deleted_for_everyone_consistency_check
      check ((deleted_for_everyone_at is null) = (deleted_by is null));
  end if;
end
$constraints$;

create table if not exists public.conversation_message_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  conversation_id uuid not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  had_reported_evidence boolean not null,
  deleted_at timestamptz not null default now()
);

alter table public.conversation_message_deletion_audit enable row level security;
revoke all on public.conversation_message_deletion_audit
  from public, anon, authenticated;
grant all on public.conversation_message_deletion_audit to service_role;

create table if not exists public.conversation_message_media_cleanup (
  message_id uuid not null,
  object_path text not null,
  queued_at timestamptz not null default now(),
  cleaned_at timestamptz,
  primary key (message_id, object_path)
);

alter table public.conversation_message_media_cleanup enable row level security;
revoke all on public.conversation_message_media_cleanup
  from public, anon, authenticated;
grant all on public.conversation_message_media_cleanup to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-report-evidence',
  'chat-report-evidence',
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

create table if not exists public.conversation_message_report_evidence (
  message_id uuid not null,
  source_path text not null,
  evidence_path text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, source_path),
  unique (evidence_path)
);

alter table public.conversation_message_report_evidence enable row level security;
revoke all on public.conversation_message_report_evidence
  from public, anon, authenticated;
grant all on public.conversation_message_report_evidence to service_role;

create table if not exists public.conversation_message_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id)
    on delete cascade,
  message_id uuid not null,
  event_type text not null check (event_type = 'deleted_for_everyone'),
  created_at timestamptz not null default now()
);

create index if not exists conversation_message_events_conversation_idx
  on public.conversation_message_events (conversation_id, created_at desc);
alter table public.conversation_message_events replica identity full;
alter table public.conversation_message_events enable row level security;
revoke all on public.conversation_message_events from public, anon, authenticated;
grant select on public.conversation_message_events to authenticated;

drop policy if exists "Active members can read conversation message events"
  on public.conversation_message_events;
create policy "Active members can read conversation message events"
  on public.conversation_message_events
  for select
  to authenticated
  using (public.is_active_conversation_member(conversation_id));

drop policy if exists "Matched participants can read messages"
  on public.messages;
create policy "Matched participants can read messages"
  on public.messages
  for select
  to authenticated
  using (
    public.is_active_conversation_member(conversation_id)
    and deleted_for_everyone_at is null
  );

do $realtime$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_message_events'
  ) then
    alter publication supabase_realtime
      add table public.conversation_message_events;
  end if;
end;
$realtime$;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
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
    'reactions', case
      when message.deleted_for_everyone_at is not null then '[]'::jsonb
      else coalesce(reaction_summary.reactions, '[]'::jsonb)
    end
  ) order by message.created_at, message.id), '[]'::jsonb)
  into v_messages
  from public.messages as message
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

create or replace function public.delete_conversation_message_for_everyone(
  p_message_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.messages%rowtype;
  v_attachment_data jsonb;
  v_item jsonb;
  v_object_path text;
  v_had_report boolean;
  v_media_paths jsonb;
begin
  if p_actor_id is null then
    raise exception 'An authenticated sender is required.'
      using errcode = '42501';
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if not found or v_message.sender_id <> p_actor_id then
    raise exception 'Only the sender can delete this message for everyone.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match on match.id = conversation.match_id
    where participant.conversation_id = v_message.conversation_id
      and participant.user_id = p_actor_id
      and match.status = 'active'
  ) then
    raise exception 'This conversation is not available.'
      using errcode = '42501';
  end if;

  if v_message.deleted_for_everyone_at is not null then
    if v_message.deleted_by <> p_actor_id then
      raise exception 'This message has already been deleted.'
        using errcode = '42501';
    end if;
  else
    select exists (
      select 1
      from public.user_reports as report
      where report.message_id = p_message_id
    ) into v_had_report;

    if left(v_message.body, length('__veyra_attachment__:')) =
      '__veyra_attachment__:' then
      begin
        v_attachment_data := substring(
          v_message.body from length('__veyra_attachment__:') + 1
        )::jsonb;
      exception when invalid_text_representation then
        v_attachment_data := null;
      end;

      if jsonb_typeof(v_attachment_data) = 'object'
        and v_attachment_data->>'kind' in ('group', 'draft')
        and jsonb_typeof(v_attachment_data->'items') = 'array'
      then
        for v_item in
          select item.value
          from jsonb_array_elements(v_attachment_data->'items') as item(value)
        loop
          v_object_path := v_item->>'path';
          if v_object_path is not null
            and left(
              v_object_path,
              length(v_message.conversation_id::text || '/' || p_actor_id::text || '/')
            ) = v_message.conversation_id::text || '/' || p_actor_id::text || '/'
            and position('..' in v_object_path) = 0
            and position('://' in v_object_path) = 0
          then
            insert into public.conversation_message_media_cleanup (
              message_id,
              object_path
            )
            values (p_message_id, v_object_path)
            on conflict (message_id, object_path) do nothing;
          end if;
        end loop;
      elsif jsonb_typeof(v_attachment_data) = 'object'
        and v_attachment_data->>'kind' in ('image', 'video', 'audio')
      then
        v_object_path := v_attachment_data->>'path';
        if v_object_path is not null
          and left(
            v_object_path,
            length(v_message.conversation_id::text || '/' || p_actor_id::text || '/')
          ) = v_message.conversation_id::text || '/' || p_actor_id::text || '/'
          and position('..' in v_object_path) = 0
          and position('://' in v_object_path) = 0
        then
          insert into public.conversation_message_media_cleanup (
            message_id,
            object_path
          )
          values (p_message_id, v_object_path)
          on conflict (message_id, object_path) do nothing;
        end if;
      end if;
    end if;

    insert into public.conversation_message_deletion_audit (
      message_id,
      conversation_id,
      actor_user_id,
      had_reported_evidence
    )
    values (
      p_message_id,
      v_message.conversation_id,
      p_actor_id,
      v_had_report
    );

    update public.messages
    set deleted_for_everyone_at = now(),
        deleted_by = p_actor_id,
        body = case
          when v_had_report then body
          else 'You deleted this message.'
        end
    where id = p_message_id;

    delete from public.conversation_message_reactions
    where message_id = p_message_id;

    insert into public.conversation_message_events (
      conversation_id,
      message_id,
      event_type
    )
    values (
      v_message.conversation_id,
      p_message_id,
      'deleted_for_everyone'
    );
  end if;

  select coalesce(jsonb_agg(cleanup.object_path), '[]'::jsonb)
  into v_media_paths
  from public.conversation_message_media_cleanup as cleanup
  where cleanup.message_id = p_message_id
    and cleanup.cleaned_at is null;

  return jsonb_build_object(
    'deleted', true,
    'reported', coalesce(v_had_report, exists (
      select 1
      from public.conversation_message_deletion_audit as audit
      where audit.message_id = p_message_id
        and audit.actor_user_id = p_actor_id
        and audit.had_reported_evidence
    )),
    'media_paths', v_media_paths
  );
end;
$$;

revoke all on function public.delete_conversation_message_for_everyone(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_conversation_message_for_everyone(uuid, uuid)
  to service_role;

create or replace function public.report_message(
  p_message_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  message_record public.messages%rowtype;
  new_report_id uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in to report a message.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = current_user_id
      and not auth_user.is_anonymous
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= now())
  ) then
    raise exception 'An active VEYRA member account is required.'
      using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in (
    'inappropriate', 'harassment', 'spam', 'fake_profile', 'other'
  ) then
    raise exception 'Choose a valid report reason.'
      using errcode = '22023';
  end if;

  select message.*
  into message_record
  from public.messages as message
  where message.id = p_message_id
  for update;

  if not found
    or message_record.deleted_for_everyone_at is not null
    or message_record.sender_id = current_user_id
    or not public.is_active_conversation_member(message_record.conversation_id)
  then
    raise exception 'This message is not available to report.'
      using errcode = '42501';
  end if;

  insert into public.user_reports (
    reporter_id, reported_user_id, conversation_id,
    reason, content_type, message_id
  )
  values (
    current_user_id, message_record.sender_id,
    message_record.conversation_id, p_reason, 'message', message_record.id
  )
  on conflict (reporter_id, message_id)
    where message_id is not null
    do nothing
  returning id into new_report_id;

  if new_report_id is null then
    select report.id
    into new_report_id
    from public.user_reports as report
    where report.reporter_id = current_user_id
      and report.message_id = message_record.id;
  end if;

  return new_report_id;
end;
$$;

revoke all on function public.report_message(uuid, text)
  from public, anon;
grant execute on function public.report_message(uuid, text)
  to authenticated;
