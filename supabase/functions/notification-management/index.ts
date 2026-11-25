import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-notification-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxAttempts = 3;
const receiptDelayMs = 15 * 60 * 1000;
const receiptMaxAgeMs = 24 * 60 * 60 * 1000;
const workerLeaseMs = 5 * 60 * 1000;
const dispatchContinuationDelayMs = 60 * 1000;

type JsonRecord = Record<string, unknown>;
type CampaignType = "announcement" | "promotion";
type Platform = "android" | "ios";
type Audience = {
  filters: {
    userId?: string;
    country?: string;
    province?: string;
    city?: string;
    accountStatus: "all" | "active" | "suspended";
    verificationStatus: "all" | "verified" | "pending" | "rejected" | "not_started";
    activity: "all" | "active_30d" | "inactive_30d";
    registeredAfter?: string;
    registeredBefore?: string;
  };
};
type Campaign = {
  id: string;
  name: string;
  title: string;
  body: string;
  campaign_type: CampaignType;
  audience: Audience;
  include_in_app: boolean;
  include_push: boolean;
  platforms: Platform[];
  status: string;
  created_by: string;
  created_by_staff_member_id: string | null;
};
type CampaignRecipient = {
  id: string;
  user_id: string;
  member_notification_id: string;
  in_app_allowed: boolean;
  push_allowed: boolean;
};
type PushDelivery = {
  id: string;
  recipient_id: string;
  device_id: string;
  platform: Platform | null;
  attempts: number;
  provider_ticket_id: string | null;
  accepted_at?: string | null;
};
type Device = {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: Platform | null;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Notification management is not configured." }, 500);
  }
  if (!isServiceRoleKey(serviceRoleKey)) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not a recognized server-side key.");
    return jsonResponse({ error: "Notification management credentials are misconfigured." }, 500);
  }

  const workerSecret = Deno.env.get("NOTIFICATION_WORKER_SECRET");
  const suppliedWorkerSecret = request.headers.get("x-notification-worker-secret");
  if (workerSecret && suppliedWorkerSecret && constantTimeEqual(workerSecret, suppliedWorkerSecret)) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await runDispatcher(adminClient);
    return jsonResponse(result, result.errors ? 207 : 200);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication is required." }, 401);
  }
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user: staffUser },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !staffUser) {
    return jsonResponse({ error: "Your session is invalid or expired." }, 401);
  }

  const body = await readRequestBody(request);
  if (!body || typeof body.operation !== "string") {
    return jsonResponse({ error: "Choose a valid notification operation." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const operation = body.operation;
  const requiredPermission = permissionForOperation(operation);
  if (!requiredPermission) {
    return jsonResponse({ error: "Choose a valid notification operation." }, 400);
  }
  const permissions = operation === "list-templates"
    ? ["notifications.view", "notifications.create", "notifications.manage_templates"]
    : operation === "list-campaigns"
    ? ["notifications.view", "notifications.schedule"]
    : [requiredPermission];
  const permissionResults = await Promise.all(permissions.map((permission) =>
    authClient.rpc("staff_has_permission", { p_permission: permission })
  ));
  if (permissionResults.some((result) => result.error)) {
    return jsonResponse({ error: "Staff permission could not be verified." }, 500);
  }
  if (!permissionResults.some((result) => result.data === true)) {
    return jsonResponse({ error: "You do not have permission for this notification operation." }, 403);
  }

  try {
    switch (operation) {
      case "dashboard":
        return await getDashboard(authClient);
      case "list-campaigns":
        return await listCampaigns(adminClient, staffUser.id, body, permissionResults);
      case "search-members":
        return await searchMembers(adminClient, body);
      case "get-draft":
        return await getDraft(adminClient, staffUser.id, body);
      case "estimate-audience":
        return await estimateAudience(adminClient, body);
      case "create-campaign":
        return await createCampaign(adminClient, authClient, staffUser.id, body);
      case "update-draft":
        return await updateDraft(adminClient, authClient, staffUser.id, body);
      case "duplicate-campaign":
        return await duplicateCampaign(adminClient, authClient, staffUser.id, body);
      case "cancel-campaign":
        return await cancelCampaign(adminClient, authClient, staffUser.id, body);
      case "campaign-metrics":
        return await campaignMetrics(authClient, body);
      case "export-campaign-metrics":
        return await exportCampaignMetrics(adminClient, authClient, staffUser.id, body);
      case "list-templates":
        return await listTemplates(adminClient);
      case "save-template":
        return await saveTemplate(adminClient, authClient, staffUser.id, body);
      case "archive-template":
        return await archiveTemplate(adminClient, authClient, staffUser.id, body);
      case "member-history":
        return await memberHistory(adminClient, authClient, staffUser.id, body);
      default:
        return jsonResponse({ error: "Choose a valid notification operation." }, 400);
    }
  } catch (error) {
    console.error("Notification management operation failed.", safeError(error));
    return jsonResponse({
      error: error instanceof Error ? error.message : "Notification operation failed.",
    }, 500);
  }
});

function permissionForOperation(operation: string): string | null {
  if (operation === "dashboard" || operation === "list-campaigns" || operation === "list-templates") {
    return "notifications.view";
  }
  if (operation === "estimate-audience" || operation === "campaign-metrics") {
    return operation === "campaign-metrics" ? "notifications.view_reports" : "notifications.create";
  }
  if (operation === "export-campaign-metrics") return "notifications.export";
  if (operation === "create-campaign" || operation === "update-draft" || operation === "duplicate-campaign") {
    return "notifications.create";
  }
  if (operation === "search-members") return "notifications.create";
  if (operation === "get-draft") return "notifications.create";
  if (operation === "cancel-campaign") return "notifications.cancel";
  if (operation === "save-template" || operation === "archive-template") {
    return "notifications.manage_templates";
  }
  if (operation === "member-history") return "notifications.view";
  return null;
}

async function getDashboard(authClient: ReturnType<typeof createClient>): Promise<Response> {
  const { data, error } = await authClient.rpc("staff_get_notification_dashboard");
  if (error) return jsonResponse({ error: "Notification dashboard could not be loaded." }, 500);
  return jsonResponse({ dashboard: data }, 200);
}

async function listCampaigns(
  client: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
  permissions: Array<{ data: unknown; error: unknown }>,
): Promise<Response> {
  const limit = integerInRange(body.limit, 1, 100, 25);
  const offset = integerInRange(body.offset, 0, 1000000, 0);
  let query = client.from("notification_campaigns")
    .select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (isCampaignType(body.campaignType)) query = query.eq("campaign_type", body.campaignType);
  if (body.status === "scheduled") query = query.in("status", ["scheduled", "queued"]);
  else if (isCampaignStatus(body.status)) query = query.eq("status", body.status);
  if (permissions[0]?.data !== true) {
    if (body.status !== "scheduled") {
      return jsonResponse({ error: "Campaign viewing permission is required for this list." }, 403);
    }
    query = query.eq("created_by", staffUserId);
  }
  if (typeof body.from === "string" && body.from) query = query.gte("created_at", body.from);
  if (typeof body.to === "string" && body.to) query = query.lte("created_at", body.to);
  const { data, error, count } = await query;
  if (error) return jsonResponse({ error: "Campaigns could not be loaded." }, 500);
  return jsonResponse({ campaigns: data ?? [], total: count ?? (data?.length ?? 0) }, 200);
}

async function searchMembers(
  client: ReturnType<typeof createClient>,
  body: JsonRecord,
): Promise<Response> {
  const query = boundedText(body.query, 2, 80);
  if (!query) return jsonResponse({ error: "Search must be between 2 and 80 characters." }, 400);
  const { data, error } = await client.from("dating_profiles")
    .select("user_id,profile,province,country")
    .ilike("profile->profile->>nickname", `%${escapeLike(query)}%`)
    .limit(10);
  if (error) return jsonResponse({ error: "Member search failed." }, 500);
  return jsonResponse({
    members: (data ?? []).map((member) => {
      const profile = isRecord(member.profile) && isRecord(member.profile.profile)
        ? member.profile.profile
        : {};
      return {
        userId: member.user_id,
        name: typeof profile.nickname === "string" && profile.nickname.trim()
          ? profile.nickname.trim()
          : "VEYRA member",
        city: typeof profile.city === "string" ? profile.city : "",
        province: member.province ?? "",
        country: member.country ?? "",
      };
    }),
  }, 200);
}

async function getDraft(
  client: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.campaignId !== "string" || !uuidPattern.test(body.campaignId)) {
    return jsonResponse({ error: "Choose a valid campaign." }, 400);
  }
  const { data, error } = await client.from("notification_campaigns")
    .select("id,name,title,body,campaign_type,audience,include_in_app,include_push,platforms,status")
    .eq("id", body.campaignId).eq("status", "draft").eq("created_by", staffUserId)
    .maybeSingle();
  if (error) return jsonResponse({ error: "Draft campaign could not be loaded." }, 500);
  if (!data) return jsonResponse({ error: "Only your own draft campaigns can be edited." }, 404);
  return jsonResponse({ campaign: data }, 200);
}

