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
    return jsonResponse({ error: "Safety management is not configured." }, 500);
  }
  if (!isServiceRoleKey(serviceRoleKey)) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not a recognized server-side key.");
    return jsonResponse({ error: "Safety management credentials are misconfigured." }, 500);
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

  const { data: permitted, error: permissionError } = await authClient.rpc(
    "staff_has_permission",
    { p_permission: "moderation.view" },
  );
  if (permissionError) {
    return jsonResponse({ error: "Staff permission could not be verified." }, 500);
  }
  if (permitted !== true) {
    return jsonResponse({ error: "Moderation viewing permission is required." }, 403);
  }

  const body = await readRequestBody(request);
  if (
    !body ||
    body.action !== "report-detail" ||
    typeof body.reportId !== "string" ||
    !uuidPattern.test(body.reportId)
  ) {
    return jsonResponse({ error: "Choose a valid safety operation and report ID." }, 400);
  }

  const { data, error } = await authClient.rpc(
    "get_staff_user_report_detail",
    { p_report_id: body.reportId },
  );
  if (error) {
    const status = error.code === "42501"
      ? 403
      : error.code === "P0002"
      ? 404
      : 500;
    return jsonResponse({
      error: status === 403
        ? "You do not have permission to view this report."
        : status === 404
        ? "This report could not be found."
        : "Report details could not be loaded.",
    }, status);
  }
  if (!isRecord(data) || !isRecord(data.report)) {
    return jsonResponse({ error: "Report details returned an invalid response." }, 500);
  }

  const report = { ...data.report };
  const evidence = isRecord(report.profile_evidence)
    ? { ...report.profile_evidence }
    : null;
  const profilePhotoPaths = evidence?.photo_paths;
  if (evidence) delete evidence.photo_paths;
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (profilePhotoPaths !== undefined && !Array.isArray(profilePhotoPaths)) {
    return jsonResponse({ error: "Profile evidence metadata was invalid." }, 500);
  }
  const memberId = typeof report.reported_user_id === "string"
    ? report.reported_user_id
    : "";
  const photoPaths = Array.isArray(profilePhotoPaths)
    ? profilePhotoPaths.filter(
      (path): path is string =>
        typeof path === "string" &&
        path.startsWith(`${memberId}/`) &&
        !path.includes("..") &&
        !path.includes("://"),
    )
    : [];
  if (Array.isArray(profilePhotoPaths) && photoPaths.length !== profilePhotoPaths.length) {
    return jsonResponse({ error: "Profile evidence paths were invalid." }, 500);
  }

  const signedPhotos: string[] = [];
  for (const path of photoPaths) {
    const { data: signedPhoto, error: signingError } = await serviceClient.storage
      .from("profile-photos")
      .createSignedUrl(path, 600);
    if (signingError || !signedPhoto?.signedUrl) {
      console.error("A reported profile photo could not be signed.", signingError);
      return jsonResponse({ error: "Reported profile photos could not be loaded securely." }, 500);
    }
    signedPhotos.push(signedPhoto.signedUrl);
  }

  return jsonResponse({
    ...data,
    report: {
      ...report,
      profile_evidence: evidence
        ? { ...evidence, photos: signedPhotos }
        : null,
    },
  }, 200);
});

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
    const payload: unknown = JSON.parse(atob(parts[1]));
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
