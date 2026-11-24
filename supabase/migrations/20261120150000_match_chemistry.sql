create table if not exists public.chemistry_activities (
  activity_key text primary key,
  title text not null,
  description text not null,
  icon text not null
);

create table if not exists public.chemistry_questions (
  id uuid primary key default gen_random_uuid(),
  activity_key text not null references public.chemistry_activities(activity_key)
    on delete cascade,
  position integer not null check (position > 0),
  prompt text not null,
  choices jsonb not null default '[]'::jsonb
    check (jsonb_typeof(choices) = 'array'),
  unique (activity_key, position)
);

create table if not exists public.chemistry_sessions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  activity_key text not null references public.chemistry_activities(activity_key),
  current_question_position integer not null default 1,
  status text not null default 'active'
    check (status in ('active', 'completed')),
  started_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists chemistry_sessions_match_created_idx
  on public.chemistry_sessions(match_id, created_at desc);

create table if not exists public.chemistry_session_participants (
  session_id uuid not null references public.chemistry_sessions(id)
    on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (session_id, user_id)
);

create table if not exists public.chemistry_responses (
  session_id uuid not null references public.chemistry_sessions(id)
    on delete cascade,
  question_id uuid not null references public.chemistry_questions(id)
    on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer text not null check (char_length(btrim(answer)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, question_id, user_id)
);

create index if not exists chemistry_responses_session_question_idx
  on public.chemistry_responses(session_id, question_id);

alter table public.chemistry_activities enable row level security;
alter table public.chemistry_questions enable row level security;
alter table public.chemistry_sessions enable row level security;
alter table public.chemistry_session_participants enable row level security;
alter table public.chemistry_responses enable row level security;

revoke all on public.chemistry_activities, public.chemistry_questions,
  public.chemistry_sessions, public.chemistry_session_participants,
  public.chemistry_responses from public, anon, authenticated;
grant all on public.chemistry_activities, public.chemistry_questions,
  public.chemistry_sessions, public.chemistry_session_participants,
  public.chemistry_responses to service_role;

insert into public.chemistry_activities
  (activity_key, title, description, icon)
values
  ('deep_questions', 'Deep Questions',
    'Discover what matters to each other.', '✦'),
  ('would_you_rather', 'Would You Rather',
    'Explore preferences and personality.', '↔'),
  ('couple_games', 'Couple Games',
    'Play, laugh, and learn together.', '♡')
on conflict (activity_key) do update set
  title = excluded.title,
  description = excluded.description,
  icon = excluded.icon;

insert into public.chemistry_questions
  (activity_key, position, prompt, choices)
values
  ('deep_questions', 1, 'What does a healthy relationship look like to you?', '[]'),
  ('deep_questions', 2, 'What helps you feel genuinely appreciated?', '[]'),
  ('deep_questions', 3, 'What is something you hope to make more time for?', '[]'),
  ('deep_questions', 4, 'What did your family teach you about love?', '[]'),
  ('deep_questions', 5, 'What does emotional safety mean to you?', '[]'),
  ('deep_questions', 6, 'What is a small thing that always brightens your day?', '[]'),
  ('deep_questions', 7, 'How do you like to work through a disagreement?', '[]'),
  ('deep_questions', 8, 'What is a dream you are working toward?', '[]'),
  ('deep_questions', 9, 'What quality do you value most in a close relationship?', '[]'),
  ('deep_questions', 10, 'What is something you would love to experience together?', '[]'),
  ('would_you_rather', 1, 'A quiet evening at home or a weekend adventure?',
    '["A quiet evening at home", "A weekend adventure"]'),
  ('would_you_rather', 2, 'Plan every detail or be spontaneous?',
    '["Plan every detail", "Be spontaneous"]'),
  ('would_you_rather', 3, 'Sunrise together or a late-night conversation?',
    '["Sunrise together", "Late-night conversation"]'),
  ('would_you_rather', 4, 'Explore a new city or return to a favourite place?',
    '["Explore somewhere new", "Return to a favourite"]'),
  ('would_you_rather', 5, 'Cook together or discover a new restaurant?',
    '["Cook together", "Try a new restaurant"]'),
  ('would_you_rather', 6, 'A thoughtful note or a thoughtful surprise?',
    '["A thoughtful note", "A thoughtful surprise"]'),
  ('would_you_rather', 7, 'A beach escape or a cabin in the mountains?',
    '["A beach escape", "A mountain cabin"]'),
  ('would_you_rather', 8, 'Share a playlist or share a favourite book?',
    '["A playlist", "A favourite book"]'),
  ('would_you_rather', 9, 'A lively celebration or a small gathering?',
    '["A lively celebration", "A small gathering"]'),
  ('would_you_rather', 10, 'Take a dance class or learn to make something?',
    '["Take a dance class", "Learn to make something"]'),
  ('couple_games', 1, 'Who is more likely to plan a spontaneous trip?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 2, 'Who is more likely to make the other laugh?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 3, 'Who is more likely to remember a small detail?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 4, 'Who is more likely to choose the music?',
    '["Me", "My match", "We would take turns"]'),
  ('couple_games', 5, 'Who is more likely to try a new hobby?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 6, 'Who is more likely to suggest dessert?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 7, 'Who is more likely to start a deep conversation?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 8, 'Who is more likely to take photos on a day out?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 9, 'Who is more likely to make a detailed plan?',
    '["Me", "My match", "Both of us"]'),
  ('couple_games', 10, 'Who is more likely to turn an ordinary day into a date?',
    '["Me", "My match", "Both of us"]')
on conflict (activity_key, position) do update set
  prompt = excluded.prompt,
  choices = excluded.choices;

create or replace function public.start_chemistry_session(
  p_match_id uuid,
  p_activity_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_other_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select case when match.user_one_id = v_user_id
    then match.user_two_id else match.user_one_id end
  into v_other_user_id
  from public.matches as match
  where match.id = p_match_id
    and match.status = 'active'
    and v_user_id in (match.user_one_id, match.user_two_id)
    and not exists (
      select 1 from public.blocked_users as blocked
      where (blocked.blocker_id = v_user_id::text
        and blocked.blocked_id = case when match.user_one_id = v_user_id
          then match.user_two_id::text else match.user_one_id::text end)
         or (blocked.blocked_id = v_user_id::text
        and blocked.blocker_id = case when match.user_one_id = v_user_id
          then match.user_two_id::text else match.user_one_id::text end)
    );

  if v_other_user_id is null then
    raise exception 'Chemistry is available only with an active, unblocked match.';
  end if;
  if not exists (
    select 1 from public.chemistry_activities
    where activity_key = p_activity_key
  ) then
    raise exception 'Choose an available Chemistry activity.';
  end if;

  insert into public.chemistry_sessions(match_id, activity_key, started_by)
  values (p_match_id, p_activity_key, v_user_id)
  returning id into v_session_id;

  insert into public.chemistry_session_participants(session_id, user_id)
  values (v_session_id, v_user_id), (v_session_id, v_other_user_id);

  return v_session_id;
end;
$$;

revoke all on function public.start_chemistry_session(uuid, text)
  from public, anon;
grant execute on function public.start_chemistry_session(uuid, text)
  to authenticated;

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
  v_response_count integer;
  v_question_count integer;
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

  select question.position into v_question_position
  from public.chemistry_questions as question
  where question.id = p_question_id
    and question.activity_key = v_session.activity_key;

  if v_question_position is distinct from v_session.current_question_position then
    raise exception 'This question is no longer active.';
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

  insert into public.chemistry_responses
    (session_id, question_id, user_id, answer)
  values (p_session_id, p_question_id, v_user_id, btrim(p_answer))
  on conflict (session_id, question_id, user_id) do update
    set answer = excluded.answer, updated_at = now();

  select count(*) into v_response_count
  from public.chemistry_responses
  where session_id = p_session_id and question_id = p_question_id;

  if v_response_count = 2 then
    select count(*) into v_question_count
    from public.chemistry_questions
    where activity_key = v_session.activity_key;

    update public.chemistry_sessions
    set current_question_position = case
          when current_question_position >= v_question_count
            then v_question_count
          else current_question_position + 1
        end,
        status = case
          when current_question_position >= v_question_count
            then 'completed'
          else 'active'
        end,
        completed_at = case
          when current_question_position >= v_question_count
            then now()
          else null
        end,
        updated_at = now()
    where id = p_session_id;
  else
    update public.chemistry_sessions
    set updated_at = now()
    where id = p_session_id;
  end if;

  return jsonb_build_object(
    'waiting_for_match', v_response_count = 1,
    'advanced', v_response_count = 2
  );
end;
$$;

revoke all on function public.submit_chemistry_response(uuid, uuid, text)
  from public, anon;
grant execute on function public.submit_chemistry_response(uuid, uuid, text)
  to authenticated;

create or replace function public.get_my_chemistry_feed(
  p_user_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_feed jsonb;
begin
  if p_user_id is null or not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'A valid Chemistry feed request is required.';
  end if;

  select jsonb_build_object(
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', activity.activity_key,
        'title', activity.title,
        'description', activity.description,
        'icon', activity.icon
      ) order by activity.activity_key)
      from public.chemistry_activities as activity
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(connection.card order by connection.matched_at desc)
      from (
        select
          match.created_at as matched_at,
          jsonb_build_object(
            'match_id', match.id,
            'matched_at', match.created_at,
            'other_profile', public.build_likes_profile_card(
              p_user_id,
              case when match.user_one_id = p_user_id
                then match.user_two_id else match.user_one_id end,
              p_timezone
            ),
            'sessions', coalesce((
              select jsonb_agg(session_card.value order by session_card.created_at desc)
              from (
                select
                  session.created_at,
                  jsonb_build_object(
                    'id', session.id,
                    'activity_key', session.activity_key,
                    'status', session.status,
                    'current_question_position', session.current_question_position,
                    'created_at', session.created_at,
                    'question', case when session.status = 'active' then
                      jsonb_build_object(
                        'id', question.id,
                        'position', question.position,
                        'prompt', question.prompt,
                        'choices', question.choices
                      )
                      else null end,
                    'results', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'prompt', result_question.prompt,
                        'my_answer', result_own.answer,
                        'match_answer', result_match.answer
                      ) order by result_question.position)
                      from public.chemistry_questions as result_question
                      join public.chemistry_responses as result_own
                        on result_own.session_id = session.id
                        and result_own.question_id = result_question.id
                        and result_own.user_id = p_user_id
                      join public.chemistry_responses as result_match
                        on result_match.session_id = session.id
                        and result_match.question_id = result_question.id
                        and result_match.user_id <> p_user_id
                      where result_question.activity_key = session.activity_key
                    ), '[]'::jsonb),
                    'my_answer', case when session.status = 'active'
                      then own_response.answer else null end,
                    'match_answer', case when session.status = 'active'
                          and own_response.id is not null
                          and match_response.id is not null
                      then match_response.answer else null end
                  ) as value
                from public.chemistry_sessions as session
                left join public.chemistry_questions as question
                  on question.activity_key = session.activity_key
                  and question.position = session.current_question_position
                left join lateral (
                  select response.answer, response.user_id as id
                  from public.chemistry_responses as response
                  where response.session_id = session.id
                    and response.question_id = question.id
                    and response.user_id = p_user_id
                ) as own_response on true
                left join lateral (
                  select response.answer, response.user_id as id
                  from public.chemistry_responses as response
                  where response.session_id = session.id
                    and response.question_id = question.id
                    and response.user_id <> p_user_id
                ) as match_response on true
                where session.match_id = match.id
              ) as session_card
            ), '[]'::jsonb)
          ) as card
        from public.matches as match
        where match.status = 'active'
          and p_user_id in (match.user_one_id, match.user_two_id)
          and not exists (
            select 1 from public.blocked_users as blocked
            where (blocked.blocker_id = p_user_id::text
              and blocked.blocked_id = case when match.user_one_id = p_user_id
                then match.user_two_id::text else match.user_one_id::text end)
               or (blocked.blocked_id = p_user_id::text
              and blocked.blocker_id = case when match.user_one_id = p_user_id
                then match.user_two_id::text else match.user_one_id::text end)
          )
      ) as connection
    ), '[]'::jsonb)
  ) into v_feed;

  return v_feed;
end;
$$;

revoke all on function public.get_my_chemistry_feed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_my_chemistry_feed(uuid, text)
  to service_role;
