import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

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
    return jsonResponse({ error: "Member management is not configured." }, 500);
  }
  if (!isServiceRoleKey(serviceRoleKey)) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not a recognized server-side key.");
    return jsonResponse({ error: "Member management credentials are misconfigured." }, 500);
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
  if (!body || typeof body.action !== "string") {
    return jsonResponse({ error: "Choose a valid member operation." }, 400);
  }

  const requiredPermissions = body.action === "suspend" ||
      body.action === "reinstate"
    ? ["users.suspend"]
    : body.action === "photos"
      ? ["users.view_sensitive"]
      : body.action === "photo-upload" || body.action === "profile-update" ||
          body.action === "discard-photos"
        ? ["users.manage"]
        : ["users.view"];
  for (const requiredPermission of requiredPermissions) {
    const { data: permitted, error: permissionError } = await authClient.rpc(
      "staff_has_permission",
      { p_permission: requiredPermission },
    );
    if (permissionError) {
      return jsonResponse({ error: "Staff permission could not be verified." }, 500);
    }
    if (permitted !== true) {
      return jsonResponse({ error: `${requiredPermission} permission is required.` }, 403);
    }
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (body.action === "photos") {
      return await handleMemberPhotos(body, authClient, adminClient);
    }
    if (body.action === "detail") {
      return await handleMemberDetail(body, authClient, adminClient);
    }
    if (body.action === "photo-upload") {
      return await handlePhotoUpload(body, adminClient);
    }
    if (body.action === "discard-photos") {
      return await handleDiscardPhotos(body, adminClient);
    }
    if (body.action === "profile-update") {
      return await handleProfileUpdate(body, authClient, adminClient);
    }
    if (body.action === "suspend" || body.action === "reinstate") {
      return await handleAccountAction(
        body,
        staffUser.id,
        adminClient,
      );
    }
  } catch (operationError) {
    console.error("Member management operation failed.", operationError);
    return jsonResponse({
      error: operationError instanceof Error
        ? operationError.message
        : "Member management operation failed.",
    }, 500);
  }
  return jsonResponse({ error: "Choose a valid member operation." }, 400);
});

async function handleMemberDetail(
  body: JsonRecord,
  authClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const memberId = parseMemberId(body.memberId);
  if (!memberId) return jsonResponse({ error: "A valid member ID is required." }, 400);
  const { data, error } = await authClient.rpc("get_staff_member_details", {
    p_user_id: memberId,
  });
  if (error) {
    return jsonResponse({ error: readableRpcError(error.message) }, rpcStatus(error.message));
  }
  if (!isRecord(data) || !Array.isArray(data.photo_paths)) {
    return jsonResponse({ error: "Member details returned an invalid response." }, 500);
  }
  const photoPaths = data.photo_paths.filter(
    (path): path is string =>
      typeof path === "string" &&
      path.startsWith(`${memberId}/`) &&
      !path.includes("..") &&
      !path.includes("://"),
  );
  const photos = await createSignedPhotoUrls(adminClient, photoPaths);
  return jsonResponse({ ...data, photos, photoRefs: photoPaths }, 200);
}

