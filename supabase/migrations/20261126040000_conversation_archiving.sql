alter table public.conversation_participants
  add column if not exists archived_at timestamptz;

create or replace function public.set_conversation_archived(
  p_conversation_id uuid,
  p_archived boolean
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
  if p_archived is null then
    raise exception 'Choose whether to archive this conversation.';
  end if;
  if not public.is_active_conversation_member(p_conversation_id) then
    raise exception 'This conversation is not available.';
  end if;

  update public.conversation_participants
  set archived_at = case when p_archived then now() else null end
  where conversation_id = p_conversation_id
    and user_id = v_user_id;

  if not found then
    raise exception 'This conversation is not available.';
  end if;
end;
$$;

revoke all on function public.set_conversation_archived(uuid, boolean)
  from public, anon;
grant execute on function public.set_conversation_archived(uuid, boolean)
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
