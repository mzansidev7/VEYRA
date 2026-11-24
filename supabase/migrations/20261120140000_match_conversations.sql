create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id)
    on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id, conversation_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id)
    on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_conversation_unread_idx
  on public.messages (conversation_id, created_at)
  where read_at is null;

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  reason text not null
    check (reason in ('inappropriate', 'harassment', 'spam', 'fake_profile', 'other')),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.user_reports enable row level security;

revoke all on public.conversations, public.conversation_participants,
  public.messages, public.user_reports from public, anon, authenticated;
grant select on public.messages to authenticated;
grant all on public.conversations, public.conversation_participants,
  public.messages, public.user_reports to service_role;

create or replace function public.is_active_conversation_member(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_participants as participant
    join public.conversations as conversation
      on conversation.id = participant.conversation_id
    join public.matches as match
      on match.id = conversation.match_id
    where participant.conversation_id = p_conversation_id
      and participant.user_id = auth.uid()
      and match.status = 'active'
      and not exists (
        select 1
        from public.blocked_users as blocked
        where (blocked.blocker_id = auth.uid()::text
          and blocked.blocked_id = case
            when match.user_one_id = auth.uid()
              then match.user_two_id::text
            else match.user_one_id::text
          end)
           or (blocked.blocked_id = auth.uid()::text
          and blocked.blocker_id = case
            when match.user_one_id = auth.uid()
              then match.user_two_id::text
            else match.user_one_id::text
          end)
      )
  );
$$;

revoke all on function public.is_active_conversation_member(uuid)
  from public, anon;
grant execute on function public.is_active_conversation_member(uuid)
  to authenticated, service_role;

drop policy if exists "Matched participants can read messages"
  on public.messages;
create policy "Matched participants can read messages"
  on public.messages
  for select
  to authenticated
  using (public.is_active_conversation_member(conversation_id));

create or replace function public.create_match_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
begin
  if new.status <> 'active' then
    return new;
  end if;

  insert into public.conversations (match_id)
  values (new.id)
  on conflict (match_id) do update
    set updated_at = public.conversations.updated_at
  returning id into v_conversation_id;

  insert into public.conversation_participants (
    conversation_id,
    user_id
  )
  values
    (v_conversation_id, new.user_one_id),
    (v_conversation_id, new.user_two_id)
  on conflict (conversation_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_match_conversation()
  from public, anon, authenticated;
grant execute on function public.create_match_conversation()
  to service_role;

drop trigger if exists matches_create_conversation on public.matches;
create trigger matches_create_conversation
  after insert or update of status on public.matches
  for each row
  execute function public.create_match_conversation();

insert into public.conversations (match_id)
select match.id
from public.matches as match
where match.status = 'active'
on conflict (match_id) do nothing;

insert into public.conversation_participants (conversation_id, user_id)
select conversation.id, participant.user_id
from public.conversations as conversation
join public.matches as match on match.id = conversation.match_id
cross join lateral (
  values (match.user_one_id), (match.user_two_id)
) as participant(user_id)
on conflict (conversation_id, user_id) do nothing;

create or replace function public.get_my_conversations(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := p_user_id;
  v_feed jsonb;
begin
  if v_user_id is null then
    raise exception 'A conversation owner is required.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A valid IANA timezone is required.';
  end if;

  select jsonb_build_object(
    'conversations', coalesce((
      select jsonb_agg(thread.card order by thread.updated_at desc)
      from (
        select jsonb_build_object(
          'conversation_id', conversation.id,
          'match_id', match.id,
          'other_profile', public.build_likes_profile_card(
            v_user_id,
            case
              when match.user_one_id = v_user_id then match.user_two_id
              else match.user_one_id
            end,
            p_timezone
          ),
          'last_message', case when last_message.id is null then null
            else jsonb_build_object(
              'id', last_message.id,
              'sender_id', last_message.sender_id,
              'body', last_message.body,
              'created_at', last_message.created_at,
              'read_at', last_message.read_at
            ) end,
          'unread_count', (
            select count(*)::integer
            from public.messages as unread
            where unread.conversation_id = conversation.id
              and unread.sender_id <> v_user_id
              and unread.created_at > participant.last_read_at
          ),
          'created_at', match.created_at,
          'updated_at', coalesce(last_message.created_at, conversation.created_at)
        ) as card,
        coalesce(last_message.created_at, conversation.created_at) as updated_at
        from public.conversation_participants as participant
        join public.conversations as conversation
          on conversation.id = participant.conversation_id
        join public.matches as match
          on match.id = conversation.match_id
        left join lateral (
          select message.*
          from public.messages as message
          where message.conversation_id = conversation.id
          order by message.created_at desc, message.id desc
          limit 1
        ) as last_message on true
        where participant.user_id = v_user_id
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
      ) as thread
    ), '[]'::jsonb),
    'new_matches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'match_id', match.id,
          'conversation_id', conversation.id,
          'created_at', match.created_at,
          'other_profile', public.build_likes_profile_card(
            v_user_id,
            case
              when match.user_one_id = v_user_id then match.user_two_id
              else match.user_one_id
            end,
            p_timezone
          )
        )
        order by match.created_at desc
      )
      from public.conversation_participants as participant
      join public.conversations as conversation
        on conversation.id = participant.conversation_id
      join public.matches as match on match.id = conversation.match_id
      where participant.user_id = v_user_id
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
        and not exists (
          select 1 from public.messages as sent
          where sent.conversation_id = conversation.id
        )
    ), '[]'::jsonb)
  ) into v_feed;

  return v_feed;