async function estimateAudience(
  client: ReturnType<typeof createClient>,
  body: JsonRecord,
): Promise<Response> {
  const audience = parseAudience(body.audience);
  const campaignType = parseCampaignType(body.campaignType);
  const channels = parseChannels(body.includeInApp, body.includePush, body.platforms);
  if (!audience || !campaignType || !channels) {
    return jsonResponse({ error: "Choose a valid audience, campaign type, and delivery channel." }, 400);
  }
  const estimate = await getAudienceEstimate(client, audience, campaignType, channels);
  if (estimate.error) return jsonResponse({ error: estimate.error }, 500);
  return jsonResponse({
    matchedAudience: estimate.matchedAudience,
    eligibleRecipients: estimate.eligibleRecipients,
    eligibleDevices: estimate.eligibleDevices,
  }, 200);
}

async function createCampaign(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  const campaign = parseCampaignInput(body);
  if (!campaign) return jsonResponse({ error: "Campaign details are invalid." }, 400);
  const mode = body.mode;
  if (mode !== "draft" && mode !== "now" && mode !== "scheduled") {
    return jsonResponse({ error: "Choose whether to save, send, or schedule this campaign." }, 400);
  }
  if (mode === "now" && !(await hasPermission(authClient, "notifications.send"))) {
    return jsonResponse({ error: "Notification sending permission is required." }, 403);
  }
  if (mode !== "draft" && body.confirmed !== true) {
    return jsonResponse({ error: "Confirm the campaign audience and message before dispatch." }, 400);
  }
  let scheduledFor: string | null = null;
  if (mode === "scheduled") {
    if (!(await hasPermission(authClient, "notifications.schedule"))) {
      return jsonResponse({ error: "Notification scheduling permission is required." }, 403);
    }
    if (typeof body.scheduledFor !== "string") {
      return jsonResponse({ error: "Choose a valid future send time." }, 400);
    }
    const date = new Date(body.scheduledFor);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      return jsonResponse({ error: "Scheduled notification time must be in the future." }, 400);
    }
    scheduledFor = date.toISOString();
  }
  if (mode === "draft") {
    const { count, error: rateLimitError } = await client
      .from("notification_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("created_by", staffUserId)
      .eq("status", "draft")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (rateLimitError) {
      return jsonResponse({ error: "Campaign rate limit could not be checked." }, 500);
    }
    if ((count ?? 0) >= 20) {
      return jsonResponse({ error: "You can create at most 20 drafts per hour." }, 429);
    }
  }
  if (mode !== "draft") {
    const { count, error: rateLimitError } = await client
      .from("notification_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("created_by", staffUserId)
      .neq("status", "draft")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (rateLimitError) {
      return jsonResponse({ error: "Campaign dispatch rate limit could not be checked." }, 500);
    }
    if ((count ?? 0) >= 5) {
      return jsonResponse({ error: "You can schedule or queue at most 5 campaigns per hour." }, 429);
    }
  }
  if (
    typeof body.idempotencyKey !== "string" ||
    !uuidPattern.test(body.idempotencyKey)
  ) {
    return jsonResponse({ error: "A valid idempotency key is required." }, 400);
  }
  const idempotencyKey = body.idempotencyKey;

  const estimate = await getAudienceEstimate(
    client,
    campaign.audience,
    campaign.campaign_type,
    campaign,
  );
  if (estimate.error) return jsonResponse({ error: estimate.error }, 500);
  if (!estimate.matchedAudience) return jsonResponse({ error: "No members matched this audience." }, 400);
  if (mode !== "draft" && !estimate.eligibleRecipients) {
    return jsonResponse({ error: "No members are currently eligible for the selected delivery channels." }, 400);
  }

  const { data: staff, error: staffError } = await client
    .from("staff_members")
    .select("id")
    .eq("user_id", staffUserId)
    .eq("status", "active")
    .maybeSingle();
  if (staffError || !staff?.id) {
    return jsonResponse({ error: "An active staff account is required to create campaigns." }, 403);
  }

  const initialStatus = "draft";
  const { data, error } = await client.from("notification_campaigns").insert({
    ...campaign,
    platforms: campaign.platforms,
    status: initialStatus,
    scheduled_for: null,
    idempotency_key: idempotencyKey,
    audience_size: estimate.matchedAudience,
    eligible_recipients: estimate.eligibleRecipients,
    created_by: staffUserId,
    created_by_staff_member_id: staff.id,
  }).select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await client.from("notification_campaigns")
        .select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return jsonResponse({ campaign: existing }, 200);
    }
    return jsonResponse({ error: "Campaign could not be created." }, 500);
  }
  const audit = await writeAudit(client, staffUserId, staff.id, null, "notification.campaign.created", data.id);
  if (!audit) return jsonResponse({ error: "Campaign was created, but the staff action could not be audited." }, 500);

  let finalCampaign = data;
  if (mode === "now" || mode === "scheduled") {
    const action = mode === "now" ? "notification.bulk_send.queued" : "notification.campaign.scheduled";
    const { error: queueError } = await client.from("notification_campaigns")
      .update({
        status: mode === "now" ? "queued" : "scheduled",
        scheduled_for: scheduledFor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "draft");
    if (queueError) return jsonResponse({ error: "Campaign was saved but could not be queued." }, 500);
    if (!await writeAudit(client, staffUserId, staff.id, null, action, data.id)) {
      return jsonResponse({ error: "Campaign was queued, but the scheduling action could not be audited." }, 500);
    }
    const { data: updatedCampaign, error: reloadError } = await client.from("notification_campaigns")
      .select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at")
      .eq("id", data.id)
      .single();
    if (reloadError) return jsonResponse({ error: "Campaign was queued but its status could not be confirmed." }, 500);
    finalCampaign = updatedCampaign;
  }
  return jsonResponse({
    campaign: finalCampaign,
    estimate: {
      matchedAudience: estimate.matchedAudience,
      eligibleRecipients: estimate.eligibleRecipients,
      eligibleDevices: estimate.eligibleDevices,
    },
  }, 201);
}

