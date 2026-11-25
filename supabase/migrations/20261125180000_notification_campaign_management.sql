insert into public.staff_permissions (code, description)
values
  ('notifications.create', 'Create and edit notification campaigns.'),
  ('notifications.schedule', 'Schedule notification campaigns.'),
  ('notifications.cancel', 'Cancel scheduled notification campaigns.'),
  ('notifications.manage_templates', 'Create and manage notification templates.'),
  ('notifications.view_reports', 'View notification delivery reports.'),
  ('notifications.export', 'Export aggregate notification reports.')
on conflict (code) do update
set description = excluded.description;

insert into public.staff_role_permissions (role_code, permission_code)
select distinct current_grant.role_code, new_permission.code
from public.staff_role_permissions as current_grant
join public.staff_permissions as new_permission
  on (
    current_grant.permission_code = 'notifications.send'
    and new_permission.code in (
      'notifications.create',
      'notifications.schedule',
      'notifications.cancel',
      'notifications.manage_templates',
      'notifications.export'
    )
  )
  or (
    current_grant.permission_code = 'notifications.view'
    and new_permission.code in (
      'notifications.view_reports'
    )
  )
on conflict do nothing;
create table if not exists public.notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  campaign_type text not null
    check (campaign_type in ('announcement', 'promotion')),
  audience jsonb not null
    check (jsonb_typeof(audience) = 'object'),
  include_in_app boolean not null default true,
  include_push boolean not null default true,
  platforms text[] not null default array['android', 'ios'],
  idempotency_key uuid unique,
  status text not null default 'draft'
    check (status in (
      'draft', 'scheduled', 'queued', 'dispatching',
      'sent', 'partial', 'failed', 'cancelled'
    )),
  scheduled_for timestamptz,
  audience_size integer not null default 0 check (audience_size >= 0),
  eligible_recipients integer not null default 0
    check (eligible_recipients >= 0),
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  dispatch_started_at timestamptz,
  audience_snapshotted_at timestamptz,
  completed_at timestamptz,
  lease_until timestamptz,
  last_error text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_by_staff_member_id uuid references public.staff_members (id)
    on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint notification_campaign_scheduled_at_check check (
    (status = 'scheduled' and scheduled_for is not null)
    or status <> 'scheduled'
  )
);

create index if not exists notification_campaigns_due_idx
  on public.notification_campaigns (scheduled_for, created_at)
  where status in ('scheduled', 'queued', 'dispatching');
create index if not exists notification_campaigns_created_idx
  on public.notification_campaigns (created_at desc);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  campaign_type text not null
    check (campaign_type in ('announcement', 'promotion')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_templates_active_idx
  on public.notification_templates (name)
  where archived_at is null;

create table if not exists public.notification_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.notification_campaigns (id)
    on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  member_notification_id uuid not null unique default gen_random_uuid(),
  in_app_status text not null default 'pending'
    check (in_app_status in ('pending', 'created', 'failed', 'skipped')),
  in_app_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create index if not exists notification_campaign_recipients_campaign_idx
  on public.notification_campaign_recipients (campaign_id, in_app_status);

create table if not exists public.notification_campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null
    references public.notification_campaign_recipients (id) on delete cascade,
  device_id uuid not null references public.user_notification_devices (id)
    on delete cascade,
  platform text check (platform is null or platform in ('android', 'ios')),
  status text not null default 'pending'
    check (status in (
      'pending', 'sending', 'accepted', 'receipt_ok',
      'receipt_unavailable', 'failed', 'skipped'
    )),
  attempts integer not null default 0 check (attempts between 0 and 5),
  provider_ticket_id text,
  receipt_checked_at timestamptz,
  next_attempt_at timestamptz,
  error_code text,
  error_message text,
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipient_id, device_id)
);

create index if not exists notification_campaign_deliveries_retry_idx
  on public.notification_campaign_deliveries (status, next_attempt_at)
  where status in ('pending', 'sending', 'accepted');
create index if not exists notification_campaign_deliveries_recipient_idx
  on public.notification_campaign_deliveries (recipient_id, status);

