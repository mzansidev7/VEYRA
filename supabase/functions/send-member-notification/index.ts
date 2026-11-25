import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Audience =
  | { type: "all" }
  | { type: "location"; field: "country" | "province" | "city"; value: string }
  | { type: "user"; userId: string };

type Recipient = {
  user_id: string;
  profile: Record<string, unknown>;
};

type Device = {
  user_id: string;
  expo_push_token: string;
  platform: "android" | "ios" | null;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication is required." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Notification delivery is not configured." }, 500);
  }
  if (!isServiceRoleKey(serviceRoleKey)) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not a recognized server-side key.");
    return jsonResponse(
      { error: "Notification service credentials are misconfigured. Configure this project's service_role JWT or secret API key as the Edge Function SUPABASE_SERVICE_ROLE_KEY." },
      500,
    );
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
  const { data: permitted, error: permissionError } =
    await authClient.rpc("staff_has_permission", {
      p_permission: "notifications.send",
    });
  if (permissionError) {
    return jsonResponse({ error: "Staff permission could not be verified." }, 500);
  }
  if (permitted !== true) {
    return jsonResponse({ error: "Notification sending permission is required." }, 403);
  }

  const body = await readRequestBody(request);
  if (!body) return jsonResponse({ error: "The request body must be valid JSON." }, 400);

  if (body.operation === "search-members") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 80) {
      return jsonResponse({ error: "Search must be between 2 and 80 characters." }, 400);
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await adminClient
      .from("dating_profiles")
      .select("user_id, profile, province, country")
      .ilike("profile->profile->>nickname", `%${escapeLike(query)}%`)
      .limit(10);
    if (error) return jsonResponse({ error: "Member search failed." }, 500);
    return jsonResponse({
      members: (data ?? []).map((member) => ({
        userId: member.user_id,
        name: stringOrEmpty(asRecord(member.profile?.profile).nickname) || "VEYRA member",
        city: stringOrEmpty(asRecord(member.profile?.profile).city),
        province: member.province,
        country: member.country,
      })),
    }, 200);
  }

  if (body.operation !== "send") {
    return jsonResponse({ error: "Choose a valid notification operation." }, 400);
  }
  return jsonResponse({
    error: "Direct notification delivery has been retired. Create and dispatch a campaign through notification-management.",
  }, 410);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const linkUrl = parseHttpsUrl(body.linkUrl);
  const audience = parseAudience(body.audience);
  if (!audience) return jsonResponse({ error: "Choose a valid notification audience." }, 400);
  if (body.linkUrl !== null && body.linkUrl !== undefined && linkUrl === null) {
    return jsonResponse({ error: "The optional link must be a valid HTTPS URL under 2048 characters." }, 400);
  }
  if (title.length < 1 || title.length > 100 || message.length < 1 || message.length > 1000) {
    return jsonResponse({ error: "Title must be 1–100 characters and message 1–1000 characters." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const recipients = await resolveRecipients(adminClient, audience);
  if (recipients.error) return jsonResponse({ error: recipients.error }, 400);
  if (recipients.rows.length === 0) {
    return jsonResponse({ error: "No members matched this audience." }, 404);
  }

  const userIds = recipients.rows.map((row) => row.user_id);
  const settingsByUser = await loadSettings(adminClient, userIds);
  if (!settingsByUser) return jsonResponse({ error: "Notification preferences could not be loaded." }, 500);

  const eligibleRecipients = recipients.rows.filter(
    (recipient) =>
      settingsByUser.get(recipient.user_id)?.product_updates ?? true,
  );
  const notificationIdsByUser = new Map(
    eligibleRecipients.map((recipient) => [
      recipient.user_id,
      crypto.randomUUID(),
    ]),
  );
  const inAppRecipients = eligibleRecipients.filter(
    (recipient) => settingsByUser.get(recipient.user_id)?.in_app_enabled ?? true,
  );
  let inAppDelivered = 0;
  let inAppError: string | null = null;
  for (let offset = 0; offset < inAppRecipients.length; offset += 500) {
    const batch = inAppRecipients.slice(offset, offset + 500);
    const { error } = await adminClient
      .from("member_notifications")
      .insert(
        batch.map((recipient) => ({
          id: notificationIdsByUser.get(recipient.user_id),
          user_id: recipient.user_id,
          created_by: staffUser.id,
          title,
          body: message,
          link_url: linkUrl,
        })),
      )
    if (error) {
      inAppError ??= "In-app notifications could not be saved.";
    } else {
      inAppDelivered += batch.length;
    }
  }

  const registeredDevices: Device[] = [];
  const eligibleUserIds = eligibleRecipients.map((row) => row.user_id);
  let pushResult: { sent: number; failed: number; error: string | null } = {
    sent: 0,
    failed: 0,
    error: null,
  };
  for (let offset = 0; offset < eligibleUserIds.length; offset += 500) {
    const { data, error } = await adminClient
      .from("user_notification_devices")
      .select("user_id, expo_push_token, platform")
      .in("user_id", eligibleUserIds.slice(offset, offset + 500));
    if (error) {
      pushResult.error = "Push notification devices could not be loaded.";
      break;
    }
    registeredDevices.push(...(data ?? []));
  }
  if (!pushResult.error) {
    const pushDevices = registeredDevices.filter(
      (device) => settingsByUser.get(device.user_id)?.push_enabled ?? true,
    );
    pushResult = await sendPushMessages(
      pushDevices,
      title,
      message,
      linkUrl,
      settingsByUser,
      notificationIdsByUser,
      adminClient,
    );
  }

  const { data: staffMember, error: staffLookupError } = await adminClient
    .from("staff_members")
    .select("id")
    .eq("user_id", staffUser.id)
    .maybeSingle();
  if (staffLookupError) {
    return jsonResponse({ error: "Notifications were attempted, but the staff action could not be audited." }, 500);
  }
  const { error: auditError } = await adminClient.from("staff_audit_logs").insert({
    actor_staff_member_id: staffMember?.id ?? null,
    actor_user_id: staffUser.id,
    target_user_id: audience.type === "user" ? audience.userId : null,
    action: "notification.delivery_attempted",
    details: {
      audience: audience.type,
      location: audience.type === "location" ? { field: audience.field, value: audience.value } : null,
      matched_audience_count: recipients.rows.length,
      eligible_recipient_count: eligibleRecipients.length,
      in_app_count: inAppDelivered,
      in_app_failure_count: inAppRecipients.length - inAppDelivered,
      push_count: pushResult.sent,
      push_failure_count: pushResult.failed,
      failure: inAppError || pushResult.error,
    },
  });
  if (auditError) {
    return jsonResponse({ error: "Notifications were attempted, but the staff action could not be audited." }, 500);
  }

  const deliveryResult = {
    matchedAudience: recipients.rows.length,
    eligibleRecipients: eligibleRecipients.length,
    inAppDelivered,
    inAppFailed: inAppRecipients.length - inAppDelivered,
    pushDelivered: pushResult.sent,
    pushFailed: pushResult.failed,
  };
  if (inAppError || pushResult.error) {
    return jsonResponse({
      ...deliveryResult,
      error: [
        inAppError ? "Some in-app notifications could not be saved." : "",
        pushResult.error,
      ].filter(Boolean).join(" "),
    }, 502);
  }
  return jsonResponse(deliveryResult, 200);
});

async function resolveRecipients(
  client: ReturnType<typeof createClient>,
  audience: Audience,
): Promise<{ rows: Recipient[]; error: string | null }> {
  const rows: Recipient[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from("dating_profiles").select("user_id, profile");
    if (audience.type === "user") query = query.eq("user_id", audience.userId);
    if (audience.type === "location") {
      if (audience.field === "country" || audience.field === "province") {
        query = query.ilike(audience.field, escapeLike(audience.value));
      } else {
        query = query.filter(
          "profile->profile->>city",
          "ilike",
          escapeLike(audience.value),
        );
      }
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      console.error("Notification audience query failed.", {
        code: error.code,
        message: error.message,
      });
      return {
        rows: [],
        error: `Could not load member profiles (${error.code || "database error"}): ${error.message}`,
      };
    }
    rows.push(...((data ?? []) as Recipient[]));
    if (audience.type === "user" || !data || data.length < pageSize) break;
  }
  return { rows, error: null };
}

async function loadSettings(
  client: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, {
  push_enabled: boolean;
  in_app_enabled: boolean;
  product_updates: boolean;
  show_notification_preview: boolean;
}> | null> {
  const result = new Map<string, {
    push_enabled: boolean;
    in_app_enabled: boolean;
    product_updates: boolean;
    show_notification_preview: boolean;
  }>();
  for (let offset = 0; offset < userIds.length; offset += 500) {
    const batch = userIds.slice(offset, offset + 500);
    const { data, error } = await client
      .from("user_notification_settings")
      .select("user_id, push_enabled, in_app_enabled, product_updates, show_notification_preview")
      .in("user_id", batch);
    if (error) return null;
    for (const settings of data ?? []) {
      result.set(settings.user_id, {
        push_enabled: settings.push_enabled,
        in_app_enabled: settings.in_app_enabled,
        product_updates: settings.product_updates,
        show_notification_preview: settings.show_notification_preview,
      });
    }
  }
  return result;
}

async function sendPushMessages(
  devices: Device[],
  title: string,
  body: string,
  linkUrl: string | null,
  settingsByUser: Map<string, {
    show_notification_preview: boolean;
  }>,
  notificationIdsByUser: Map<string, string>,
  client: ReturnType<typeof createClient>,
): Promise<{ sent: number; failed: number; error: string | null }> {
  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < devices.length; offset += 100) {
    const batch = devices.slice(offset, offset + 100);
    let response: Response;
    try {
      response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch.map((device) => {
          const payload = {
            id: notificationIdsByUser.get(device.user_id) ?? crypto.randomUUID(),
            type: "staff_announcement",
            category: "updates",
            title: settingsByUser.get(device.user_id)?.show_notification_preview === false
              ? "VEYRA"
              : title,
            body: settingsByUser.get(device.user_id)?.show_notification_preview === false
              ? "You have a new update."
              : body,
            ...(linkUrl ? { linkUrl } : {}),
          };
          if (device.platform === "android") {
            return {
              to: device.expo_push_token,
              contentAvailable: true,
              priority: "high",
              data: { payload: JSON.stringify(payload) },
            };
          }
          return {
            to: device.expo_push_token,
            title: payload.title,
            body: payload.body,
            sound: "default",
            priority: "high",
            channelId: "veyra_updates",
            data: {
              notificationId: payload.id,
              ...(linkUrl ? { linkUrl } : {}),
            },
          };
        })),
      });
    } catch {
      return { sent, failed, error: "Expo Push Service could not be reached." };
    }
    if (!response.ok) {
      return { sent, failed, error: "Expo Push Service rejected the delivery request." };
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      return { sent, failed, error: "Expo Push Service returned an invalid response." };
    }
    const tickets = asRecord(result).data;
    if (!Array.isArray(tickets) || tickets.length !== batch.length) {
      return { sent, failed, error: "Expo Push Service returned incomplete delivery results." };
    }
    const staleTokens: string[] = [];
    tickets.forEach((ticket, index) => {
      const ticketRecord = asRecord(ticket);
      if (ticketRecord.status === "ok") {
        sent += 1;
      } else {
        failed += 1;
        if (asRecord(ticketRecord.details).error === "DeviceNotRegistered") {
          staleTokens.push(batch[index].expo_push_token);
        }
      }
    });
    if (staleTokens.length) {
      const { error } = await client
        .from("user_notification_devices")
        .delete()
        .in("expo_push_token", staleTokens);
      if (error) return { sent, failed, error: "Stale push registrations could not be removed." };
    }
  }
  return { sent, failed, error: null };
}

function parseAudience(value: unknown): Audience | null {
  const candidate = asRecord(value);
  if (candidate.type === "all") return { type: "all" };
  if (
    candidate.type === "user" &&
    typeof candidate.userId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.userId)
  ) {
    return { type: "user", userId: candidate.userId };
  }
  if (
    candidate.type === "location" &&
    (candidate.field === "country" || candidate.field === "province" || candidate.field === "city") &&
    typeof candidate.value === "string" &&
    candidate.value.trim().length > 0 &&
    candidate.value.trim().length <= 100
  ) {
    return {
      type: "location",
      field: candidate.field,
      value: candidate.value.trim(),
    };
  }
  return null;
}

async function readRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isServiceRoleKey(token: string): boolean {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(token)) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return isRecord(payload) && payload.role === "service_role";
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