async function updateDraft(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.campaignId !== "string" || !uuidPattern.test(body.campaignId)) {
    return jsonResponse({ error: "Choose a valid campaign." }, 400);
  }
  const campaign = parseCampaignInput(body);
  if (!campaign) return jsonResponse({ error: "Campaign details are invalid." }, 400);
  const mode = body.mode ?? "draft";
  if (mode !== "draft" && mode !== "now" && mode !== "scheduled") {
    return jsonResponse({ error: "Choose whether to save, send, or schedule this draft." }, 400);
  }
  if (mode !== "draft" && body.confirmed !== true) {
    return jsonResponse({ error: "Confirm the campaign audience and message before dispatch." }, 400);
  }
  if (mode === "now" && !await hasPermission(authClient, "notifications.send")) {
    return jsonResponse({ error: "Notification sending permission is required." }, 403);
  }
  let scheduledFor: string | null = null;
  if (mode === "scheduled") {
    if (!await hasPermission(authClient, "notifications.schedule")) {
      return jsonResponse({ error: "Notification scheduling permission is required." }, 403);
    }
    if (typeof body.scheduledFor !== "string") {
      return jsonResponse({ error: "Choose a valid future send time." }, 400);
    }
    const date = new Date(body.scheduledFor);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      return jsonResponse({ error: "Scheduled notification time must be in the future." }, 400);
    }
    scheduledFor = date.toISOString();
  }
  if (mode !== "draft") {
    const { count: recentDispatches, error: rateLimitError } = await client
      .from("notification_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("created_by", staffUserId)
      .neq("status", "draft")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (rateLimitError) {
      return jsonResponse({ error: "Campaign dispatch rate limit could not be checked." }, 500);
    }
    if ((recentDispatches ?? 0) >= 5) {
      return jsonResponse({ error: "You can schedule or queue at most 5 campaigns per hour." }, 429);
    }
  }
  const estimate = await getAudienceEstimate(client, campaign.audience, campaign.campaign_type, campaign);
  if (estimate.error) return jsonResponse({ error: estimate.error }, 500);
  if (mode !== "draft" && !estimate.eligibleRecipients) {
    return jsonResponse({ error: "No members are currently eligible for the selected delivery channels." }, 400);
  }
  const { data, error } = await client.from("notification_campaigns").update({
    ...campaign,
    audience_size: estimate.matchedAudience,
    eligible_recipients: estimate.eligibleRecipients,
    updated_at: new Date().toISOString(),
  }).eq("id", body.campaignId).eq("status", "draft")
    .eq("created_by", staffUserId)
    .select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at")
    .maybeSingle();
  if (error) return jsonResponse({ error: "Draft campaign could not be updated." }, 500);
  if (!data) return jsonResponse({ error: "Only your own draft campaigns can be edited." }, 409);
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId || !await writeAudit(client, staffUserId, staffId, null, "notification.campaign.edited", data.id)) {
    return jsonResponse({ error: "Draft changed, but the staff action could not be audited." }, 500);
  }
  if (mode !== "draft") {
    const { error: dispatchError } = await client.from("notification_campaigns")
      .update({
        status: mode === "now" ? "queued" : "scheduled",
        scheduled_for: scheduledFor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "draft");
    if (dispatchError) return jsonResponse({ error: "Draft changed but could not be queued." }, 500);
    const action = mode === "now" ? "notification.bulk_send.queued" : "notification.campaign.scheduled";
    if (!await writeAudit(client, staffUserId, staffId, null, action, data.id)) {
      return jsonResponse({ error: "Draft was queued, but the scheduling action could not be audited." }, 500);
    }
    const { data: queuedCampaign, error: reloadError } = await client.from("notification_campaigns")
      .select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at")
      .eq("id", data.id)
      .single();
    if (reloadError) return jsonResponse({ error: "Draft was queued but its status could not be confirmed." }, 500);
    return jsonResponse({ campaign: queuedCampaign }, 200);
  }
  return jsonResponse({ campaign: data }, 200);
}

async function duplicateCampaign(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.campaignId !== "string" || !uuidPattern.test(body.campaignId)) {
    return jsonResponse({ error: "Choose a valid campaign." }, 400);
  }
  const { data: original, error: loadError } = await client.from("notification_campaigns")
    .select("name,title,body,campaign_type,audience,include_in_app,include_push,platforms,audience_size,eligible_recipients")
    .eq("id", body.campaignId).maybeSingle();
  if (loadError || !original) return jsonResponse({ error: "Campaign could not be found." }, 404);
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId) return jsonResponse({ error: "An active staff account is required." }, 403);
  const { data, error } = await client.from("notification_campaigns").insert({
    ...original,
    name: `${original.name} (copy)`.slice(0, 120),
    created_by: staffUserId,
    created_by_staff_member_id: staffId,
    status: "draft",
    scheduled_for: null,
    idempotency_key: crypto.randomUUID(),
  }).select("id,name,title,campaign_type,status,audience_size,eligible_recipients,scheduled_for,dispatch_started_at,completed_at,created_at").single();
  if (error) return jsonResponse({ error: "Campaign could not be duplicated." }, 500);
  if (!await writeAudit(client, staffUserId, staffId, null, "notification.campaign.duplicated", data.id)) {
    return jsonResponse({ error: "Campaign was copied, but the staff action could not be audited." }, 500);
  }
  return jsonResponse({ campaign: data }, 201);
}