alter table public.notification_campaign_recipients
  add column if not exists in_app_allowed boolean not null default false,
  add column if not exists push_allowed boolean not null default false;

alter table public.notification_campaigns enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_campaign_recipients enable row level security;
alter table public.notification_campaign_deliveries enable row level security;

revoke all on public.notification_campaigns,
  public.notification_templates,
  public.notification_campaign_recipients,
  public.notification_campaign_deliveries
  from public, anon, authenticated;
grant all on public.notification_campaigns,
  public.notification_templates,
  public.notification_campaign_recipients,
  public.notification_campaign_deliveries
  to service_role;

create or replace function public.staff_resolve_notification_audience(
  p_audience jsonb
)
returns table (user_id uuid, member_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  filters jsonb;
  account_status text;
  verification_status text;
  activity_segment text;
  registered_after date;
  registered_before date;
  target_user_id uuid;
  country_value text;
  province_value text;
  city_value text;
begin
  if jsonb_typeof(p_audience) is distinct from 'object'
    or jsonb_typeof(p_audience->'filters') is distinct from 'object' then
    raise exception 'Choose a valid notification audience.'
      using errcode = '22023';
  end if;

  filters := p_audience->'filters';
  account_status := coalesce(filters->>'accountStatus', 'all');
  verification_status := coalesce(filters->>'verificationStatus', 'all');
  activity_segment := coalesce(filters->>'activity', 'all');
  country_value := nullif(btrim(filters->>'country'), '');
  province_value := nullif(btrim(filters->>'province'), '');
  city_value := nullif(btrim(filters->>'city'), '');

  if account_status not in ('all', 'active', 'suspended')
    or verification_status not in (
      'all', 'verified', 'pending', 'rejected', 'not_started'
    )
    or activity_segment not in ('all', 'active_30d', 'inactive_30d') then
    raise exception 'Choose valid notification audience filters.'
      using errcode = '22023';
  end if;

  if nullif(filters->>'registeredAfter', '') is not null then
    registered_after := (filters->>'registeredAfter')::date;
  end if;
  if nullif(filters->>'registeredBefore', '') is not null then
    registered_before := (filters->>'registeredBefore')::date;
  end if;
  if registered_after is not null and registered_before is not null
    and registered_after > registered_before then
    raise exception 'The registration start date must not follow the end date.'
      using errcode = '22023';
  end if;
  if nullif(filters->>'userId', '') is not null then
    target_user_id := (filters->>'userId')::uuid;
  end if;

  return query
  select
    auth_user.id,
    coalesce(
      nullif(btrim(profile.profile->'profile'->>'nickname'), ''),
      'VEYRA member'
    )
  from auth.users as auth_user
  join public.dating_profiles as profile
    on profile.user_id = auth_user.id
  left join public.user_verifications as verification
    on verification.user_id = auth_user.id::text
  where not auth_user.is_anonymous
    and auth_user.deleted_at is null
    and not exists (
      select 1
      from public.staff_members as staff
      where staff.user_id = auth_user.id
    )
    and (target_user_id is null or auth_user.id = target_user_id)
    and (
      account_status = 'all'
      or (
        account_status = 'active'
        and (auth_user.banned_until is null or auth_user.banned_until <= now())
      )
      or (
        account_status = 'suspended'
        and auth_user.banned_until > now()
      )
    )
    and (
      verification_status = 'all'
      or (
        verification_status = 'verified'
        and (
          verification.photo_verification_status = 'verified'
          or verification.identity_verification_status = 'verified'
        )
      )
      or (
        verification_status = 'pending'
        and (
          verification.photo_verification_status in ('pending', 'review_required')
          or verification.identity_verification_status in ('pending', 'review_required')
        )
      )
      or (
        verification_status = 'rejected'
        and (
          verification.photo_verification_status = 'rejected'
          or verification.identity_verification_status = 'rejected'
        )
      )
      or (
        verification_status = 'not_started'
        and coalesce(verification.photo_verification_status, 'not_started') = 'not_started'
        and coalesce(verification.identity_verification_status, 'not_started') = 'not_started'
      )
    )
    and (
      registered_after is null
      or auth_user.created_at >= registered_after::timestamptz
    )
    and (
      registered_before is null
      or auth_user.created_at < (registered_before + 1)::timestamptz
    )
    and (country_value is null or lower(profile.country) = lower(country_value))
    and (province_value is null or lower(profile.province) = lower(province_value))
    and (
      city_value is null
      or lower(profile.profile->'profile'->>'city') = lower(city_value)
    )
    and (
      activity_segment = 'all'
      or (
        activity_segment = 'active_30d'
        and exists (
          select 1 from public.member_activity_days as activity
          where activity.user_id = auth_user.id
            and activity.activity_date >= current_date - 29
        )
      )
      or (
        activity_segment = 'inactive_30d'
        and not exists (
          select 1 from public.member_activity_days as activity
          where activity.user_id = auth_user.id
            and activity.activity_date >= current_date - 29
        )
      )
    )
  order by auth_user.id;
end;
$$;

revoke all on function public.staff_resolve_notification_audience(jsonb)
  from public, anon, authenticated;
grant execute on function public.staff_resolve_notification_audience(jsonb)
  to service_role;

create or replace function public.staff_get_notification_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.staff_has_permission('notifications.view') then
    raise exception 'Notification viewing permission is required.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'campaigns_total', count(*),
    'provider_acceptances', (
      select count(*) from public.notification_campaign_deliveries
      where status in ('accepted', 'receipt_ok', 'receipt_unavailable')
    ),
    'receipt_successes', (
      select count(*) from public.notification_campaign_deliveries
      where status = 'receipt_ok'
    ),
    'failed_attempts', (
      select count(*) from public.notification_campaign_deliveries
      where status = 'failed'
    ),
    'pending_attempts', (
      select count(*) from public.notification_campaign_deliveries
      where status in ('pending', 'sending')
    ),
    'scheduled_campaigns', count(*) filter (where campaign.status = 'scheduled'),
    'running_campaigns', count(*) filter (
      where campaign.status in ('queued', 'dispatching')
    ),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
      from (
        select id, name, campaign_type, status, audience_size,
          eligible_recipients, created_at, dispatch_started_at, completed_at
        from public.notification_campaigns
        order by created_at desc
        limit 8
      ) as recent
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', daily.day,
        'accepted', daily.accepted,
        'delivered', daily.delivered,
        'failed', daily.failed
      ) order by daily.day)
      from (
        select generated.day::date as day,
          count(delivery.id) filter (
            where delivery.status in (
              'accepted', 'receipt_ok', 'receipt_unavailable'
            )
          )::integer as accepted,
          count(delivery.id) filter (
            where delivery.status = 'receipt_ok'
          )::integer as delivered,
          count(delivery.id) filter (
            where delivery.status = 'failed'
          )::integer as failed
        from generate_series(current_date - 13, current_date, interval '1 day')
          as generated(day)
        left join public.notification_campaign_deliveries as delivery
          on delivery.created_at >= generated.day
          and delivery.created_at < generated.day + interval '1 day'
        group by generated.day
      ) as daily
    ), '[]'::jsonb)
  )
  into result
  from public.notification_campaigns as campaign;

  return result;
