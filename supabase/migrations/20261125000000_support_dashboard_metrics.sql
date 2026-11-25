create or replace function public.get_support_dashboard_metrics(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_week_start date;
  v_month_start date;
  v_start timestamptz;
  v_end timestamptz;
  v_can_view_moderation boolean;
  v_can_view_support boolean;
  v_can_view_verification boolean;
  v_can_view_audit boolean;
  v_tracking_started_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null
    or not public.staff_has_permission('dashboard.view')
  then
    raise exception 'Dashboard access is required.'
      using errcode = '42501';
  end if;

  if p_from is null
    or p_to is null
    or p_from > p_to
    or p_to > v_today
    or p_to - p_from > 364
  then
    raise exception 'Choose a valid date range of up to 365 days ending today or earlier.'
      using errcode = '22023';
  end if;

  v_week_start := date_trunc('week', v_today::timestamp)::date;
  v_month_start := date_trunc('month', v_today::timestamp)::date;
  v_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  v_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';
  v_can_view_moderation := public.staff_has_permission('moderation.view');
  v_can_view_support := public.staff_has_permission('support.view');
  v_can_view_verification := public.staff_has_permission('verification.view');
  v_can_view_audit := public.staff_has_permission('audit_logs.view');
  select tracking_config.tracking_started_at
  into v_tracking_started_at
  from public.member_activity_tracking_config as tracking_config
  where tracking_config.singleton;

  with members as materialized (
    select auth_user.id, auth_user.created_at, auth_user.banned_until
    from auth.users as auth_user
    where auth_user.deleted_at is null
      and not auth_user.is_anonymous
      and not exists (
        select 1
        from public.staff_members as staff_member
        where staff_member.user_id = auth_user.id
      )
  ),
  tracked_interactions as materialized (
    select like_record.sender_id as user_id, like_record.created_at
    from public.likes as like_record
    where like_record.created_at >= v_start
      and like_record.created_at < v_end
    union all
    select message.sender_id, message.created_at
    from public.messages as message
    where message.created_at >= v_start
      and message.created_at < v_end
    union all
    select video_session.initiated_by, video_session.created_at
    from public.video_discovery_sessions as video_session
    where video_session.created_at >= v_start
      and video_session.created_at < v_end
  ),
  growth_by_day as (
    select dates.day::date as day, count(member.id)::bigint as registrations
    from generate_series(
      p_from::timestamp,
      p_to::timestamp,
      interval '1 day'
    ) as dates(day)
    left join members as member
      on member.created_at >=
        (dates.day::date::timestamp at time zone 'Africa/Johannesburg')
      and member.created_at <
        ((dates.day::date + 1)::timestamp at time zone 'Africa/Johannesburg')
    group by dates.day::date
  ),
  activity_events as (
    select
      'registration'::text as kind,
      'New member registered'::text as label,
      member.created_at as occurred_at
    from members as member
    where member.created_at >= v_now - interval '30 days'
    union all
    select
      'report',
      'New user report submitted',
      report.created_at
    from public.user_reports as report
    where v_can_view_moderation
      and report.created_at >= v_now - interval '30 days'
      and exists (
        select 1
        from members as reporter
        where reporter.id = report.reporter_id
      )
    union all
    select
      'report',
      'User report status updated',
      report_event.created_at
    from public.user_report_events as report_event
    where v_can_view_moderation
      and report_event.action = 'status_changed'
      and report_event.created_at >= v_now - interval '30 days'
    union all
    select
      'support',
      'New support request received',
      ticket.created_at
    from public.support_tickets as ticket
    where v_can_view_support
      and ticket.created_at >= v_now - interval '30 days'
    union all
    select
      'support',
      'Support request status updated',
      ticket_event.created_at
    from public.support_ticket_events as ticket_event
    where v_can_view_support
      and ticket_event.action = 'status_changed'
      and ticket_event.created_at >= v_now - interval '30 days'
    union all
    select
      'support',
      'Support response sent',
      ticket_event.created_at
    from public.support_ticket_events as ticket_event
    where v_can_view_support
      and ticket_event.action = 'reply_sent'
      and ticket_event.created_at >= v_now - interval '30 days'
    union all
    select
      'verification',
      'Member verification status changed',
      verification_event.changed_at
    from public.user_verification_events as verification_event
    where v_can_view_verification
      and verification_event.changed_at >= v_now - interval '30 days'
    union all
    select
      'staff',
      case audit.action
        when 'staff.login.succeeded' then 'Staff sign-in'
        when 'staff.logout' then 'Staff sign-out'
        when 'staff.invitation.accepted' then 'Staff invitation accepted'
        when 'staff.password.changed' then 'Staff password changed'
        else 'Administrative action recorded'
      end,
      audit.created_at
    from public.staff_audit_logs as audit
    where v_can_view_audit
      and audit.created_at >= v_now - interval '30 days'
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'date_range', jsonb_build_object('from', p_from, 'to', p_to),
    'overview', jsonb_build_object(
      'total_members',
        (select count(*) from members),
      'registrations_today',
        (select count(*) from members
         where created_at >=
             (v_today::timestamp at time zone 'Africa/Johannesburg')
           and created_at <
             ((v_today + 1)::timestamp at time zone 'Africa/Johannesburg')),
      'registrations_this_week',
        (select count(*) from members
         where created_at >=
             (v_week_start::timestamp at time zone 'Africa/Johannesburg')
           and created_at <
             ((v_today + 1)::timestamp at time zone 'Africa/Johannesburg')),
      'registrations_this_month',
        (select count(*) from members
         where created_at >=
             (v_month_start::timestamp at time zone 'Africa/Johannesburg')
           and created_at <
             ((v_today + 1)::timestamp at time zone 'Africa/Johannesburg')),
      'verified_members',
        case when v_can_view_verification then
          (select count(*)
           from members as member
           where exists (
             select 1
             from public.user_verifications as verification
             where verification.user_id = member.id::text
               and (
                 verification.photo_verification_status = 'verified'
                 or verification.identity_verification_status = 'verified'
               )
           ))
        else null end,
      'active_accounts',
        (select count(*)
         from members
         where banned_until is null or banned_until <= v_now),
      'suspended_accounts',
        (select count(*)
         from members
         where banned_until > v_now),
      'total_matches',
        (select count(*)
         from public.matches as match_record
         where exists (
           select 1 from members as first_member
           where first_member.id = match_record.user_one_id
         )
           and exists (
             select 1 from members as second_member
             where second_member.id = match_record.user_two_id
           )),
      'new_reports_in_range',
        case when v_can_view_moderation then
          (select count(*)
           from public.user_reports as report
           where report.created_at >= v_start
             and report.created_at < v_end
             and exists (
               select 1 from members as reporter
               where reporter.id = report.reporter_id
             ))
        else null end
    ),
    'moderation', jsonb_build_object(
      'pending_reports',
        case when v_can_view_moderation then
          (select count(*)
           from public.user_reports as report
           where report.status in ('pending', 'in_review'))
        else null end,
      'resolved_reports',
        case when v_can_view_moderation then
          (select count(*)
           from public.user_reports as report
           where report.status in ('resolved', 'dismissed'))
        else null end,
      'reported_messages_awaiting_moderation',
        case when v_can_view_moderation then
          (select count(*)
           from public.user_reports as report
           where report.status in ('pending', 'in_review')
             and report.content_type = 'message')
        else null end
    ),
    'support', jsonb_build_object(
      'open_tickets',
        case when v_can_view_support then
          (select count(*)
           from public.support_tickets as ticket
           where ticket.status = 'open')
        else null end,
      'pending_tickets',
        case when v_can_view_support then
          (select count(*)
           from public.support_tickets as ticket
           where ticket.status = 'pending')
        else null end,
      'resolved_tickets',
        case when v_can_view_support then
          (select count(*)
           from public.support_tickets as ticket
           where ticket.status = 'resolved')
        else null end,
      'open_by_priority',
        case when v_can_view_support then
          (select jsonb_build_object(
             'low', count(*) filter (where ticket.priority = 'low'),
             'normal', count(*) filter (where ticket.priority = 'normal'),
             'high', count(*) filter (where ticket.priority = 'high'),
             'urgent', count(*) filter (where ticket.priority = 'urgent')
           )
           from public.support_tickets as ticket
           where ticket.status in ('open', 'pending'))
        else null end,
      'recent_tickets',
        case when v_can_view_support then coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', recent_ticket.id,
              'category', recent_ticket.category,
              'status', recent_ticket.status,
              'priority', recent_ticket.priority,
              'created_at', recent_ticket.created_at,
              'updated_at', recent_ticket.updated_at
            )
            order by recent_ticket.updated_at desc
          )
          from (
            select ticket.id, ticket.category, ticket.status,
              ticket.priority, ticket.created_at, ticket.updated_at
            from public.support_tickets as ticket
            order by ticket.updated_at desc
            limit 5
          ) as recent_ticket
        ), '[]'::jsonb) else null end
    ),
    'verification', jsonb_build_object(
      'changes_in_range',
        case when v_can_view_verification then
          (select count(*)
           from public.user_verification_events as verification_event
           where verification_event.changed_at >= v_start
             and verification_event.changed_at < v_end)
        else null end
    ),
    'member_activity', jsonb_build_object(
      'tracking_started_on',
        (v_tracking_started_at at time zone 'Africa/Johannesburg')::date,
      'coverage_days',
        greatest(
          0,
          v_today -
            (v_tracking_started_at at time zone 'Africa/Johannesburg')::date
            + 1
        ),
      'daily_active_members',
        (select count(distinct activity.user_id)
         from public.member_activity_days as activity
         join members as member on member.id = activity.user_id
         where activity.activity_date = v_today),
      'monthly_active_members',
        case when
          (v_tracking_started_at at time zone 'Africa/Johannesburg')::date
            <= v_today - 29
        then
          (select count(distinct activity.user_id)
           from public.member_activity_days as activity
           join members as member on member.id = activity.user_id
           where activity.activity_date between v_today - 29 and v_today)
        else null end
    ),
    'growth',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'date', growth.day,
            'registrations', growth.registrations
          )
          order by growth.day
        )
        from growth_by_day as growth
      ), '[]'::jsonb),
    'engagement', jsonb_build_object(
      'likes',
        (select count(*)
         from public.likes as like_record
         where like_record.created_at >= v_start
           and like_record.created_at < v_end
           and exists (
             select 1 from members as sender
             where sender.id = like_record.sender_id
           )),
      'matches',
        (select count(*)
         from public.matches as match_record
         where match_record.created_at >= v_start
           and match_record.created_at < v_end
           and exists (
             select 1 from members as first_member
             where first_member.id = match_record.user_one_id
           )
           and exists (
             select 1 from members as second_member
             where second_member.id = match_record.user_two_id
           )),
      'messages',
        (select count(*)
         from public.messages as message
         where message.created_at >= v_start
           and message.created_at < v_end
           and exists (
             select 1 from members as sender
             where sender.id = message.sender_id
           )),
      'video_discovery_sessions',
        (select count(*)
         from public.video_discovery_sessions as video_session
         where video_session.created_at >= v_start
           and video_session.created_at < v_end
           and exists (
             select 1 from members as initiator
             where initiator.id = video_session.initiated_by
           )),
      'tracked_members',
        (select count(distinct interaction.user_id)
         from tracked_interactions as interaction
         join members as member on member.id = interaction.user_id),
      'new_tracked_members',
        (select count(distinct interaction.user_id)
         from tracked_interactions as interaction
         join members as member on member.id = interaction.user_id
         where member.created_at >= v_start
           and member.created_at < v_end),
      'returning_tracked_members',
        (select count(distinct interaction.user_id)
         from tracked_interactions as interaction
         join members as member on member.id = interaction.user_id
         where member.created_at < v_start)
    ),
    'recent_activity',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'kind', recent.kind,
            'label', recent.label,
            'occurred_at', recent.occurred_at
          )
          order by recent.occurred_at desc
        )
        from (
          select event.kind, event.label, event.occurred_at
          from activity_events as event
          order by event.occurred_at desc
          limit 12
        ) as recent
      ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_support_dashboard_metrics(date, date)
  from public, anon, authenticated;
grant execute on function public.get_support_dashboard_metrics(date, date)
  to authenticated;
