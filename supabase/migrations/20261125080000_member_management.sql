insert into public.staff_permissions (code, description)
values (
  'users.view_sensitive',
  'View sensitive member profile and contact information.'
)
on conflict (code) do update
set description = excluded.description;

insert into public.staff_role_permissions (role_code, permission_code)
values
  ('super_admin', 'users.view_sensitive'),
  ('administrator', 'users.view_sensitive')
on conflict do nothing;

drop function if exists public.get_staff_member_directory(
  integer, integer, text, text, text, text, date, date, text, text, text
);

create or replace function public.get_staff_member_directory(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_account_status text default 'all',
  p_verification_status text default 'all',
  p_activity_status text default 'all',
  p_registered_from date default null,
  p_registered_to date default null,
  p_location text default null,
  p_sort_by text default 'registration',
  p_sort_direction text default 'desc',
  p_gender text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_sensitive boolean := public.staff_has_permission('users.view_sensitive');
  can_view_verification boolean := public.staff_has_permission('verification.view');
  result jsonb;
begin
  if (select auth.uid()) is null
    or not public.staff_has_permission('users.view')
  then
    raise exception 'Member directory access is required.'
      using errcode = '42501';
  end if;

  if p_page is null or p_page < 1
    or p_page_size is null or p_page_size < 1 or p_page_size > 100
    or p_search is not null and char_length(btrim(p_search)) > 100
    or p_location is not null and char_length(btrim(p_location)) > 100
    or p_account_status not in ('all', 'active', 'suspended')
    or p_gender is null
    or p_gender not in (
      'all', 'Woman', 'Man', 'Non-binary', 'Self-describe', 'not_provided'
    )
    or p_verification_status not in (
      'all', 'unverified', 'pending', 'verified', 'rejected', 'review_required'
    )
    or p_activity_status not in ('all', 'active', 'inactive')
    or p_sort_by not in ('registration', 'name')
    or p_sort_direction not in ('asc', 'desc')
    or p_registered_from is not null and p_registered_to is not null
      and p_registered_from > p_registered_to
  then
    raise exception 'Choose valid member filters and pagination values.'
      using errcode = '22023';
  end if;

  if p_verification_status <> 'all' and not can_view_verification then
    raise exception 'Verification viewing permission is required for this filter.'
      using errcode = '42501';
  end if;

  if p_gender <> 'all' and not can_view_sensitive then
    raise exception 'Sensitive member access is required for the gender filter.'
      using errcode = '42501';
  end if;

  with members as materialized (
    select
      auth_user.id,
      auth_user.email,
      auth_user.created_at,
      auth_user.banned_until,
      dating_profile.profile,
      dating_profile.province,
      dating_profile.country,
      verification.email_verified,
      verification.photo_verification_status,
      verification.identity_verification_status,
      (
        select max(activity.last_seen_at)
        from public.member_activity_days as activity
        where activity.user_id = auth_user.id
      ) as last_active_at,
      coalesce(
        nullif(btrim(dating_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ) as display_name
    from auth.users as auth_user
    left join public.dating_profiles as dating_profile
      on dating_profile.user_id = auth_user.id
    left join public.user_verifications as verification
      on verification.user_id = auth_user.id::text
    where not auth_user.is_anonymous
      and auth_user.deleted_at is null
      and not exists (
        select 1
        from public.staff_members as staff
        where staff.user_id = auth_user.id
      )
  ),
  enriched as materialized (
    select
      member.*,
      case
        when member.banned_until > now() then 'suspended'
        else 'active'
      end as account_status,
      case
        when member.identity_verification_status = 'verified'
          or member.photo_verification_status = 'verified' then 'verified'
        when member.identity_verification_status = 'pending'
          or member.photo_verification_status = 'pending' then 'pending'
        when member.identity_verification_status = 'review_required'
          or member.photo_verification_status = 'review_required' then 'review_required'
        when member.identity_verification_status = 'rejected'
          or member.photo_verification_status = 'rejected' then 'rejected'
        else 'unverified'
      end as verification_status
    from members as member
  ),
  filtered as materialized (
    select member.*
    from enriched as member
    where (
        p_account_status = 'all'
        or member.account_status = p_account_status
      )
      and (
        p_verification_status = 'all'
        or member.verification_status = p_verification_status
      )
      and (
        p_activity_status = 'all'
        or (p_activity_status = 'active'
          and member.last_active_at >= now() - interval '30 days')
        or (p_activity_status = 'inactive'
          and (member.last_active_at is null
            or member.last_active_at < now() - interval '30 days'))
      )
      and (
        p_gender = 'all'
        or (
          p_gender = 'not_provided'
          and nullif(btrim(member.profile->'profile'->>'gender'), '') is null
        )
        or (
          p_gender <> 'not_provided'
          and lower(btrim(member.profile->'profile'->>'gender')) = lower(p_gender)
        )
      )
      and (
        p_registered_from is null
        or member.created_at >=
          (p_registered_from::timestamp at time zone 'Africa/Johannesburg')
      )
      and (
        p_registered_to is null
        or member.created_at <
          ((p_registered_to + 1)::timestamp at time zone 'Africa/Johannesburg')
      )
      and (
        nullif(btrim(p_location), '') is null
        or position(lower(btrim(p_location)) in lower(concat_ws(
          ' ',
          member.profile->'profile'->>'city',
          member.province,
          member.country
        ))) > 0
      )
      and (
        nullif(btrim(p_search), '') is null
        or position(lower(btrim(p_search)) in lower(member.display_name)) > 0
        or position(lower(btrim(p_search)) in member.id::text) > 0
        or (
          can_view_sensitive
          and position(lower(btrim(p_search)) in lower(coalesce(member.email, ''))) > 0
        )
      )
  ),
  page_rows as (
    select member.*
    from filtered as member
    order by
      case when p_sort_by = 'name' and p_sort_direction = 'asc'
        then lower(member.display_name) end asc nulls last,
      case when p_sort_by = 'name' and p_sort_direction = 'desc'
        then lower(member.display_name) end desc nulls last,
      case when p_sort_by = 'registration' and p_sort_direction = 'asc'
        then member.created_at end asc nulls last,
      case when p_sort_by = 'registration' and p_sort_direction = 'desc'
        then member.created_at end desc nulls last,
      member.id
    limit p_page_size
    offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page,
    'page_size', p_page_size,
    'total', (select count(*) from filtered),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', member.id,
        'display_name', member.display_name,
        'email', case when can_view_sensitive then member.email else null end,
        'created_at', member.created_at,
        'last_active_at', member.last_active_at,
        'account_status', member.account_status,
        'banned_until', member.banned_until,
        'verification_status', case
          when can_view_verification then member.verification_status
          else null
        end,
        'email_verified', case
          when can_view_verification then coalesce(member.email_verified, false)
          else null
        end,
        'city', member.profile->'profile'->>'city',
        'province', member.province,
        'country', member.country,
        'gender', case when can_view_sensitive
          then nullif(btrim(member.profile->'profile'->>'gender'), '')
          else null
        end
      ) order by
        case when p_sort_by = 'name' and p_sort_direction = 'asc'
          then lower(member.display_name) end asc nulls last,
        case when p_sort_by = 'name' and p_sort_direction = 'desc'
          then lower(member.display_name) end desc nulls last,
        case when p_sort_by = 'registration' and p_sort_direction = 'asc'
          then member.created_at end asc nulls last,
        case when p_sort_by = 'registration' and p_sort_direction = 'desc'
          then member.created_at end desc nulls last,
        member.id)
      from page_rows as member
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_staff_member_details(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_view_sensitive boolean := public.staff_has_permission('users.view_sensitive');
  can_view_verification boolean := public.staff_has_permission('verification.view');
  can_view_moderation boolean := public.staff_has_permission('moderation.view');
  can_manage_suspension boolean := public.staff_has_permission('users.suspend');
  result jsonb;
begin
  if (select auth.uid()) is null
    or not public.staff_has_permission('users.view')
  then
    raise exception 'Member viewing permission is required.'
      using errcode = '42501';
  end if;

  if p_user_id is null or exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = p_user_id
  ) then
    raise exception 'A valid member account is required.'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'member', jsonb_build_object(
      'user_id', auth_user.id,
      'display_name', coalesce(
        nullif(btrim(dating_profile.profile->'profile'->>'nickname'), ''),
        'VEYRA member'
      ),
      'email', case when can_view_sensitive then auth_user.email else null end,
      'created_at', auth_user.created_at,
      'account_status', case
        when auth_user.banned_until > now() then 'suspended'
        else 'active'
      end,
      'banned_until', auth_user.banned_until,
      'last_active_at', (
        select max(activity.last_seen_at)
        from public.member_activity_days as activity
        where activity.user_id = auth_user.id
      ),
      'city', dating_profile.profile->'profile'->>'city',
      'province', dating_profile.province,
      'country', dating_profile.country,
      'email_verified', case
        when can_view_verification then coalesce(verification.email_verified, false)
        else null
      end
    ),
    'profile', jsonb_build_object(
      'nickname', dating_profile.profile->'profile'->>'nickname',
      'bio', dating_profile.profile->'profile'->>'bio',
      'city', dating_profile.profile->'profile'->>'city',
      'province', dating_profile.province,
      'country', dating_profile.country,
      'interests', coalesce(dating_profile.profile->'profile'->'interests', '[]'::jsonb),
      'intentions', coalesce(dating_profile.profile->'intentions', '[]'::jsonb),
      'profile_completion', case
        when dating_profile.user_id is null then 'no profile'
        when jsonb_array_length(case
          when jsonb_typeof(dating_profile.profile->'intentions') = 'array'
            then dating_profile.profile->'intentions'
          else '[]'::jsonb
        end) > 0
          and nullif(btrim(dating_profile.profile->'profile'->>'nickname'), '') is not null
          and nullif(btrim(dating_profile.profile->'profile'->>'birthday'), '') is not null
          and nullif(btrim(dating_profile.profile->'profile'->>'gender'), '') is not null
          and jsonb_array_length(case
            when jsonb_typeof(dating_profile.profile->'profile'->'photos') = 'array'
              then dating_profile.profile->'profile'->'photos'
            else '[]'::jsonb
          end) > 0
          and nullif(btrim(dating_profile.profile->'profile'->>'city'), '') is not null
          and nullif(btrim(dating_profile.profile->'profile'->>'bio'), '') is not null
          and jsonb_array_length(case
            when jsonb_typeof(dating_profile.profile->'datingDNA'->'relationshipGoals') = 'array'
              then dating_profile.profile->'datingDNA'->'relationshipGoals'
            else '[]'::jsonb
          end) > 0
          and nullif(btrim(dating_profile.profile->'datingDNA'->>'communicationStyle'), '') is not null
          and jsonb_array_length(case
            when jsonb_typeof(dating_profile.profile->'datingDNA'->'values') = 'array'
              then dating_profile.profile->'datingDNA'->'values'
            else '[]'::jsonb
          end) > 0
          and nullif(btrim(dating_profile.profile->'datingDNA'->>'idealWeekend'), '') is not null
          and jsonb_array_length(case
            when jsonb_typeof(dating_profile.profile->'preferences'->'genders') = 'array'
              then dating_profile.profile->'preferences'->'genders'
            else '[]'::jsonb
          end) > 0
          then 'complete'
        else 'incomplete'
      end,
      'birthday', case when can_view_sensitive
        then dating_profile.profile->'profile'->>'birthday' else null end,
      'gender', case when can_view_sensitive
        then dating_profile.profile->'profile'->>'gender' else null end,
      'occupation', case when can_view_sensitive
        then dating_profile.profile->'profile'->>'occupation' else null end,
      'education', case when can_view_sensitive
        then dating_profile.profile->'profile'->>'education' else null end,
      'dating_dna', case when can_view_sensitive
        then dating_profile.profile->'datingDNA' else null end,
      'preferences', case when can_view_sensitive
        then dating_profile.profile->'preferences' else null end
    ),
    'photo_paths', case when can_view_sensitive then coalesce((
      select jsonb_agg(photo.path)
      from (
        select photo.value as path
        from jsonb_array_elements_text(case
          when jsonb_typeof(dating_profile.profile->'profile'->'photos') = 'array'
            then dating_profile.profile->'profile'->'photos'
          else '[]'::jsonb
        end) as photo(value)
        where photo.value like auth_user.id::text || '/%'
          and position('://' in photo.value) = 0
          and position('..' in photo.value) = 0
      ) as photo
    ), '[]'::jsonb) else '[]'::jsonb end,
    'verification', case when can_view_verification then jsonb_build_object(
      'email_verified', coalesce(verification.email_verified, false),
      'photo_status', coalesce(verification.photo_verification_status, 'not_started'),
      'identity_status', coalesce(verification.identity_verification_status, 'not_started'),
      'updated_at', verification.updated_at
    ) else null end,
    'verification_history', case when can_view_verification then coalesce((
      select jsonb_agg(jsonb_build_object(
        'verification_type', event.verification_type,
        'old_status', event.old_status,
        'new_status', event.new_status,
        'changed_at', event.changed_at
      ) order by event.changed_at desc)
      from (
        select verification_event.*
        from public.user_verification_events as verification_event
        where verification_event.user_id = auth_user.id
        order by verification_event.changed_at desc
        limit 10
      ) as event
    ), '[]'::jsonb) else '[]'::jsonb end,
    'activity', jsonb_build_object(
      'likes_sent', (select count(*) from public.likes as like_record
        where like_record.sender_id = auth_user.id),
      'likes_received', (select count(*) from public.likes as like_record
        where like_record.receiver_id = auth_user.id),
      'matches', (select count(*) from public.matches as match
        where match.status = 'active'
          and auth_user.id in (match.user_one_id, match.user_two_id)),
      'messages_sent', (select count(*) from public.messages as message
        where message.sender_id = auth_user.id),
      'video_sessions', (select count(*) from public.video_discovery_sessions as session
        where session.initiated_by = auth_user.id),
      'profile_visits', (select count(*) from public.profile_views as profile_view
        where profile_view.viewed_user_id = auth_user.id)
    ),
    'safety', jsonb_build_object(
      'block_count', (select count(*) from public.blocked_users as blocked
        where blocked.blocker_id = auth_user.id::text
          or blocked.blocked_id = auth_user.id::text),
      'reports', case when can_view_moderation then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', report.id,
          'relation', case when report.reported_user_id = auth_user.id
            then 'reported' else 'reporter' end,
          'reason', report.reason,
          'status', report.status,
          'priority', report.priority,
          'created_at', report.created_at
        ) order by report.created_at desc)
        from (
          select user_report.*
          from public.user_reports as user_report
          where user_report.reporter_id = auth_user.id
            or user_report.reported_user_id = auth_user.id
          order by user_report.created_at desc
          limit 20
        ) as report
      ), '[]'::jsonb) else null end
    ),
    'account_actions', case when can_manage_suspension then coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', audit.action,
        'reason', audit.details->>'reason',
        'status', audit.details->>'status',
        'actor_name', coalesce(staff.full_name, 'Former staff member'),
        'created_at', audit.created_at
      ) order by audit.created_at desc)
      from (
        select account_audit.*
        from public.staff_audit_logs as account_audit
        where account_audit.target_user_id = auth_user.id
          and account_audit.action in (
            'member.account.suspended',
            'member.account.reinstated'
          )
        order by account_audit.created_at desc
        limit 20
      ) as audit
      left join public.staff_members as staff
        on staff.id = audit.actor_staff_member_id
    ), '[]'::jsonb) else null end
  )
  into result
  from auth.users as auth_user
  left join public.dating_profiles as dating_profile
    on dating_profile.user_id = auth_user.id
  left join public.user_verifications as verification
    on verification.user_id = auth_user.id::text
  where auth_user.id = p_user_id
    and not auth_user.is_anonymous
    and auth_user.deleted_at is null
    and not exists (
      select 1
      from public.staff_members as staff
      where staff.user_id = auth_user.id
    );

  if result is null then
    raise exception 'Member was not found.'
      using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.get_staff_member_photo_paths(
  p_user_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null
    or not public.staff_has_permission('users.view')
  then
    raise exception 'Member viewing permission is required.'
      using errcode = '42501';
  end if;
  if p_user_ids is null or cardinality(p_user_ids) < 1
    or cardinality(p_user_ids) > 100
    or array_position(p_user_ids, null) is not null
  then
    raise exception 'Choose up to 100 valid member IDs.'
      using errcode = '22023';
  end if;

  with first_photos as (
    select distinct on (auth_user.id)
      auth_user.id,
      photo.value as path
    from auth.users as auth_user
    join public.dating_profiles as dating_profile
      on dating_profile.user_id = auth_user.id
    cross join lateral jsonb_array_elements_text(case
      when jsonb_typeof(dating_profile.profile->'profile'->'photos') = 'array'
        then dating_profile.profile->'profile'->'photos'
      else '[]'::jsonb
    end) with ordinality as photo(value, position)
    where auth_user.id = any(p_user_ids)
      and not auth_user.is_anonymous
      and auth_user.deleted_at is null
      and not exists (
        select 1
        from public.staff_members as staff
        where staff.user_id = auth_user.id
      )
      and photo.value like auth_user.id::text || '/%'
      and position('://' in photo.value) = 0
      and position('..' in photo.value) = 0
    order by auth_user.id, photo.position
  )
  select coalesce(jsonb_object_agg(id::text, path), '{}'::jsonb)
  into result
  from first_photos;

  return result;
end;
$$;

revoke all on function public.get_staff_member_directory(
  integer, integer, text, text, text, text, date, date, text, text, text, text
) from public, anon;
revoke all on function public.get_staff_member_details(uuid)
  from public, anon;
revoke all on function public.get_staff_member_photo_paths(uuid[])
  from public, anon;
grant execute on function public.get_staff_member_directory(
  integer, integer, text, text, text, text, date, date, text, text, text, text
) to authenticated;
grant execute on function public.get_staff_member_details(uuid)
  to authenticated;
grant execute on function public.get_staff_member_photo_paths(uuid[])
  to authenticated;

create or replace function public.update_member_profile_by_staff(
  p_user_id uuid,
  p_nickname text,
  p_photo_paths text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  staff_member_id uuid;
  profile_document jsonb;
  previous_nickname text;
  previous_photo_paths text[];
  next_nickname text := btrim(coalesce(p_nickname, ''));
begin
  if current_user_id is null
    or not public.staff_has_permission('users.manage')
  then
    raise exception 'Member edit permission is required.'
      using errcode = '42501';
  end if;
  if p_user_id is null
    or next_nickname = ''
    or char_length(next_nickname) > 100
    or next_nickname ~ '[[:cntrl:]]'
    or p_photo_paths is null
    or cardinality(p_photo_paths) < 1
    or cardinality(p_photo_paths) > 6
    or array_position(p_photo_paths, null) is not null
    or cardinality(p_photo_paths) <> (
      select count(distinct photo_path)::integer
      from unnest(p_photo_paths) as photo(photo_path)
    )
  then
    raise exception 'Provide a name up to 100 characters and between 1 and 6 unique photos.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.staff_members as staff
    where staff.user_id = p_user_id
  ) then
    raise exception 'Staff profiles cannot be edited as member profiles.'
      using errcode = '42501';
  end if;

  select dating_profile.profile
  into profile_document
  from public.dating_profiles as dating_profile
  where dating_profile.user_id = p_user_id
  for update;
  if profile_document is null then
    raise exception 'Member profile was not found.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from unnest(p_photo_paths) as photo(photo_path)
    where photo.photo_path not like p_user_id::text || '/%'
      or photo.photo_path like '%..%'
      or photo.photo_path like '%://%'
      or not exists (
        select 1
        from storage.objects as stored_photo
        where stored_photo.bucket_id = 'profile-photos'
          and stored_photo.name = photo.photo_path
      )
  ) then
    raise exception 'Each selected photo must be an existing image owned by this member.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('veyra:dating-profile-nickname-unique', 0)
  );
  if exists (
    select 1
    from public.dating_profiles as other_profile
    where other_profile.user_id <> p_user_id
      and lower(btrim(other_profile.profile->'profile'->>'nickname'))
        = lower(next_nickname)
  ) then
    raise exception 'That display name is already in use.'
      using errcode = '23505';
  end if;

  previous_nickname := profile_document->'profile'->>'nickname';
  select coalesce(array_agg(photo.value), array[]::text[])
  into previous_photo_paths
  from jsonb_array_elements_text(case
    when jsonb_typeof(profile_document->'profile'->'photos') = 'array'
      then profile_document->'profile'->'photos'
    else '[]'::jsonb
  end) as photo(value);

  update public.dating_profiles as dating_profile
  set profile = jsonb_set(
    jsonb_set(
      dating_profile.profile,
      '{profile,nickname}',
      to_jsonb(next_nickname),
      true
    ),
    '{profile,photos}',
    to_jsonb(p_photo_paths),
    true
  ),
  updated_at = now()
  where dating_profile.user_id = p_user_id;

  select member.id
  into staff_member_id
  from public.staff_members as member
  where member.user_id = current_user_id
    and member.status = 'active';
  if staff_member_id is null then
    raise exception 'Active staff membership is required.'
      using errcode = '42501';
  end if;

  insert into public.staff_audit_logs (
    actor_staff_member_id,
    actor_user_id,
    target_user_id,
    action,
    details
  )
  values (
    staff_member_id,
    current_user_id,
    p_user_id,
    'member.profile.updated',
    jsonb_build_object(
      'changed_fields', array['nickname', 'photos'],
      'previous_nickname', previous_nickname,
      'new_nickname', next_nickname,
      'previous_photo_count', cardinality(previous_photo_paths),
      'new_photo_count', cardinality(p_photo_paths)
    )
  );

  return jsonb_build_object(
    'previous_photo_paths', to_jsonb(previous_photo_paths),
    'new_photo_paths', to_jsonb(p_photo_paths),
    'nickname', next_nickname
  );
end;
$$;

revoke all on function public.update_member_profile_by_staff(uuid, text, text[])
  from public, anon;
grant execute on function public.update_member_profile_by_staff(uuid, text, text[])
  to authenticated;