end;
$$;

revoke all on function public.staff_get_notification_dashboard()
  from public, anon;
grant execute on function public.staff_get_notification_dashboard()
  to authenticated;

create or replace function public.staff_claim_notification_campaigns(
  p_limit integer default 5
)
returns setof public.notification_campaigns
language sql
security definer
set search_path = ''
as $$
  with eligible as (
    select campaign.id
    from public.notification_campaigns as campaign
    where (
      campaign.status in ('queued', 'scheduled')
      and (
        campaign.status = 'queued'
        or campaign.scheduled_for <= now()
      )
    ) or (
      campaign.status = 'dispatching'
      and coalesce(campaign.lease_until, '-infinity'::timestamptz) <= now()
      )
    order by coalesce(campaign.scheduled_for, campaign.created_at), campaign.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 10))
  )
  update public.notification_campaigns as campaign
  set status = 'dispatching',
      dispatch_started_at = coalesce(campaign.dispatch_started_at, now()),
      dispatch_attempts = campaign.dispatch_attempts + 1,
      lease_until = now() + interval '15 minutes',
      updated_at = now()
  from eligible
  where campaign.id = eligible.id
  returning campaign.*;
$$;

revoke all on function public.staff_claim_notification_campaigns(integer)
  from public, anon, authenticated;
