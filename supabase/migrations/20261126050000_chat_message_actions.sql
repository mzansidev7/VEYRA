create table if not exists public.conversation_message_reactions (
  conversation_id uuid not null references public.conversations (id)
    on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reaction text not null
    check (reaction in ('heart', 'laugh', 'wow', 'celebrate', 'support')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists conversation_message_reactions_conversation_idx
  on public.conversation_message_reactions (conversation_id);
alter table public.conversation_message_reactions replica identity full;
alter table public.conversation_message_reactions enable row level security;
revoke all on public.conversation_message_reactions from public, anon, authenticated;
grant select on public.conversation_message_reactions to authenticated;

drop policy if exists "Active conversation members can read message reactions"
  on public.conversation_message_reactions;
create policy "Active conversation members can read message reactions"
  on public.conversation_message_reactions
  for select
  to authenticated
  using (public.is_active_conversation_member(conversation_id));

create table if not exists public.conversation_message_hidden (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.conversation_message_hidden enable row level security;
revoke all on public.conversation_message_hidden from public, anon, authenticated;

create or replace function public.set_conversation_message_reaction(
  p_message_id uuid,
  p_reaction text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_reaction is null
    or p_reaction not in ('heart', 'laugh', 'wow', 'celebrate', 'support') then
    raise exception 'Choose a supported reaction.';
  end if;
  select message.conversation_id into v_conversation_id
  from public.messages as message
  where message.id = p_message_id;
  if v_conversation_id is null
    or not public.is_active_conversation_member(v_conversation_id)
    or exists (
      select 1
      from public.conversation_message_hidden as hidden
      where hidden.message_id = p_message_id
        and hidden.user_id = v_user_id
    ) then
    raise exception 'This message is not available.';
  end if;

  if exists (
    select 1
    from public.conversation_message_reactions as reaction
    where reaction.message_id = p_message_id
      and reaction.user_id = v_user_id
      and reaction.reaction = p_reaction
  ) then
    delete from public.conversation_message_reactions
    where message_id = p_message_id
      and user_id = v_user_id;
  else
    insert into public.conversation_message_reactions (
      conversation_id,
      message_id,
      user_id,
      reaction
    )
    values (v_conversation_id, p_message_id, v_user_id, p_reaction)
    on conflict (message_id, user_id)
    do update set
      conversation_id = excluded.conversation_id,
      reaction = excluded.reaction,
      created_at = now();
  end if;
end;
$$;

do $realtime$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_message_reactions'
  ) then
    alter publication supabase_realtime
      add table public.conversation_message_reactions;
  end if;
end;
$realtime$;

revoke all on function public.set_conversation_message_reaction(uuid, text)
  from public, anon;
grant execute on function public.set_conversation_message_reaction(uuid, text)
  to authenticated, service_role;

create or replace function public.hide_conversation_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if not exists (
    select 1
    from public.messages as message
    where message.id = p_message_id
      and public.is_active_conversation_member(message.conversation_id)
  ) then
    raise exception 'This message is not available.';
  end if;

  insert into public.conversation_message_hidden (message_id, user_id)
  values (p_message_id, v_user_id)
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke all on function public.hide_conversation_message(uuid)
  from public, anon;
grant execute on function public.hide_conversation_message(uuid)
  to authenticated, service_role;

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
    'body', message.body,
    'created_at', message.created_at,
    'read_at', message.read_at,
    'reactions', coalesce(reaction_summary.reactions, '[]'::jsonb)
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
              and not exists (
                select 1
                from public.conversation_message_hidden as hidden
                where hidden.message_id = unread.id
                  and hidden.user_id = v_user_id
              )
          ),
          'archived_at', participant.archived_at,
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
            and not exists (
              select 1
              from public.conversation_message_hidden as hidden
              where hidden.message_id = message.id
                and hidden.user_id = v_user_id
            )
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
        and participant.archived_at is null
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
