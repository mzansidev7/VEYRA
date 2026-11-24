create or replace function public.submit_chemistry_response(
  p_session_id uuid,
  p_question_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.chemistry_sessions%rowtype;
  v_question_position integer;
  v_question_count integer;
  v_group_start integer;
  v_group_end integer;
  v_response_count integer;
  v_group_complete boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_answer is null or char_length(btrim(p_answer)) not between 1 and 1000 then
    raise exception 'Your answer must contain between 1 and 1000 characters.';
  end if;

  select session.* into v_session
  from public.chemistry_sessions as session
  join public.chemistry_session_participants as participant
    on participant.session_id = session.id
  join public.matches as match on match.id = session.match_id
  where session.id = p_session_id
    and participant.user_id = v_user_id
    and session.status = 'active'
    and match.status = 'active'
    and not exists (
      select 1 from public.blocked_users as blocked
      where (blocked.blocker_id = v_user_id::text
        and blocked.blocked_id = case when match.user_one_id = v_user_id
          then match.user_two_id::text else match.user_one_id::text end)
         or (blocked.blocked_id = v_user_id::text
        and blocked.blocker_id = case when match.user_one_id = v_user_id
          then match.user_two_id::text else match.user_one_id::text end)
    )
  for update of session;

  if not found then
    raise exception 'This Chemistry session is no longer available.';
  end if;

  select count(*) into v_question_count
  from public.chemistry_questions
  where activity_key = v_session.activity_key;
  if v_question_count <> 10 then
    raise exception 'This Chemistry experience does not have exactly 10 questions.';
  end if;

  v_group_start := case
    when v_session.current_question_position <= 3 then 1
    when v_session.current_question_position <= 6 then 4
    else 7
  end;
  v_group_end := least(
    v_group_start + case when v_group_start = 7 then 3 else 2 end,
    v_question_count
  );

  select question.position into v_question_position
  from public.chemistry_questions as question
  where question.id = p_question_id
    and question.activity_key = v_session.activity_key;

  if v_question_position is null
    or v_question_position not between v_group_start and v_group_end then
    raise exception 'This question is not in the current group.';
  end if;
  if exists (
    select 1
    from public.chemistry_questions as question
    where question.id = p_question_id
      and jsonb_array_length(question.choices) > 0
      and not question.choices @> jsonb_build_array(btrim(p_answer))
  ) then
    raise exception 'Choose one of the answers shown for this question.';
  end if;
  if exists (
    select 1
    from public.chemistry_responses as response
    where response.session_id = p_session_id
      and response.question_id = p_question_id
      and response.user_id = v_user_id
  ) then
    raise exception 'You have already shared your answer to this question.';
  end if;

  insert into public.chemistry_responses
    (session_id, question_id, user_id, answer)
  values (p_session_id, p_question_id, v_user_id, btrim(p_answer));

  select count(*) into v_response_count
  from public.chemistry_responses
  where session_id = p_session_id and question_id = p_question_id;

  select not exists (
    select 1
    from public.chemistry_questions as question
    where question.activity_key = v_session.activity_key
      and question.position between v_group_start and v_group_end
      and (
        select count(*)
        from public.chemistry_responses as response
        where response.session_id = p_session_id
          and response.question_id = question.id
      ) < 2
  ) into v_group_complete;

  if v_group_complete and v_group_end >= v_question_count then
    update public.chemistry_sessions
    set current_question_position = v_question_count,
        status = 'completed',
        completed_at = now(),
        updated_at = now()
    where id = p_session_id;
  elsif v_group_complete then
    update public.chemistry_sessions
    set current_question_position = v_group_end + 1,
        updated_at = now()
    where id = p_session_id;
  else
    update public.chemistry_sessions
    set updated_at = now()
    where id = p_session_id;
  end if;

  return jsonb_build_object(
    'waiting_for_match', v_response_count = 1,
    'group_completed', v_group_complete
  );
end;
$$;

revoke all on function public.submit_chemistry_response(uuid, uuid, text)
  from public, anon;
grant execute on function public.submit_chemistry_response(uuid, uuid, text)
  to authenticated;