grant execute on function public.staff_claim_notification_campaigns(integer)
  to service_role;

create or replace function public.staff_snapshot_notification_recipients(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign public.notification_campaigns%rowtype;
  audience_count integer;
  eligible_count integer;
begin
  select * into campaign
  from public.notification_campaigns
  where id = p_campaign_id
  for update;
  if not found then
    raise exception 'Notification campaign was not found.'
      using errcode = 'P0002';
  end if;

  if campaign.audience_snapshotted_at is null then
    with matched as materialized (
      select resolved.user_id
      from public.staff_resolve_notification_audience(campaign.audience) as resolved
    ),
    preferences as (
      select
        matched.user_id,
        coalesce(settings.product_updates, true)
          and (
            campaign.campaign_type <> 'promotion'
            or coalesce(settings.promotions, true)
          ) as marketing_allowed,
        coalesce(settings.in_app_enabled, true) as in_app_enabled,
        coalesce(settings.push_enabled, true)
          and exists (
            select 1
            from public.user_notification_devices as device
            where device.user_id = matched.user_id
              and device.platform = any(campaign.platforms)
          ) as push_enabled
      from matched
      left join public.user_notification_settings as settings
        on settings.user_id = matched.user_id::text
    ),
    eligible as (
      select
        preferences.user_id,
        campaign.include_in_app and preferences.in_app_enabled as in_app_allowed,
        campaign.include_push and preferences.push_enabled as push_allowed
      from preferences
      where preferences.marketing_allowed
        and (
          campaign.include_in_app and preferences.in_app_enabled
          or campaign.include_push and preferences.push_enabled
        )
    )
    insert into public.notification_campaign_recipients (
      campaign_id, user_id, in_app_allowed, push_allowed
    )
    select p_campaign_id, eligible.user_id,
      eligible.in_app_allowed, eligible.push_allowed
    from eligible
    on conflict (campaign_id, user_id) do nothing;

    select count(*)::integer into audience_count
    from public.staff_resolve_notification_audience(campaign.audience);
    select count(*)::integer into eligible_count
    from public.notification_campaign_recipients as recipient
    where recipient.campaign_id = p_campaign_id;

    update public.notification_campaigns
    set audience_size = audience_count,
        eligible_recipients = eligible_count,
        audience_snapshotted_at = now(),
        updated_at = now()
    where id = p_campaign_id;
  else
    audience_count := campaign.audience_size;
    eligible_count := campaign.eligible_recipients;
  end if;

  insert into public.notification_campaign_deliveries (
    recipient_id, device_id, platform
  )
  select recipient.id, device.id, device.platform
  from public.notification_campaign_recipients as recipient
  join public.notification_campaigns as parent
    on parent.id = recipient.campaign_id
  join public.user_notification_devices as device
    on device.user_id = recipient.user_id
    and device.platform = any(parent.platforms)
  where recipient.campaign_id = p_campaign_id
    and recipient.push_allowed
  on conflict (recipient_id, device_id) do nothing;

  return jsonb_build_object(
    'audience_size', audience_count,
    'eligible_recipients', eligible_count
  );
end;
$$;

revoke all on function public.staff_snapshot_notification_recipients(uuid)
  from public, anon, authenticated;
grant execute on function public.staff_snapshot_notification_recipients(uuid)
  to service_role;

create or replace function public.staff_get_notification_campaign_metrics(
  p_campaign_id uuid
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
  if not public.staff_has_permission('notifications.view_reports') then
    raise exception 'Notification report access is required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.notification_campaigns
    where id = p_campaign_id
  ) then
    raise exception 'Notification campaign was not found.'
      using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'in_app_created', (
      select count(*) from public.notification_campaign_recipients
      where campaign_id = p_campaign_id and in_app_status = 'created'
    ),
    'in_app_failed', (
      select count(*) from public.notification_campaign_recipients
      where campaign_id = p_campaign_id and in_app_status = 'failed'
    ),
    'push_pending', count(*) filter (
      where delivery.status in ('pending', 'sending')
    ),
    'push_accepted', count(*) filter (where delivery.status = 'accepted'),
    'push_receipt_ok', count(*) filter (where delivery.status = 'receipt_ok'),
    'push_receipt_unavailable', count(*) filter (
      where delivery.status = 'receipt_unavailable'
    ),
    'push_failed', count(*) filter (where delivery.status = 'failed'),
    'push_skipped', count(*) filter (where delivery.status = 'skipped'),
    'push_attempts', coalesce(sum(delivery.attempts), 0),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', grouped.platform,
        'pending', grouped.pending,
        'accepted', grouped.accepted,
        'receipt_ok', grouped.receipt_ok,
        'receipt_unavailable', grouped.receipt_unavailable,
        'failed', grouped.failed
      ) order by grouped.platform)
      from (
        select delivery_by_platform.platform,
          count(*) filter (where delivery_by_platform.status = 'pending')::integer as pending,
          count(*) filter (where delivery_by_platform.status = 'accepted')::integer as accepted,
          count(*) filter (where delivery_by_platform.status = 'receipt_ok')::integer as receipt_ok,
          count(*) filter (
            where delivery_by_platform.status = 'receipt_unavailable'
          )::integer as receipt_unavailable,
          count(*) filter (where delivery_by_platform.status = 'failed')::integer as failed
        from public.notification_campaign_recipients as recipient
        join public.notification_campaign_deliveries as delivery_by_platform
          on delivery_by_platform.recipient_id = recipient.id
        where recipient.campaign_id = p_campaign_id
        group by delivery_by_platform.platform
      ) as grouped
    ), '[]'::jsonb)
  )
  into result
  from public.notification_campaign_recipients as recipient
  left join public.notification_campaign_deliveries as delivery
    on delivery.recipient_id = recipient.id
  where recipient.campaign_id = p_campaign_id;

  return result;
