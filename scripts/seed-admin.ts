import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ohqvxzbjwdicdsuuwcjq.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ADMIN_EMAIL = "admin@restavo.com";
const ADMIN_PASSWORD = "Admin@123456";
const ADMIN_NAME = "المدير العام";
const ORG_ID = "00000000-0000-0000-0000-000000000001"; // Manues
const SUPER_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000099";

async function seed() {
  console.log("Creating super admin user...");

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message.includes("already been registered")) {
      console.log("User already exists, updating profile...");
      // Get existing user
      const { data: users } = await supabase.auth.admin.listUsers();
      const existing = users?.users.find((u) => u.email === ADMIN_EMAIL);
      if (existing) {
        await upsertProfile(existing.id);
      }
      return;
    }
    console.error("Auth error:", authError.message);
    process.exit(1);
  }

  await upsertProfile(authData.user.id);
}

async function upsertProfile(userId: string) {
  const { error } = await supabase.from("user_profiles").upsert({
    id: userId,
    org_id: ORG_ID,
    role_id: SUPER_ADMIN_ROLE_ID,
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    is_super_admin: true,
  });

  if (error) {
    console.error("Profile error:", error.message);
    process.exit(1);
  }

  console.log("Super admin created successfully!");
  console.log(`  Email: ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  Org: Manues (${ORG_ID})`);
}

seed();
