import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Temporary diagnostic endpoint — DELETE this file once auth is confirmed working.
// Reveals what's broken about the authenticated path on Vercel without leaking
// secrets. Hit it from a logged-in browser session.

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  const env = {
    url,
    anonKey: redact(anonKey),
    serviceKey: redact(serviceKey),
    serviceKeyLooksLikeJwt: serviceKey ? serviceKey.split(".").length === 3 : false,
    serviceKeyDecodedRole: decodeJwtRole(serviceKey),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };

  const result: Record<string, unknown> = { env };

  // 1. Try the user-context client (uses cookies)
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    result.authGetUser = {
      userId: data.user?.id ?? null,
      email: data.user?.email ?? null,
      error: error?.message ?? null,
    };
  } catch (err) {
    result.authGetUser = { error: String(err) };
  }

  // 2. Try the admin client (uses service role)
  if (!url || !serviceKey) {
    result.adminQuery = { error: "skipped — missing url or serviceKey" };
  } else {
    try {
      const restUrl = `${url}/rest/v1/employee_profiles?select=id,email&limit=1`;
      const res = await fetch(restUrl, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      const body = await res.text();
      result.adminQuery = {
        status: res.status,
        ok: res.ok,
        body: body.slice(0, 500),
      };
    } catch (err) {
      result.adminQuery = { error: String(err) };
    }
  }

  // 3. Look up the logged-in user's profile specifically
  const userId =
    typeof (result.authGetUser as { userId?: string })?.userId === "string"
      ? (result.authGetUser as { userId: string }).userId
      : null;

  if (userId && url && serviceKey) {
    try {
      const restUrl = `${url}/rest/v1/employee_profiles?select=id,full_name,email,organization_id&user_id=eq.${userId}`;
      const res = await fetch(restUrl, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      const body = await res.text();
      result.profileLookup = {
        status: res.status,
        ok: res.ok,
        body: body.slice(0, 500),
      };
    } catch (err) {
      result.profileLookup = { error: String(err) };
    }
  } else {
    result.profileLookup = { skipped: true, reason: "no userId or env vars" };
  }

  // 4. Run the EXACT query getServerSession runs (with the supabase-js client,
  //    extra columns, and the nested organization join). This is the one that
  //    actually gates the session — if it returns null/error here, that's the
  //    bug.
  if (userId) {
    try {
      const { data: profile, error } = await supabaseAdmin
        .from("employee_profiles")
        .select(
          "id, full_name, email, organization_id, department_id, job_title, avatar_url, organization:organizations ( id, name )",
        )
        .eq("user_id", userId)
        .maybeSingle();
      result.realProfileQuery = {
        profile,
        error: error
          ? { message: error.message, code: error.code, details: error.details, hint: error.hint }
          : null,
      };
    } catch (err) {
      result.realProfileQuery = { thrown: String(err) };
    }

    // 5. Run the role/permissions query too.
    try {
      const { data: roleRows, error } = await supabaseAdmin
        .from("user_roles")
        .select(
          "role:roles ( key, name, role_permissions ( permission:permissions ( key ) ) )",
        )
        .eq("user_id", userId);
      result.realRoleQuery = {
        rowCount: Array.isArray(roleRows) ? roleRows.length : null,
        sample: Array.isArray(roleRows) ? roleRows.slice(0, 2) : null,
        error: error
          ? { message: error.message, code: error.code, details: error.details, hint: error.hint }
          : null,
      };
    } catch (err) {
      result.realRoleQuery = { thrown: String(err) };
    }
  }

  return NextResponse.json(result, { status: 200 });
}

function redact(value: string | null): string | null {
  if (!value) return null;
  if (value.length < 12) return "<too-short>";
  return `${value.slice(0, 6)}...${value.slice(-4)} (len=${value.length})`;
}

function decodeJwtRole(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf8"),
    );
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