end;
$$;

revoke all on function public.staff_get_notification_campaign_metrics(uuid)
  from public, anon;
grant execute on function public.staff_get_notification_campaign_metrics(uuid)
  to authenticated;

create or replace function public.staff_schedule_notification_dispatcher()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatcher_url text;
  dispatcher_secret text;
  existing_job_id bigint;
  dispatcher_job_sql text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault must be enabled before scheduling notifications.'
      using errcode = '55000';
  end if;

  execute
    'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into dispatcher_url
    using 'notification_dispatch_url';
  execute
    'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into dispatcher_secret
    using 'notification_worker_secret';
  if nullif(dispatcher_url, '') is null
    or nullif(dispatcher_secret, '') is null then
    raise exception 'Add notification_dispatch_url and notification_worker_secret to Supabase Vault.'
      using errcode = '55000';
  end if;
  dispatcher_job_sql := $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'notification_dispatch_url'
        limit 1
      ),
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notification-worker-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'notification_worker_secret'
          limit 1
        )
      ),
      timeout_milliseconds := 10000
    );
  $job$;

  select jobid into existing_job_id
  from cron.job
  where jobname = 'veyra-notification-campaign-dispatch';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'veyra-notification-campaign-dispatch',
    '* * * * *',
    dispatcher_job_sql
  );
  return true;
end;
$$;

revoke all on function public.staff_schedule_notification_dispatcher()
  from public, anon, authenticated;

insert into public.notification_templates (
  name, campaign_type, title, body, created_by
)
select
  seed.name,
  seed.campaign_type,
  seed.title,
  seed.body,
  null
from (values
  ('VEYRA announcement', 'announcement', 'A VEYRA update', 'There is a new update waiting for you.'),
  ('New feature announcement', 'announcement', 'Something new on VEYRA', 'Discover what is new in VEYRA.'),
  ('Community update', 'announcement', 'A VEYRA community update', 'Open VEYRA to read the latest community update.')
) as seed(name, campaign_type, title, body)
where not exists (
  select 1 from public.notification_templates as existing
  where existing.name = seed.name
)
on conflict do nothing;
