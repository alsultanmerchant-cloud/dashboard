import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import {
  listSessions,
  registerSessionWebhook,
  waConfigured,
  isOwnSession,
} from "@/lib/wa/openwa-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// (Re)register the dashboard webhook on EVERY enrolled number's gateway session,
// so live group messages flow in no matter which number is a member of a group.
// Idempotent on the OpenWA side. Must run where WA_PUBLIC_WEBHOOK_URL is a
// public URL (i.e. production) — registering a localhost URL from dev would
// point the gateway at an unreachable address.
export async function POST() {
  try {
    await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
  if (!waConfigured()) {
    return Response.json({ error: "WA_API_URL غير مهيأ" }, { status: 400 });
  }
  const publicUrl = process.env.WA_PUBLIC_WEBHOOK_URL;
  if (!publicUrl) {
    return Response.json({ error: "WA_PUBLIC_WEBHOOK_URL غير مهيأ" }, { status: 400 });
  }
  // Guard against registering a dev/localhost webhook on the live gateway: the
  // gateway must be able to reach the URL, and a private host would silently
  // black-hole every event. So this only works from a deployed (public) env.
  let host = "";
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    return Response.json({ error: "WA_PUBLIC_WEBHOOK_URL غير صالح" }, { status: 400 });
  }
  if (/^(localhost|127\.|0\.0\.0\.0|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return Response.json(
      {
        error:
          "هذا الإجراء يعمل فقط من البيئة المنشورة (production) — عنوان الويبهوك الحالي محلي ولا يستطيع البوابة الوصول إليه.",
      },
      { status: 400 },
    );
  }

  const orgId = await getDefaultOrgId();
  const { data: accounts, error } = await supabaseAdmin
    .from("wa_accounts")
    .select("session_id")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const sessions = await listSessions();
  const byName = new Map(sessions.map((s) => [s.name, s]));

  const results: Array<{ session: string; ok: boolean; note?: string }> = [];
  for (const a of accounts ?? []) {
    const name = a.session_id as string;
    // Tenant isolation: never register a webhook on a session that isn't ours,
    // even if it somehow ended up in wa_accounts.
    if (!isOwnSession(name)) {
      results.push({ session: name, ok: false, note: "skipped — not a Rawasm session" });
      continue;
    }
    const s = byName.get(name);
    if (!s) {
      results.push({ session: name, ok: false, note: "session not found on gateway" });
      continue;
    }
    const ok = await registerSessionWebhook(s.uuid, name);
    results.push({ session: name, ok });
  }

  const registered = results.filter((r) => r.ok).length;
  return Response.json({ ok: true, registered, total: results.length, results });
}