async function handlePhotoUpload(
  body: JsonRecord,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const memberId = parseMemberId(body.memberId);
  const contentType = typeof body.contentType === "string"
    ? body.contentType
    : "";
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const extension = extensions[contentType];
  if (!memberId || !extension) {
    return jsonResponse({ error: "Choose a supported member photo." }, 400);
  }
  const { error: targetError } = await getEditableMember(memberId, adminClient);
  if (targetError) return jsonResponse({ error: targetError }, 404);

  const path = `${memberId}/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await adminClient.storage
    .from("profile-photos")
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.token) {
    return jsonResponse({ error: "A secure upload could not be prepared." }, 500);
  }
  return jsonResponse({ path, token: data.token }, 200);
}

async function handleProfileUpdate(
  body: JsonRecord,
  authClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const memberId = parseMemberId(body.memberId);
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (
    !memberId ||
    nickname.length < 1 ||
    nickname.length > 100 ||
    !Array.isArray(body.photoPaths) ||
    body.photoPaths.some((path) => typeof path !== "string")
  ) {
    return jsonResponse({ error: "Provide a valid member ID, name, and photo list." }, 400);
  }
  const { error: targetError } = await getEditableMember(memberId, adminClient);
  if (targetError) return jsonResponse({ error: targetError }, 404);

  const { data, error } = await authClient.rpc("update_member_profile_by_staff", {
    p_user_id: memberId,
    p_nickname: nickname,
    p_photo_paths: body.photoPaths,
  });
  if (error) {
    if (error.code === "23505") {
      return jsonResponse({ error: "That display name is already in use." }, 409);
    }
    if (error.code === "42501") {
      return jsonResponse({ error: "You do not have permission to edit this profile." }, 403);
    }
    if (error.code === "P0002") {
      return jsonResponse({ error: "Member profile was not found." }, 404);
    }
    return jsonResponse({ error: "Member profile could not be updated." }, 500);
  }
  if (!isRecord(data) || !Array.isArray(data.previous_photo_paths)) {
    return jsonResponse({
      success: true,
      warning: "The profile was saved, but old photo cleanup could not be verified.",
    }, 200);
  }

  const nextPaths = new Set(
    Array.isArray(data.new_photo_paths)
      ? data.new_photo_paths.filter((path): path is string => typeof path === "string")
      : [],
  );
  const removedPaths = data.previous_photo_paths.filter(
    (path): path is string =>
      typeof path === "string" &&
      path.startsWith(`${memberId}/`) &&
      !path.includes("..") &&
      !nextPaths.has(path),
  );
  if (!removedPaths.length) return jsonResponse({ success: true }, 200);

  const { error: cleanupError } = await adminClient.storage
    .from("profile-photos")
    .remove(removedPaths);
  return jsonResponse({
    success: true,
    ...(cleanupError
      ? { warning: "Profile changes were saved, but an unused old photo could not be removed." }
      : {}),
  }, 200);
}

async function handleDiscardPhotos(
  body: JsonRecord,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const memberId = parseMemberId(body.memberId);
  if (
    !memberId ||
    !Array.isArray(body.photoPaths) ||
    body.photoPaths.length > 6 ||
    body.photoPaths.some(
      (path) =>
        typeof path !== "string" ||
        !path.startsWith(`${memberId}/`) ||
        path.includes("..") ||
        path.includes("://"),
    )
  ) {
    return jsonResponse({ error: "Choose valid uploaded photo paths." }, 400);
  }
  const paths = body.photoPaths as string[];
  if (!paths.length) return jsonResponse({ success: true }, 200);
  const { error: targetError } = await getEditableMember(memberId, adminClient);
  if (targetError) return jsonResponse({ error: targetError }, 404);

  const { data: profile, error: profileError } = await adminClient
    .from("dating_profiles")
    .select("profile")
    .eq("user_id", memberId)
    .maybeSingle();
  if (profileError || !profile) {
    return jsonResponse({ error: "Member profile could not be verified for photo cleanup." }, 500);
  }
  const profileRoot = asRecord(profile.profile);
  const memberProfile = asRecord(profileRoot.profile);
  const currentPaths = Array.isArray(memberProfile.photos)
    ? memberProfile.photos.filter((path): path is string => typeof path === "string")
    : [];
  const unusedPaths = paths.filter((path) => !currentPaths.includes(path));
  if (!unusedPaths.length) return jsonResponse({ success: true }, 200);

  const { error } = await adminClient.storage.from("profile-photos").remove(unusedPaths);
  if (error) return jsonResponse({ error: "Temporary uploaded photos could not be removed." }, 500);
  return jsonResponse({ success: true }, 200);
}

async function getEditableMember(
  memberId: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<{ error: string | null }> {
  const { data: staff, error: staffError } = await adminClient
    .from("staff_members")
    .select("id")
    .eq("user_id", memberId)
    .maybeSingle();
  if (staffError) return { error: "Member account could not be verified." };
  if (staff) return { error: "Staff profiles cannot be edited as member profiles." };

  const { data: user, error: userError } = await adminClient.auth.admin
    .getUserById(memberId);
  if (userError || !user.user || user.user.is_anonymous || user.user.deleted_at) {
    return { error: "Member account was not found." };
  }
  const { data: profile, error: profileError } = await adminClient
    .from("dating_profiles")
    .select("user_id")
    .eq("user_id", memberId)
    .maybeSingle();
  if (profileError || !profile) return { error: "Member profile was not found." };
  return { error: null };
}

async function handleMemberPhotos(
  body: JsonRecord,
  authClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> {
  if (!Array.isArray(body.memberIds) || body.memberIds.length > 100) {
    return jsonResponse({ error: "Choose up to 100 valid member IDs." }, 400);
  }
  const parsedIds = [...new Set(body.memberIds.map(parseMemberId))];
  if (parsedIds.some((memberId) => memberId === null)) {
    return jsonResponse({ error: "A member ID is invalid." }, 400);
  }
  const ids = parsedIds.filter((memberId): memberId is string => memberId !== null);
  if (!ids.length) return jsonResponse({ photos: {} }, 200);

  const { data: paths, error: pathsError } = await authClient.rpc(
    "get_staff_member_photo_paths",
    { p_user_ids: ids },
  );
  if (pathsError || !isRecord(paths)) {
    return jsonResponse({ error: "Member profile photos could not be loaded." }, 500);
  }
  const entries: [string, string][] = [];
  for (const [userId, path] of Object.entries(paths)) {
    if (
      ids.includes(userId) &&
      typeof path === "string" &&
      path.startsWith(`${userId}/`) &&
      !path.includes("..") &&
      !path.includes("://")
    ) {
      entries.push([userId, path]);
    }
  }
  const signedUrls = await createSignedPhotoUrls(
    adminClient,
    entries.map(([, path]) => path),
  );
  const photos: Record<string, string> = {};
  entries.forEach(([userId], index) => {
    const url = signedUrls[index];
    if (url) photos[userId] = url;
  });
  return jsonResponse({ photos }, 200);
}

async function handleAccountAction(
  body: JsonRecord,
  actorUserId: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const memberId = parseMemberId(body.memberId);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!memberId || reason.length < 10 || reason.length > 1000) {
    return jsonResponse({
      error: "A valid member ID and a reason of 10–1000 characters are required.",
    }, 400);
  }

  const { data: staffTarget, error: staffTargetError } = await adminClient
    .from("staff_members")
    .select("id")
    .eq("user_id", memberId)
    .maybeSingle();
  if (staffTargetError) {
    return jsonResponse({ error: "The target account could not be verified." }, 500);
  }
  if (staffTarget) {
    return jsonResponse({ error: "Staff accounts cannot be managed as member accounts." }, 403);
  }

  const { data: userResult, error: userError } = await adminClient.auth.admin
    .getUserById(memberId);
  if (userError || !userResult.user || userResult.user.is_anonymous ||
    userResult.user.deleted_at) {
    return jsonResponse({ error: "The member account was not found." }, 404);
  }
  const currentlySuspended = userResult.user.banned_until
    ? Date.parse(userResult.user.banned_until) > Date.now()
    : false;
  const isSuspending = body.action === "suspend";
  if (currentlySuspended === isSuspending) {
    return jsonResponse({
      error: isSuspending
        ? "This member is already suspended."
        : "This member is not currently suspended.",
    }, 409);
  }

  const { data: actorStaff, error: actorStaffError } = await adminClient
    .from("staff_members")
    .select("id")
    .eq("user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle();
  if (actorStaffError || !actorStaff) {
    return jsonResponse({ error: "Active staff membership could not be verified." }, 403);
  }

  const action = isSuspending
    ? "member.account.suspended"
    : "member.account.reinstated";
  const previousBannedUntil = userResult.user.banned_until ?? null;
  const { data: auditRow, error: auditInsertError } = await adminClient
    .from("staff_audit_logs")
    .insert({
      actor_staff_member_id: actorStaff.id,
      actor_user_id: actorUserId,
      target_user_id: memberId,
      action,
      details: {
        reason,
        status: "requested",
        previous_banned_until: previousBannedUntil,
      },
    })
    .select("id")
    .single();
  if (auditInsertError || !auditRow) {
    return jsonResponse({ error: "The action was not applied because its audit entry could not be saved." }, 500);
  }

  const { data: updatedUser, error: updateError } = await adminClient.auth.admin
    .updateUserById(memberId, {
      ban_duration: isSuspending ? "876000h" : "none",
    });
  const actionStatus = updateError || !updatedUser.user ? "failed" : "completed";
  const { error: auditUpdateError } = await adminClient
    .from("staff_audit_logs")
    .update({
      details: {
        reason,
        status: actionStatus,
        previous_banned_until: previousBannedUntil,
        new_banned_until: updatedUser.user?.banned_until ?? null,
      },
    })
    .eq("id", auditRow.id);

  if (updateError || !updatedUser.user) {
    return jsonResponse({
      error: auditUpdateError
        ? "The account action failed and its audit status could not be updated."
        : "The account action failed. The attempt was recorded in the audit log.",
    }, 500);
  }
  if (auditUpdateError) {
    return jsonResponse({
      error: "The account changed, but the audit status could not be updated. Contact an administrator.",
    }, 500);
  }

  return jsonResponse({
    memberId,
    accountStatus: isSuspending ? "suspended" : "active",
  }, 200);
}

async function createSignedPhotoUrls(
  adminClient: ReturnType<typeof createClient>,
  paths: string[],
): Promise<string[]> {
  if (!paths.length) return [];
  const { data, error } = await adminClient.storage
    .from("profile-photos")
    .createSignedUrls(paths, 900);
  if (error) throw new Error("Member profile photos could not be signed.");
  return data.map((item) => {
    if (!item.signedUrl || item.error) {
      throw new Error("A member profile photo could not be signed.");
    }
    return item.signedUrl;
  });
}

function parseMemberId(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

async function readRequestBody(request: Request): Promise<JsonRecord | null> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function readableRpcError(message: string): string {
  if (message.includes("permission") || message.includes("access")) {
    return "You do not have permission to view this member.";
  }
  if (message.includes("not found")) return "Member was not found.";
  return "Member details could not be loaded.";
}

function rpcStatus(message: string): number {
  return message.includes("permission") || message.includes("access") ? 403 : 404;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isServiceRoleKey(token: string): boolean {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(token)) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]));
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
