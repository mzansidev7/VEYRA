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
    return jsonResponse({ error: "Verification management is not configured." }, 500);
  }
  if (!isServiceRoleKey(serviceRoleKey)) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not a recognized server-side key.");
    return jsonResponse({ error: "Verification credentials are misconfigured." }, 500);
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
  if (
    !body ||
    body.action !== "evidence-url" ||
    typeof body.submissionId !== "string" ||
    !uuidPattern.test(body.submissionId) ||
    typeof body.evidenceId !== "string" ||
    !uuidPattern.test(body.evidenceId)
  ) {
    return jsonResponse({ error: "Choose a valid verification evidence item." }, 400);
  }

  for (const permission of ["verification.view", "verification.view_evidence"]) {
    const { data: permitted, error: permissionError } = await authClient.rpc(
      "staff_has_permission",
      { p_permission: permission },
    );
    if (permissionError) {
      return jsonResponse({ error: "Staff permission could not be verified." }, 500);
    }
    if (permitted !== true) {
      return jsonResponse({ error: "You do not have permission to view evidence." }, 403);
    }
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: submission, error: submissionError } = await serviceClient
    .from("verification_submissions")
    .select("user_id")
    .eq("id", body.submissionId)
    .maybeSingle();
  if (submissionError) {
    console.error("Verification submission lookup failed.", submissionError);
    return jsonResponse({ error: "Verification evidence could not be loaded." }, 500);
  }
  if (!submission || typeof submission.user_id !== "string") {
    return jsonResponse({ error: "Verification evidence was not found." }, 404);
  }

  const { data: evidence, error: evidenceError } = await serviceClient
    .from("verification_submission_evidence")
    .select("storage_path")
    .eq("id", body.evidenceId)
    .eq("submission_id", body.submissionId)
    .maybeSingle();
  if (evidenceError) {
    console.error("Verification evidence lookup failed.", evidenceError);
    return jsonResponse({ error: "Verification evidence could not be loaded." }, 500);
  }

  const expectedPath = typeof evidence?.storage_path === "string"
    ? evidence.storage_path
    : "";
  const pathPattern = new RegExp(
    `^${submission.user_id}/${body.submissionId}/${body.evidenceId}\\.(jpg|png|pdf)$`,
    "i",
  );
  if (!pathPattern.test(expectedPath)) {
    return jsonResponse({ error: "Verification evidence was not found." }, 404);
  }

  const { data: signedFile, error: signingError } = await serviceClient.storage
    .from("verification-evidence")
    .createSignedUrl(expectedPath, 180);
  if (signingError || !signedFile?.signedUrl) {
    console.error("Verification evidence could not be signed.", signingError);
    return jsonResponse({ error: "Verification evidence could not be opened securely." }, 500);
  }

  const { error: auditError } = await authClient.rpc(
    "staff_record_verification_evidence_access",
    {
      p_submission_id: body.submissionId,
      p_evidence_id: body.evidenceId,
    },
  );
  if (auditError) {
    console.error("Verification evidence access could not be audited.", auditError);
    return jsonResponse({ error: "Evidence access could not be recorded." }, 500);
  }

  return jsonResponse({ signedUrl: signedFile.signedUrl, expiresIn: 180 }, 200);
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
