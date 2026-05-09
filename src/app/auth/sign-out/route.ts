import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Sign-out lives in a route handler because Server Components cannot mutate
// cookies. `getServerSession` redirects here when a JWT exists but the
// employee_profiles row is missing — clearing the cookie breaks the
// middleware → `/` → `/login` loop.
async function handle(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
