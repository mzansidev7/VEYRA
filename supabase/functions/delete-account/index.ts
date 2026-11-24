import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    return jsonResponse({ error: "Account deletion is not configured." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Your session is invalid or expired." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const bucket of ["profile-photos", "profile-voice-intros"]) {
    const cleanupError = await removeUserFiles(
      adminClient,
      bucket,
      user.id,
    );
    if (cleanupError) {
      return jsonResponse(
        { error: `Could not remove account media: ${cleanupError}` },
        500,
      );
    }
  }

  const { error: blockCleanupError } = await adminClient
    .from("blocked_users")
    .delete()
    .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);
  if (blockCleanupError) {
    return jsonResponse(
      { error: `Could not remove account block records: ${blockCleanupError.message}` },
      500,
    );
  }

  const { error: hiddenCleanupError } = await adminClient
    .from("hidden_profiles")
    .delete()
    .or(`user_id.eq.${user.id},hidden_user_id.eq.${user.id}`);
  if (hiddenCleanupError) {
    return jsonResponse(
      { error: `Could not remove hidden-profile records: ${hiddenCleanupError.message}` },
      500,
    );
  }

  const { error: notificationCleanupError } = await adminClient
    .from("user_notification_settings")
    .delete()
    .eq("user_id", user.id);
  if (notificationCleanupError) {
    return jsonResponse(
      { error: `Could not remove notification settings: ${notificationCleanupError.message}` },
      500,
    );
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(
    user.id,
  );
  if (deleteError) {
    return jsonResponse(
      { error: `Could not delete the account: ${deleteError.message}` },
      500,
    );
  }

  return jsonResponse({ success: true }, 200);
});

async function removeUserFiles(
  client: ReturnType<typeof createClient>,
  bucket: string,
  userId: string,
): Promise<string | null> {
  const paths: string[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(userId, { limit: pageSize, offset });
    if (error) return `${bucket}: ${error.message}`;

    paths.push(
      ...data
        .filter((entry) => entry.id && !entry.name.startsWith("."))
        .map((entry) => `${userId}/${entry.name}`),
    );
    if (data.length < pageSize) break;
  }

  for (let index = 0; index < paths.length; index += pageSize) {
    const { error } = await client.storage
      .from(bucket)
      .remove(paths.slice(index, index + pageSize));
    if (error) return `${bucket}: ${error.message}`;
  }
  return null;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