async function cancelCampaign(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.campaignId !== "string" || !uuidPattern.test(body.campaignId)) {
    return jsonResponse({ error: "Choose a valid campaign." }, 400);
  }
  const { data, error } = await client.from("notification_campaigns")
    .update({ status: "cancelled", lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", body.campaignId)
    .in("status", ["scheduled", "queued"])
    .select("id,status")
    .maybeSingle();
  if (error) return jsonResponse({ error: "Campaign could not be cancelled." }, 500);
  if (!data) return jsonResponse({ error: "Only campaigns that have not started dispatch can be cancelled." }, 409);
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId || !await writeAudit(client, staffUserId, staffId, null, "notification.campaign.cancelled", data.id)) {
    return jsonResponse({ error: "Campaign was cancelled, but the staff action could not be audited." }, 500);
  }
  return jsonResponse({ campaign: data }, 200);
}

async function campaignMetrics(
  authClient: ReturnType<typeof createClient>,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.campaignId !== "string" || !uuidPattern.test(body.campaignId)) {
    return jsonResponse({ error: "Choose a valid campaign." }, 400);
  }
  const { data, error } = await authClient.rpc("staff_get_notification_campaign_metrics", {
    p_campaign_id: body.campaignId,
  });
  if (error) return jsonResponse({ error: "Campaign metrics could not be loaded." }, 500);
  return jsonResponse({ metrics: data }, 200);
}

async function exportCampaignMetrics(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.campaignId !== "string" || !uuidPattern.test(body.campaignId)) {
    return jsonResponse({ error: "Choose a valid campaign." }, 400);
  }
  if (!await hasPermission(authClient, "notifications.view_reports")) {
    return jsonResponse({ error: "Campaign report access is required for export." }, 403);
  }
  const { data, error } = await authClient.rpc("staff_get_notification_campaign_metrics", {
    p_campaign_id: body.campaignId,
  });
  if (error) return jsonResponse({ error: "Campaign metrics could not be loaded for export." }, 500);
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId || !await writeAudit(
    client,
    staffUserId,
    staffId,
    null,
    "notification.campaign_metrics.exported",
    body.campaignId,
  )) {
    return jsonResponse({ error: "Campaign report was prepared, but the export could not be audited." }, 500);
  }
  return jsonResponse({ metrics: data }, 200);
}

async function listTemplates(client: ReturnType<typeof createClient>): Promise<Response> {
  const { data, error } = await client.from("notification_templates")
    .select("id,name,campaign_type,title,body,archived_at,created_at,updated_at")
    .is("archived_at", null).order("name").limit(100);
  if (error) return jsonResponse({ error: "Notification templates could not be loaded." }, 500);
  return jsonResponse({ templates: data ?? [] }, 200);
}

async function saveTemplate(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  const name = boundedText(body.name, 1, 120);
  const title = boundedText(body.title, 1, 100);
  const message = boundedText(body.body, 1, 1000);
  const campaignType = parseCampaignType(body.campaignType);
  if (!name || !title || !message || !campaignType) {
    return jsonResponse({ error: "Template name, type, title, or body is invalid." }, 400);
  }
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId) return jsonResponse({ error: "An active staff account is required." }, 403);
  const values = {
    name, title, body: message, campaign_type: campaignType,
    updated_by: staffUserId, updated_at: new Date().toISOString(),
  };
  let query = client.from("notification_templates").upsert(
    typeof body.templateId === "string" && uuidPattern.test(body.templateId)
      ? { ...values, id: body.templateId }
      : { ...values, created_by: staffUserId },
    { onConflict: "id" },
  ).select("id,name,campaign_type,title,body,updated_at").single();
  const { data, error } = await query;
  if (error) return jsonResponse({ error: "Notification template could not be saved." }, 500);
  if (!await writeAudit(client, staffUserId, staffId, null, "notification.template.saved", data.id)) {
    return jsonResponse({ error: "Template was saved, but the staff action could not be audited." }, 500);
  }
  return jsonResponse({ template: data }, 200);
}

async function archiveTemplate(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (typeof body.templateId !== "string" || !uuidPattern.test(body.templateId)) {
    return jsonResponse({ error: "Choose a valid template." }, 400);
  }
  const { data, error } = await client.from("notification_templates")
    .update({ archived_at: new Date().toISOString(), updated_by: staffUserId })
    .eq("id", body.templateId).is("archived_at", null)
    .select("id").maybeSingle();
  if (error) return jsonResponse({ error: "Notification template could not be archived." }, 500);
  if (!data) return jsonResponse({ error: "Template was not found or is already archived." }, 404);
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId || !await writeAudit(client, staffUserId, staffId, null, "notification.template.archived", data.id)) {
    return jsonResponse({ error: "Template was archived, but the staff action could not be audited." }, 500);
  }
  return jsonResponse({ success: true }, 200);
}

async function memberHistory(
  client: ReturnType<typeof createClient>,
  authClient: ReturnType<typeof createClient>,
  staffUserId: string,
  body: JsonRecord,
): Promise<Response> {
  if (!await hasPermission(authClient, "users.view")) {
    return jsonResponse({ error: "Member history access requires member viewing permission." }, 403);
  }
  if (typeof body.userId !== "string" || !uuidPattern.test(body.userId)) {
    return jsonResponse({ error: "Choose a valid member." }, 400);
  }
  const { data, error } = await client.from("member_notifications")
    .select("id,title,body,category,link_url,created_at,read_at")
    .eq("user_id", body.userId).order("created_at", { ascending: false }).limit(50);
  if (error) return jsonResponse({ error: "Member notification history could not be loaded." }, 500);
  const staffId = await getStaffMemberId(client, staffUserId);
  if (!staffId || !await writeAudit(
    client,
    staffUserId,
    staffId,
    body.userId,
    "notification.member_history.viewed",
    body.userId,
  )) {
    return jsonResponse({ error: "Member history was loaded, but the staff action could not be audited." }, 500);
  }
  return jsonResponse({ notifications: data ?? [] }, 200);
}

