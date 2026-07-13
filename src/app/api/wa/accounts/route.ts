import { NextRequest } from "next/server";
import crypto from "node:crypto";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import {
  getSessionInfo,
  startSession,
  logoutSession,
  WA_SESSION_ID,
} from "@/lib/wa/openwa-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  try {
    await requirePermission("clients.manage");
    return null;
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
}

interface AccountRow {
  id: string;
  session_id: string;
  phone: string | null;
  label: string | null;
  is_active: boolean;
  status: string;
  last_seen_at: string | null;
}

// List connected numbers, each merged with its LIVE gateway status so the UI
// shows the real connection state (not just the last-stored one).
export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const orgId = await getDefaultOrgId();

  const { data, error } = await supabaseAdmin
    .from("wa_accounts")
    .select("id, session_id, phone, label, is_active, status, last_seen_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const accounts = await Promise.all(
    ((data ?? []) as AccountRow[]).map(async (a) => {
      const live = await getSessionInfo(a.session_id);
      // Keep the stored status/phone fresh from the live read.
      if (live.status !== a.status || (live.phone && live.phone !== a.phone)) {
        await supabaseAdmin
          .from("wa_accounts")
          .update({
            status: live.status,
            phone: live.phone ?? a.phone,
            updated_at: new Date().toISOString(),
          })
          .eq("id", a.id);
      }
      return {
        ...a,
        status: live.status,
        phone: live.phone ?? a.phone,
        pushname: live.pushname,
        status_updated_at: live.statusUpdatedAt ?? null,
      };
    }),
  );

  return Response.json({ accounts });
}

// Add a new number: create the account row, then create+start its gateway
// session (which registers the account-tagged webhook). The UI then polls
// /api/wa/session?session=<id> for the QR.
export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const orgId = await getDefaultOrgId();

  let label: string | null = null;
  try {
    const body = (await req.json()) as { label?: string };
    label = body.label?.trim() || null;
  } catch {
    /* empty body is fine */
  }

  const sessionId = `${WA_SESSION_ID}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: row, error } = await supabaseAdmin
    .from("wa_accounts")
    .insert({
      organization_id: orgId,
      session_id: sessionId,
      label,
      status: "INITIALIZING",
    })
    .select("id, session_id, phone, label, is_active, status, last_seen_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const started = await startSession(sessionId);
  if (!started.ok) {
    return Response.json({ account: row, warning: started.error }, { status: 502 });
  }
  return Response.json({ account: row });
}

// Remove a number: log out its gateway session and delete the account row.
// Provenance on past messages survives (FK is on delete set null).
export async function DELETE(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const orgId = await getDefaultOrgId();

  const session = req.nextUrl.searchParams.get("session");
  if (!session) return Response.json({ error: "session required" }, { status: 400 });
  if (session === WA_SESSION_ID) {
    return Response.json({ error: "cannot remove the primary number" }, { status: 400 });
  }

  await logoutSession(session);
  const { error } = await supabaseAdmin
    .from("wa_accounts")
    .delete()
    .eq("organization_id", orgId)
    .eq("session_id", session);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
