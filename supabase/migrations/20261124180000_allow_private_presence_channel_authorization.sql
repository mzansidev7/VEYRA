drop policy if exists "Eligible members can read user online presence"
  on realtime.messages;

create policy "Eligible members can read user online presence"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and case
      when realtime.topic() ~ '^user-presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_view_online_presence(
          split_part(realtime.topic(), ':', 2)::uuid
        )
      else false
    end
  );
