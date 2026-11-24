import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const sourcePhotos = [
  "bf499a76-8965-4eba-b941-5e5125fd1541/209030c6-14c8-43e5-9c7a-834cd183f804.jpeg",
  "bf499a76-8965-4eba-b941-5e5125fd1541/c394142e-e043-4a49-9668-59c9b59fa64f.jpeg",
  "bf499a76-8965-4eba-b941-5e5125fd1541/f8f71db1-022b-483a-99b5-6f712965fdf0.jpeg",
];

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const developmentProjectRef = process.env.VEYRA_DEVELOPMENT_PROJECT_REF;

const missingSettings = [
  !supabaseUrl && "SUPABASE_URL",
  !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
  !developmentProjectRef && "VEYRA_DEVELOPMENT_PROJECT_REF",
  process.env.VEYRA_CONFIRM_DEVELOPMENT !== "I_CONFIRM" &&
    "VEYRA_CONFIRM_DEVELOPMENT=I_CONFIRM",
].filter(Boolean);

if (missingSettings.length > 0) {
  throw new Error(
    `Missing required settings: ${missingSettings.join(", ")}. The script loads .env automatically; keep service-role credentials local and never commit them.`,
  );
}

const projectUrl = new URL(supabaseUrl);
if (
  projectUrl.hostname !== `${developmentProjectRef}.supabase.co` ||
  !/^[a-z0-9]+$/.test(developmentProjectRef)
) {
  throw new Error(
    "SUPABASE_URL must match the explicitly supplied development project ref.",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sourceFiles = await Promise.all(
  sourcePhotos.map(async (path) => {
    const { data, error } = await supabase.storage
      .from("profile-photos")
      .download(path);
    if (error) throw new Error(`Could not download ${path}: ${error.message}`);
    return { fileName: path.split("/").at(-1), data };
  }),
);

const testUserIds = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) throw new Error(`Could not list test users: ${error.message}`);
  testUserIds.push(
    ...data.users
      .filter((user) => user.app_metadata?.veyra_test_user === true)
      .map((user) => user.id),
  );
  if (data.users.length < 1000) break;
}

let updated = 0;
let skipped = 0;
for (let index = 0; index < testUserIds.length; index += 100) {
  const userIds = testUserIds.slice(index, index + 100);
  const { data: profiles, error } = await supabase
    .from("dating_profiles")
    .select("user_id, profile")
    .in("user_id", userIds);
  if (error) throw new Error(`Could not load dating profiles: ${error.message}`);

  for (const row of profiles) {
    if (!isRecord(row.profile)) {
      throw new Error(`Profile ${row.user_id} is not a JSON object.`);
    }

    const nextProfile = structuredClone(row.profile);
    if (!isRecord(nextProfile.profile)) nextProfile.profile = {};
    const currentPhotos = nextProfile.profile.photos;
    if (Array.isArray(currentPhotos) && currentPhotos.length > 0) {
      skipped += 1;
      continue;
    }

    const userPhotos = [];
    for (const file of sourceFiles) {
      const path = `${row.user_id}/${file.fileName}`;
      const { error: uploadError } = await supabase.storage
        .from("profile-photos")
        .upload(path, file.data, {
          contentType: file.data.type || "image/jpeg",
          upsert: true,
        });
      if (uploadError) {
        throw new Error(
          `Could not copy a development photo for ${row.user_id}: ${uploadError.message}`,
        );
      }
      userPhotos.push(path);
    }

    nextProfile.profile.photos = userPhotos;
    const { error: updateError } = await supabase
      .from("dating_profiles")
      .update({ profile: nextProfile })
      .eq("user_id", row.user_id);
    if (updateError) {
      throw new Error(
        `Could not update the profile for ${row.user_id}: ${updateError.message}`,
      );
    }
    updated += 1;
  }
}

console.log(`Updated ${updated} test profiles; skipped ${skipped} with photos.`);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