end;
$$;

revoke all on function public.get_my_conversations(uuid, text)
  from public, anon;
grant execute on function public.get_my_conversations(uuid, text)
  to service_role;

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
    or not exists (
      select 1
      from public.conversation_participants as participant
      join public.conversations as conversation
        on conversation.id = participant.conversation_id
      join public.matches as match on match.id = conversation.match_id
      where participant.conversation_id = p_conversation_id
        and participant.user_id = v_user_id
        and match.status = 'active'
        and not exists (
          select 1 from public.blocked_users as blocked
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
    raise exception 'This conversation is not available.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', message.id,
    'sender_id', message.sender_id,
    'body', message.body,
    'created_at', message.created_at,
    'read_at', message.read_at
  ) order by message.created_at, message.id), '[]'::jsonb)
  into v_messages
  from public.messages as message
  where message.conversation_id = p_conversation_id;

  return v_messages;
end;
$$;

revoke all on function public.get_conversation_messages(uuid)
  from public, anon;
grant execute on function public.get_conversation_messages(uuid)
  to authenticated, service_role;

create or replace function public.send_conversation_message(
  p_conversation_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_message public.messages%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'Messages must contain between 1 and 2000 characters.';
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
    raise exception 'This conversation is not available.';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user_id, btrim(p_body))
  returning * into v_message;

  update public.conversations
  set updated_at = v_message.created_at
  where id = p_conversation_id;

  return jsonb_build_object(
    'id', v_message.id,
    'sender_id', v_message.sender_id,
    'body', v_message.body,
    'created_at', v_message.created_at,
    'read_at', v_message.read_at
  );
end;
$$;

revoke all on function public.send_conversation_message(uuid, text)
  from public, anon;
grant execute on function public.send_conversation_message(uuid, text)
  to authenticated, service_role;

create or replace function public.mark_conversation_read(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_read_receipts boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.is_active_conversation_member(p_conversation_id) then
    raise exception 'This conversation is not available.';
  end if;

  select coalesce(privacy.read_receipts, true)
  into v_read_receipts
  from (select 1) as defaults
  left join public.user_privacy_settings as privacy
    on privacy.user_id = v_user_id;

  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = v_user_id;

  if v_read_receipts then
    update public.messages
    set read_at = now()
    where conversation_id = p_conversation_id
      and sender_id <> v_user_id
      and read_at is null;
  end if;
end;
$$;

revoke all on function public.mark_conversation_read(uuid)
  from public, anon;
grant execute on function public.mark_conversation_read(uuid)
  to authenticated, service_role;

create or replace function public.unmatch_conversation(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  update public.matches as match
  set status = 'unmatched', updated_at = now()
  from public.conversations as conversation
  join public.conversation_participants as participant
    on participant.conversation_id = conversation.id
  where conversation.id = p_conversation_id
    and match.id = conversation.match_id
    and participant.user_id = v_user_id
    and match.status = 'active';

  if not found then
    raise exception 'This conversation is not available.';
  end if;
end;
$$;

revoke all on function public.unmatch_conversation(uuid)
  from public, anon;
grant execute on function public.unmatch_conversation(uuid)
  to authenticated, service_role;

create or replace function public.report_conversation_member(
  p_conversation_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_other_user_id uuid;
begin
  if p_reason not in ('inappropriate', 'harassment', 'spam', 'fake_profile', 'other') then
    raise exception 'Choose a valid report reason.';
  end if;

  select case
    when match.user_one_id = v_user_id then match.user_two_id
    else match.user_one_id
  end into v_other_user_id
  from public.conversations as conversation
  join public.matches as match on match.id = conversation.match_id
  join public.conversation_participants as participant
    on participant.conversation_id = conversation.id
  where conversation.id = p_conversation_id
    and participant.user_id = v_user_id
    and match.status = 'active';

  if v_other_user_id is null then
    raise exception 'This conversation is not available.';
  end if;

  insert into public.user_reports (
    reporter_id,
    reported_user_id,
    conversation_id,
    reason
  )
  values (v_user_id, v_other_user_id, p_conversation_id, p_reason);
end;
$$;

revoke all on function public.report_conversation_member(uuid, text)
  from public, anon;
grant execute on function public.report_conversation_member(uuid, text)
  to authenticated, service_role;

do $realtime$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$realtime$;