async function getAudienceEstimate(
  client: ReturnType<typeof createClient>,
  audience: Audience,
  campaignType: CampaignType,
  channels: { include_in_app: boolean; include_push: boolean; platforms: Platform[] },
): Promise<{ matchedAudience: number; eligibleRecipients: number; eligibleDevices: number; error: string | null }> {
  let matchedAudience = 0;
  let eligibleRecipients = 0;
  let eligibleDevices = 0;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.rpc("staff_resolve_notification_audience", {
      p_audience: audience,
    }).range(offset, offset + pageSize - 1);
    if (error) {
      console.error("Audience estimate failed.", { code: error.code });
      return { matchedAudience: 0, eligibleRecipients: 0, eligibleDevices: 0, error: "Audience estimate could not be loaded." };
    }
    const users = (data ?? []).filter((row: unknown): row is { user_id: string } =>
      isRecord(row) && typeof row.user_id === "string");
    matchedAudience += users.length;
    if (!users.length) break;
    const ids = users.map((user) => user.user_id);
    const [{ data: settings, error: settingsError }, { data: devices, error: deviceError }] =
      await Promise.all([
        client.from("user_notification_settings")
          .select("user_id,push_enabled,in_app_enabled,product_updates,promotions")
          .in("user_id", ids),
        channels.include_push
          ? client.from("user_notification_devices")
            .select("user_id,platform").in("user_id", ids)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (settingsError || deviceError) {
      return { matchedAudience, eligibleRecipients, eligibleDevices, error: "Member preferences or device registrations could not be loaded." };
    }
    const preferenceMap = new Map((settings ?? []).map((item) => [item.user_id, item]));
    const devicesByUser = new Map<string, number>();
    for (const device of devices ?? []) {
      if (channels.platforms.includes(device.platform as Platform)) {
        devicesByUser.set(device.user_id, (devicesByUser.get(device.user_id) ?? 0) + 1);
      }
    }
    for (const id of ids) {
      const preference = preferenceMap.get(id);
      const marketingAllowed = (preference?.product_updates ?? true) &&
        (campaignType !== "promotion" || (preference?.promotions ?? true));
      const inAppAllowed = channels.include_in_app && marketingAllowed &&
        (preference?.in_app_enabled ?? true);
      const deviceCount = channels.include_push && marketingAllowed &&
          (preference?.push_enabled ?? true)
        ? devicesByUser.get(id) ?? 0
        : 0;
      if (inAppAllowed || deviceCount > 0) eligibleRecipients += 1;
      eligibleDevices += deviceCount;
    }
    if (users.length < pageSize) break;
  }
  return { matchedAudience, eligibleRecipients, eligibleDevices, error: null };
}

async function runDispatcher(
  client: ReturnType<typeof createClient>,
): Promise<{ claimed: number; completed: number; errors: number }> {
  const { data: campaigns, error } = await client.rpc(
    "staff_claim_notification_campaigns",
    { p_limit: 1 },
  );
  if (error) {
    console.error("Notification campaign claim failed.", { code: error.code });
    return { claimed: 0, completed: 0, errors: 1 };
  }
  let completed = 0;
  let errors = 0;
  for (const campaign of (campaigns ?? []) as Campaign[]) {
    try {
      if (await processCampaign(client, campaign)) completed += 1;
    } catch (workerError) {
      errors += 1;
      console.error("Notification campaign dispatch failed.", {
        campaignId: campaign.id,
        error: safeError(workerError),
      });
      await client.from("notification_campaigns").update({
        lease_until: new Date(Date.now() + 60_000).toISOString(),
        last_error: "A dispatch step failed and will be retried.",
        updated_at: new Date().toISOString(),
      }).eq("id", campaign.id).eq("status", "dispatching");
    }
  }
  return { claimed: campaigns?.length ?? 0, completed, errors };
}

async function processCampaign(
  client: ReturnType<typeof createClient>,
  campaign: Campaign,
): Promise<boolean> {
  const { error: snapshotError } = await client.rpc(
    "staff_snapshot_notification_recipients",
    { p_campaign_id: campaign.id },
  );
  if (snapshotError) throw new Error("Campaign recipients could not be securely prepared.");

  await createInAppNotifications(client, campaign);
  await sendPendingPushes(client, campaign);
  await checkPushReceipts(client, campaign);

  const counts = await getDispatchCounts(client, campaign.id);
  const hasOutstanding = counts.pending > 0 || counts.sending > 0 ||
    counts.accepted > 0 || counts.inAppPending > 0;
  if (hasOutstanding) {
    const hasWorkRemaining = counts.pending > 0 || counts.sending > 0 ||
      counts.inAppPending > 0;
    const nextWake = new Date(Date.now() + (
      hasWorkRemaining
        ? dispatchContinuationDelayMs
        : counts.accepted > 0
        ? receiptDelayMs
        : workerLeaseMs
    ));
    const { error } = await client.from("notification_campaigns").update({
      lease_until: nextWake.toISOString(),
      audience_size: counts.audienceSize,
      eligible_recipients: counts.eligibleRecipients,
      updated_at: new Date().toISOString(),
    }).eq("id", campaign.id).eq("status", "dispatching");
    if (error) throw new Error("Campaign progress could not be recorded.");
    return false;
  }

  const finalStatus = counts.successes === 0
    ? "failed"
    : counts.failures > 0
    ? "partial"
    : "sent";
  const { error: updateError } = await client.from("notification_campaigns").update({
    status: finalStatus,
    completed_at: new Date().toISOString(),
    lease_until: null,
    audience_size: counts.audienceSize,
    eligible_recipients: counts.eligibleRecipients,
    last_error: counts.failures > 0
      ? "Some recipients or devices could not be notified."
      : counts.eligibleRecipients === 0
      ? "No recipients had consent and a supported delivery channel."
      : null,
    updated_at: new Date().toISOString(),
  }).eq("id", campaign.id).eq("status", "dispatching");
  if (updateError) throw new Error("Campaign completion could not be recorded.");

  const staffId = campaign.created_by_staff_member_id;
  const audited = await writeAudit(
    client,
    campaign.created_by,
    staffId,
    null,
    `notification.campaign.${finalStatus}`,
    campaign.id,
  );
  if (!audited) throw new Error("Campaign completion could not be audited.");
  return true;
}

async function createInAppNotifications(
  client: ReturnType<typeof createClient>,
  campaign: Campaign,
): Promise<void> {
  if (!campaign.include_in_app) return;
  const { data: recipients, error } = await client.from("notification_campaign_recipients")
    .select("id,user_id,member_notification_id")
    .eq("campaign_id", campaign.id)
    .eq("in_app_allowed", true)
    .eq("in_app_status", "pending")
    .limit(500);
  if (error) throw new Error("In-app recipients could not be loaded.");
  if (!recipients?.length) return;
    const { data: preferences, error: preferenceError } = await client
      .from("user_notification_settings")
      .select("user_id,in_app_enabled,product_updates,promotions")
      .in("user_id", recipients.map((recipient) => recipient.user_id));
    if (preferenceError) throw new Error("In-app preferences could not be checked.");
    const settings = new Map((preferences ?? []).map((preference) => [preference.user_id, preference]));
    const eligible = recipients.filter((recipient) => {
      const preference = settings.get(recipient.user_id);
      return (preference?.in_app_enabled ?? true) &&
        (preference?.product_updates ?? true) &&
        (campaign.campaign_type !== "promotion" || (preference?.promotions ?? true));
    });
    const skipped = recipients.filter((recipient) => !eligible.includes(recipient));
    if (skipped.length) {
      const { error: skipError } = await client.from("notification_campaign_recipients")
        .update({
          in_app_status: "skipped",
          in_app_error: "Member preference changed before dispatch.",
          updated_at: new Date().toISOString(),
        }).in("id", skipped.map((recipient) => recipient.id));
      if (skipError) throw new Error("In-app preference changes could not be recorded.");
    }
  if (!eligible.length) return;
    const { error: insertError } = await client.from("member_notifications").upsert(
      eligible.map((recipient) => ({
        id: recipient.member_notification_id,
        user_id: recipient.user_id,
        created_by: campaign.created_by,
        title: campaign.title,
        body: campaign.body,
        category: "updates",
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (insertError) {
      const { error: updateError } = await client.from("notification_campaign_recipients").update({
        in_app_status: "failed",
        in_app_error: "In-app record could not be created.",
        updated_at: new Date().toISOString(),
      }).in("id", eligible.map((recipient) => recipient.id));
      if (updateError) throw new Error("In-app failure state could not be recorded.");
      return;
    }
    const { error: updateError } = await client.from("notification_campaign_recipients")
      .update({
        in_app_status: "created",
        in_app_error: null,
        updated_at: new Date().toISOString(),
      }).in("id", eligible.map((recipient) => recipient.id));
    if (updateError) throw new Error("In-app notification progress could not be recorded.");
}

async function sendPendingPushes(
  client: ReturnType<typeof createClient>,
  campaign: Campaign,
): Promise<void> {
  const { data: stalled, error: recoveryError } = await client
    .from("notification_campaign_deliveries")
    .select("id,attempts,notification_campaign_recipients!inner(campaign_id)")
    .eq("status", "sending")
    .eq("notification_campaign_recipients.campaign_id", campaign.id)
    .lt("last_attempt_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(100);
  if (recoveryError) throw new Error("Stalled push attempts could not be loaded.");
  for (const delivery of stalled ?? []) {
    if (delivery.attempts >= maxAttempts) {
      await markFailed(client, delivery.id, "WORKER_RETRY_LIMIT", "Push attempt could not be confirmed.");
      continue;
    }
    const { error } = await client.from("notification_campaign_deliveries")
      .update({
        status: "pending",
        next_attempt_at: new Date().toISOString(),
        error_code: "WORKER_RETRY",
        error_message: "A previous push attempt did not finish.",
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id).eq("status", "sending");
    if (error) throw new Error("A stalled push attempt could not be recovered.");
  }

  const { data: pending, error } = await client.from("notification_campaign_deliveries")
    .select("id,recipient_id,device_id,platform,attempts,provider_ticket_id,notification_campaign_recipients!inner(campaign_id)")
    .eq("status", "pending")
    .eq("notification_campaign_recipients.campaign_id", campaign.id)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order("created_at").limit(100);
  if (error) throw new Error("Pending push deliveries could not be loaded.");
  if (!pending?.length) return;

  const claimed: PushDelivery[] = [];
  for (const delivery of pending) {
    const { data, error: claimError } = await client.from("notification_campaign_deliveries")
      .update({
        status: "sending",
        attempts: delivery.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id).eq("status", "pending")
      .select("id,recipient_id,device_id,platform,attempts,provider_ticket_id")
      .maybeSingle();
    if (claimError) throw new Error("A push attempt could not be claimed.");
    if (data) claimed.push(data);
  }
  if (claimed.length) await deliverExpoBatch(client, campaign, claimed);
}

async function deliverExpoBatch(
  client: ReturnType<typeof createClient>,
  campaign: Campaign,
  deliveries: PushDelivery[],
): Promise<void> {
  const deviceIds = [...new Set(deliveries.map((delivery) => delivery.device_id))];
  const recipientIds = [...new Set(deliveries.map((delivery) => delivery.recipient_id))];
  const [{ data: devices, error: deviceError }, { data: recipients, error: recipientError }] =
    await Promise.all([
      client.from("user_notification_devices")
        .select("id,user_id,expo_push_token,platform").in("id", deviceIds),
      client.from("notification_campaign_recipients")
        .select("id,user_id,member_notification_id").in("id", recipientIds),
    ]);
  if (deviceError || recipientError) throw new Error("Push device details could not be loaded.");
  const deviceMap = new Map((devices ?? []).map((device) => [device.id, device as Device]));
  const recipientMap = new Map((recipients ?? []).map((recipient) => [recipient.id, recipient]));
  const userIds = [...new Set((devices ?? []).map((device) => device.user_id))];
  const { data: settings, error: settingsError } = await client.from("user_notification_settings")
    .select("user_id,show_notification_preview,product_updates,promotions,push_enabled")
    .in("user_id", userIds);
  if (settingsError) throw new Error("Push preferences could not be checked.");
  const settingsMap = new Map((settings ?? []).map((setting) => [setting.user_id, setting]));
  const sendable = deliveries.flatMap((delivery) => {
    const device = deviceMap.get(delivery.device_id);
    const recipient = recipientMap.get(delivery.recipient_id);
    if (!device || !recipient) return [];
    const preference = settingsMap.get(device.user_id);
    const consent = (preference?.product_updates ?? true) &&
      (campaign.campaign_type !== "promotion" || (preference?.promotions ?? true));
    if (!consent || !(preference?.push_enabled ?? true)) {
      return [{ delivery, device, recipient, skip: true }];
    }
    return [{ delivery, device, recipient, skip: false }];
  });

  const nowIso = new Date().toISOString();
  const skipped = sendable.filter((item) => item.skip);
  if (skipped.length) {
    const { error: skippedError } = await client.from("notification_campaign_deliveries").update({
      status: "skipped",
      error_code: "PREFERENCE_DISABLED",
      error_message: "Member preference changed before dispatch.",
      updated_at: nowIso,
    }).in("id", skipped.map((item) => item.delivery.id));
    if (skippedError) throw new Error("Preference changes could not be recorded for push deliveries.");
  }
  const outgoing = sendable.filter((item) => !item.skip);
  if (!outgoing.length) return;

  let response: Response;
  try {
    response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(outgoing.map(({ device, recipient }) => {
        const notificationTitle = settingsMap.get(device.user_id)?.show_notification_preview === false
          ? "VEYRA"
          : campaign.title;
        const notificationBody = settingsMap.get(device.user_id)?.show_notification_preview === false
          ? "You have a new update."
          : campaign.body;
        const dataPayload = {
          id: recipient.member_notification_id,
          type: "staff_announcement",
          category: "updates",
          title: notificationTitle,
          body: notificationBody,
        };
        if (device.platform === "android") {
          return {
            to: device.expo_push_token,
            contentAvailable: true,
            priority: "high",
            data: { payload: JSON.stringify(dataPayload) },
          };
        }
        return {
          to: device.expo_push_token,
          title: notificationTitle,
          body: notificationBody,
          sound: "default",
          priority: "high",
          channelId: "veyra_updates",
          data: { notificationId: recipient.member_notification_id },
        };
      })),
    });
  } catch {
    await scheduleRetry(client, outgoing.map((item) => item.delivery), "NETWORK_AMBIGUOUS", "Expo request failed; delivery may be retried.");
    return;
  }
  if (!response.ok) {
    await scheduleRetry(client, outgoing.map((item) => item.delivery), "EXPO_HTTP_ERROR", "Expo Push Service rejected the request.");
    return;
  }
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    await scheduleRetry(client, outgoing.map((item) => item.delivery), "EXPO_INVALID_RESPONSE", "Expo Push Service returned an invalid response.");
    return;
  }
  const tickets = isRecord(responseBody) ? responseBody.data : null;
  if (!Array.isArray(tickets) || tickets.length !== outgoing.length) {
    await scheduleRetry(client, outgoing.map((item) => item.delivery), "EXPO_INCOMPLETE_RESPONSE", "Expo Push Service returned incomplete results.");
    return;
  }

  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    const delivery = outgoing[index].delivery;
    if (isRecord(ticket) && ticket.status === "ok" && typeof ticket.id === "string") {
      const { error } = await client.from("notification_campaign_deliveries").update({
        status: "accepted",
        provider_ticket_id: ticket.id,
        accepted_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
        next_attempt_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      if (error) throw new Error("Expo ticket could not be recorded.");
    } else {
      const errorCode = isRecord(ticket) && isRecord(ticket.details) &&
          typeof ticket.details.error === "string"
        ? ticket.details.error
        : "EXPO_TICKET_ERROR";
      if (errorCode === "DeviceNotRegistered") {
          const { error: deleteError } = await client.from("user_notification_devices").delete().eq("id", delivery.device_id);
          if (deleteError) throw new Error("Invalid push token could not be removed.");
          await markFailed(client, delivery.id, errorCode, "Device token is no longer registered.");
      } else if (isTransientExpoError(errorCode)) {
        await scheduleRetry(client, [delivery], errorCode, "Expo push ticket returned a transient error.");
      } else {
        await markFailed(client, delivery.id, errorCode, "Expo push ticket was rejected.");
      }
    }
  }
}

async function checkPushReceipts(
  client: ReturnType<typeof createClient>,
  campaign: Campaign,
): Promise<void> {
  const cutoff = new Date(Date.now() - receiptDelayMs).toISOString();
  const expiry = new Date(Date.now() - receiptMaxAgeMs).toISOString();
  const { data: deliveries, error } = await client.from("notification_campaign_deliveries")
    .select("id,recipient_id,device_id,platform,attempts,provider_ticket_id,accepted_at,notification_campaign_recipients!inner(campaign_id)")
    .eq("status", "accepted").lt("accepted_at", cutoff)
    .eq("notification_campaign_recipients.campaign_id", campaign.id)
    .or(`receipt_checked_at.is.null,receipt_checked_at.lt.${cutoff}`)
    .not("provider_ticket_id", "is", null).limit(100);
  if (error) throw new Error("Expo receipts could not be loaded.");
  if (!deliveries?.length) return;
  const ticketIds = deliveries
    .map((delivery) => delivery.provider_ticket_id)
    .filter((id): id is string => typeof id === "string");
  let response: Response;
  try {
    response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ticketIds }),
    });
  } catch (error) {
    console.error("Expo receipt request failed.", safeError(error));
    throw new Error("Expo receipts could not be checked.");
  }
  if (!response.ok) throw new Error("Expo receipts could not be checked.");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Expo returned an unreadable receipt response.");
  }
  const receiptMap = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!receiptMap) throw new Error("Expo receipt response did not contain receipt data.");

  for (const delivery of deliveries as PushDelivery[]) {
    if (!delivery.provider_ticket_id) continue;
    if (!(delivery.provider_ticket_id in receiptMap)) {
      await recordReceiptPending(client, delivery.id, delivery.accepted_at, expiry);
      continue;
    }
    const receipt = receiptMap[delivery.provider_ticket_id];
    if (isRecord(receipt) && receipt.status === "pending") {
      await recordReceiptPending(client, delivery.id, delivery.accepted_at, expiry);
      continue;
    }
    if (isRecord(receipt) && receipt.status === "ok") {
      const { error: receiptError } = await client.from("notification_campaign_deliveries").update({
        status: "receipt_ok",
        receipt_checked_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      if (receiptError) throw new Error("Expo receipt could not be recorded.");
      continue;
    }
    const errorCode = isRecord(receipt) && isRecord(receipt.details) &&
        typeof receipt.details.error === "string"
      ? receipt.details.error
      : "EXPO_RECEIPT_ERROR";
    if (errorCode === "DeviceNotRegistered") {
      const { error: deleteError } = await client.from("user_notification_devices").delete().eq("id", delivery.device_id);
      if (deleteError) throw new Error("Invalid push token could not be removed.");
      await markFailed(client, delivery.id, errorCode, "Device token is no longer registered.");
    } else if (isTransientExpoError(errorCode)) {
      await scheduleRetry(client, [delivery], errorCode, "Expo receipt returned a transient error.");
    } else {
      await markFailed(client, delivery.id, errorCode, "Expo receipt reported a failure.");
    }
  }
}

async function recordReceiptPending(
  client: ReturnType<typeof createClient>,
  deliveryId: string,
  acceptedAt: string | null,
  expiry: string,
): Promise<void> {
  const expired = acceptedAt !== null && acceptedAt <= expiry;
  const { error } = await client.from("notification_campaign_deliveries")
    .update({
      ...(expired
        ? {
          status: "receipt_unavailable",
          error_code: "EXPO_RECEIPT_UNAVAILABLE",
          error_message: "Expo did not provide a receipt within 24 hours; device delivery is unknown.",
        }
        : { receipt_checked_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);
  if (error) throw new Error("Expo receipt status could not be recorded.");
}

async function scheduleRetry(
  client: ReturnType<typeof createClient>,
  deliveries: Pick<PushDelivery, "id" | "attempts">[],
  errorCode: string,
  message: string,
): Promise<void> {
  for (const delivery of deliveries) {
    const terminal = delivery.attempts >= maxAttempts;
    const retryMinutes = Math.min(60, 5 * delivery.attempts);
    const { error } = await client.from("notification_campaign_deliveries").update({
      status: terminal ? "failed" : "pending",
      error_code: errorCode.slice(0, 100),
      error_message: message,
      next_attempt_at: terminal
        ? null
        : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", delivery.id);
    if (error) throw new Error("Push retry state could not be recorded.");
  }
}

async function markFailed(
  client: ReturnType<typeof createClient>,
  deliveryId: string,
  errorCode: string,
  message: string,
): Promise<void> {
  const { error } = await client.from("notification_campaign_deliveries").update({
    status: "failed",
    error_code: errorCode.slice(0, 100),
    error_message: message,
    next_attempt_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", deliveryId);
  if (error) throw new Error("Push failure state could not be recorded.");
}

async function getDispatchCounts(
  client: ReturnType<typeof createClient>,
  campaignId: string,
): Promise<{
  pending: number;
  sending: number;
  accepted: number;
  inAppPending: number;
  failures: number;
  successes: number;
  audienceSize: number;
  eligibleRecipients: number;
}> {
  const { data: campaign, error: campaignError } = await client.from("notification_campaigns")
    .select("audience_size,eligible_recipients").eq("id", campaignId).single();
  if (campaignError) throw new Error("Campaign summary could not be loaded.");
  const statuses = [
    "pending",
    "sending",
    "accepted",
    "receipt_ok",
    "receipt_unavailable",
    "failed",
    "skipped",
  ] as const;
  const counts = await Promise.all(statuses.map(async (status) => {
    const { count, error } = await client.from("notification_campaign_deliveries")
      .select("id,notification_campaign_recipients!inner(campaign_id)", {
        count: "exact",
        head: true,
      })
      .eq("status", status)
      .eq("notification_campaign_recipients.campaign_id", campaignId);
    if (error) throw new Error("Campaign push totals could not be loaded.");
    return count ?? 0;
  }));
  const { count: inAppCreated, error: inAppError } = await client
    .from("notification_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("in_app_status", "created");
  if (inAppError) throw new Error("In-app totals could not be loaded.");
  const { count: inAppFailed, error: inAppFailedError } = await client
    .from("notification_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("in_app_status", "failed");
  if (inAppFailedError) throw new Error("In-app failure totals could not be loaded.");
  const { count: inAppPending, error: inAppPendingError } = await client
    .from("notification_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("in_app_allowed", true)
    .eq("in_app_status", "pending");
  if (inAppPendingError) throw new Error("Pending in-app totals could not be loaded.");
  return {
    pending: counts[0],
    sending: counts[1],
    accepted: counts[2],
    inAppPending: inAppPending ?? 0,
    successes: counts[3] + counts[2] + counts[4] + (inAppCreated ?? 0),
    failures: counts[5] + (inAppFailed ?? 0),
    audienceSize: campaign.audience_size,
    eligibleRecipients: campaign.eligible_recipients,
  };
}

async function hasPermission(
  client: ReturnType<typeof createClient>,
  permission: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("staff_has_permission", {
    p_permission: permission,
  });
  return !error && data === true;
}

async function getStaffMemberId(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client.from("staff_members").select("id")
    .eq("user_id", userId).eq("status", "active").maybeSingle();
  return error || typeof data?.id !== "string" ? null : data.id;
}

async function writeAudit(
  client: ReturnType<typeof createClient>,
  userId: string,
  staffMemberId: string | null,
  targetUserId: string | null,
  action: string,
  recordId: string,
): Promise<boolean> {
  const { error } = await client.from("staff_audit_logs").insert({
    actor_user_id: userId,
    actor_staff_member_id: staffMemberId,
    target_user_id: targetUserId,
    action,
    details: { record_id: recordId },
  });
  return !error;
}

function parseCampaignInput(body: JsonRecord): Omit<Campaign, "id" | "status" | "created_by" | "created_by_staff_member_id"> | null {
  const name = boundedText(body.name, 1, 120);
  const title = boundedText(body.title, 1, 100);
  const message = boundedText(body.body, 1, 1000);
  const campaignType = parseCampaignType(body.campaignType);
  const audience = parseAudience(body.audience);
  const channels = parseChannels(body.includeInApp, body.includePush, body.platforms);
  if (!name || !title || !message || !campaignType || !audience || !channels) return null;
  return {
    name,
    title,
    body: message,
    campaign_type: campaignType,
    audience,
    include_in_app: channels.include_in_app,
    include_push: channels.include_push,
    platforms: channels.platforms,
  };
}

function parseAudience(value: unknown): Audience | null {
  if (!isRecord(value) || !isRecord(value.filters)) return null;
  const filters = value.filters;
  const accountStatus = filters.accountStatus ?? "all";
  const verificationStatus = filters.verificationStatus ?? "all";
  const activity = filters.activity ?? "all";
  if (
    !["all", "active", "suspended"].includes(String(accountStatus)) ||
    !["all", "verified", "pending", "rejected", "not_started"].includes(String(verificationStatus)) ||
    !["all", "active_30d", "inactive_30d"].includes(String(activity))
  ) return null;
  const parsed: Audience["filters"] = {
    accountStatus: accountStatus as Audience["filters"]["accountStatus"],
    verificationStatus: verificationStatus as Audience["filters"]["verificationStatus"],
    activity: activity as Audience["filters"]["activity"],
  };
  for (const key of ["country", "province", "city"] as const) {
    const text = optionalBoundedText(filters[key], 1, 100);
    if (text === false) return null;
    if (text) parsed[key] = text;
  }
  const userId = optionalBoundedText(filters.userId, 1, 36);
  if (userId === false || (userId && !uuidPattern.test(userId))) return null;
  if (userId) parsed.userId = userId;
  for (const key of ["registeredAfter", "registeredBefore"] as const) {
    const date = optionalBoundedText(filters[key], 10, 10);
    if (date === false) return null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (date) parsed[key] = date;
  }
  if (
    parsed.registeredAfter && parsed.registeredBefore &&
    parsed.registeredAfter > parsed.registeredBefore
  ) return null;
  return { filters: parsed };
}

function parseChannels(
  includeInApp: unknown,
  includePush: unknown,
  platforms: unknown,
): { include_in_app: boolean; include_push: boolean; platforms: Platform[] } | null {
  if (typeof includeInApp !== "boolean" || typeof includePush !== "boolean") return null;
  if (!includeInApp && !includePush) return null;
  if (!Array.isArray(platforms) || platforms.some((item) => item !== "android" && item !== "ios")) return null;
  if (includePush && platforms.length === 0) return null;
  return {
    include_in_app: includeInApp,
    include_push: includePush,
    platforms: [...new Set(platforms as Platform[])],
  };
}

function parseCampaignType(value: unknown): CampaignType | null {
  return value === "announcement" || value === "promotion" ? value : null;
}

function isCampaignType(value: unknown): value is CampaignType {
  return value === "announcement" || value === "promotion";
}

function isCampaignStatus(value: unknown): value is string {
  return typeof value === "string" && [
    "draft", "scheduled", "queued", "dispatching", "sent", "partial", "failed", "cancelled",
  ].includes(value);
}

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function optionalBoundedText(value: unknown, min: number, max: number): string | false | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = boundedText(value, min, max);
  return text ?? false;
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function isTransientExpoError(code: string): boolean {
  return code === "ExpoServerError" ||
    code === "MessageRateExceeded" ||
    code === "SERVICE_UNAVAILABLE" ||
    code.startsWith("EXPO_") ||
    code === "NETWORK_AMBIGUOUS";
}

async function readRequestBody(request: Request): Promise<JsonRecord | null> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isServiceRoleKey(token: string): boolean {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(token)) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return isRecord(payload) && payload.role === "service_role";
  } catch {
    return false;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown error.";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
