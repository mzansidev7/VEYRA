drop policy if exists "Conversation members can read chat presence"
  on realtime.messages;
create policy "Conversation members can read chat presence"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and case
      when realtime.topic() ~ '^chat-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_active_conversation_member(
          split_part(realtime.topic(), ':', 2)::uuid
        )
      else false
    end
  );

drop policy if exists "Conversation members can publish chat presence"
  on realtime.messages;
create policy "Conversation members can publish chat presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and case
      when realtime.topic() ~ '^chat-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_active_conversation_member(
          split_part(realtime.topic(), ':', 2)::uuid
        )
      else false
    end
  );
