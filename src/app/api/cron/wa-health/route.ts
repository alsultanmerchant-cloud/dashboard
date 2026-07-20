import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/audit";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import { getOwnerAdminUserIds } from "@/lib/data/org-roles";
import { replayWaWebhookDeadletter, countRecentlyParked } from "@/lib/wa/deadletter";
import {
  listSessions,
  listSessionWebhooks,
  registerSessionWebhook,
  waConfigured,
  isOwnSession,
} from "@/lib/wa/openwa-client";

// WhatsApp ingestion watchdog — the answer to the 2026-07-14 four-day blackout.
//
// Three independent things went wrong that day and NONE of them raised a signal:
//   1. a transient 500 made the gateway delete the webhook registration;
//   2. the primary number's session wedged (status "ready", lastActive frozen);
//   3. /satisfaction kept saying "no new messages", which reads as "all fine".
//
// So every run: re-register any missing webhook (self-heal #1), compare each
// session's lastActive and each account's newest ingested message against the
// clock (detect #2/#3), and replay anything parked in the dead-letter queue.
// Auth: shared secret in the X-Cron-Secret header (CRON_SECRET env var).

export const runtime = "nodejs";
export const maxDuration = 120;

// A session that has done nothing for this long, while still claiming to be
// connected, is wedged rather than quiet.
const WEDGED_HOURS = 6;
// No message ingested for this long across ALL numbers means the pipe is down,
// regardless of what any individual session reports.
const SILENT_HOURS = 12;
// Don't re-notify about the same fault more often than this.
const NOTIFY_COOLDOWN_HOURS = 12;

const hoursSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
};

// Fan the alert out to the org's owners/admins, deduped per recipient per
// cooldown window, so a number that stays wedged for a week doesn't produce a
// week of identical alerts.
//
// Two hard constraints on this table, both of which fail SILENTLY through
// createNotification (it logs and returns null):
//   • notifications_check requires a recipient — a row with both recipient
//     columns null is rejected outright, so system alerts still need owners;
//   • entity_id is UUID, so a friendly key like "ingestion" throws 22P02.
//     Org-wide alerts therefore pass null, never a synthetic string.
async function notifyOwners(params: {
  orgId: string;
  owners: string[];
  type: string;
  entityId: string | null;
  title: string;
  body: string;
}): Promise<number> {
  const since = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 3_600_000).toISOString();
  let created = 0;
  for (const userId of params.owners) {
    let q = supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", params.orgId)
      .eq("recipient_user_id", userId)
      .eq("type", params.type)
      .gte("created_at", since);
    q = params.entityId ? q.eq("entity_id", params.entityId) : q.is("entity_id", null);
    const { count } = await q;
    if ((count ?? 0) > 0) continue;

    await createNotification({
      organizationId: params.orgId,
      recipientUserId: userId,
      type: params.type,
      title: params.title,
      body: params.body,
      entityType: "wa_account",
      entityId: params.entityId,
    });
    created++;
  }
  return created;
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!waConfigured()) {
    return NextResponse.json({ ok: false, error: "WA_API_URL not configured" }, { status: 400 });
  }

  const orgId = await getDefaultOrgId();
  // Alerts are useless without a recipient (notifications_check enforces one).
  const owners = await getOwnerAdminUserIds(orgId);
  const webhookBase = (process.env.WA_PUBLIC_WEBHOOK_URL ?? "").split("?")[0];

  const { data: accounts, error } = await supabaseAdmin
    .from("wa_accounts")
    .select("id, session_id, phone, label")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A gateway we cannot reach is itself the alert — don't misreport it as
  // "every number is broken".
  let sessions;
  try {
    sessions = await listSessions();
  } catch (e) {
    await notifyOwners({
      orgId,
      owners,
      type: "WA_GATEWAY_UNREACHABLE",
      entityId: null,
      title: "بوابة واتساب غير متاحة",
      body: `تعذّر الوصول إلى بوابة OpenWA: ${(e as Error).message}`,
    });
    return NextResponse.json({ ok: false, error: "gateway unreachable" }, { status: 502 });
  }
  const byName = new Map(sessions.map((s) => [s.name, s]));

  const report: Array<Record<string, unknown>> = [];

  for (const account of accounts ?? []) {
    const name = account.session_id as string;
    const label = (account.label as string) ?? (account.phone as string) ?? name;
    const row: Record<string, unknown> = { session: name, healed: [], faults: [] };
    const faults = row.faults as string[];
    const healed = row.healed as string[];

    if (!isOwnSession(name)) {
      row.skipped = "not a Rawasm session";
      report.push(row);
      continue;
    }

    const session = byName.get(name);
    if (!session) {
      faults.push("session_missing");
      await notifyOwners({
        orgId,
        owners,
        type: "WA_SESSION_MISSING",
        entityId: account.id as string,
        title: `رقم واتساب غير موجود على البوابة: ${label}`,
        body: `الجلسة ${name} غير موجودة على بوابة OpenWA — يلزم إعادة ربط الرقم.`,
      });
      report.push(row);
      continue;
    }

    // ---- 1. Self-heal: is our webhook still registered? --------------------
    try {
      const hooks = (await listSessionWebhooks(session.uuid)).filter((h) => h.active);
      const ours = webhookBase
        ? hooks.some((h) => h.url.split("?")[0] === webhookBase)
        : hooks.length > 0;
      row.webhooks = hooks.length;
      if (!ours) {
        faults.push("webhook_missing");
        const ok = await registerSessionWebhook(session.uuid, name);
        if (ok) {
          healed.push("webhook_reregistered");
        } else {
          await notifyOwners({
            orgId,
            owners,
            type: "WA_WEBHOOK_MISSING",
            entityId: account.id as string,
            title: `تعذّرت إعادة تسجيل إشعارات واتساب: ${label}`,
            body: `«${label}» بلا webhook على البوابة ولم تنجح إعادة التسجيل تلقائيًا — الرسائل لن تصل.`,
          });
        }
      }
    } catch (e) {
      faults.push(`webhook_check_failed:${(e as Error).message}`);
    }

    // ---- 2. Detect a wedged session (status lies; lastActive doesn't) ------
    const idleHours = hoursSince(session.lastActive);
    row.status = session.status;
    row.lastActive = session.lastActive;
    row.idleHours = idleHours === null ? null : Math.round(idleHours);
    if (session.status === "CONNECTED" && idleHours !== null && idleHours >= WEDGED_HOURS) {
      faults.push("session_wedged");
      await notifyOwners({
        orgId,
        owners,
        type: "WA_SESSION_WEDGED",
        entityId: account.id as string,
        title: `رقم واتساب متوقف عن النشاط: ${label}`,
        body:
          `«${label}» يظهر "متصل" لكنه لم ينفّذ أي نشاط منذ ${Math.round(idleHours)} ساعة. ` +
          `الجلسة على الأرجح معلّقة — استخدم "إعادة الربط" على الرقم ثم "سحب السجل".`,
      });
    }

    report.push(row);
  }

  // ---- 3. Is the pipe silent overall? ------------------------------------
  const { data: newest } = await supabaseAdmin
    .from("wa_messages")
    .select("sent_at")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1);
  const newestSentAt = (newest?.[0] as { sent_at: string } | undefined)?.sent_at ?? null;
  const silentHours = hoursSince(newestSentAt);
  if (silentHours !== null && silentHours >= SILENT_HOURS) {
    await notifyOwners({
      orgId,
      owners,
      type: "WA_INGESTION_STALLED",
      entityId: null,
      title: "توقّف استقبال رسائل واتساب",
      body:
        `لم تصل أي رسالة واتساب منذ ${Math.round(silentHours)} ساعة (آخر رسالة: ${newestSentAt}). ` +
        `تحليلات رضا العملاء ستكون مبنية على بيانات قديمة حتى يعود الاستقبال.`,
    });
  }

  // ---- 4. Is OUR endpoint erroring? --------------------------------------
  // Parked payloads mean /api/wa/webhook threw — the exact condition (500s) that
  // used to end in de-registration. Surfaced within minutes now, instead of
  // waiting for the pipe to go silent.
  const parkedRecently = await countRecentlyParked();
  const deadletter = await replayWaWebhookDeadletter();
  if (parkedRecently > 0 && deadletter.stillFailing > 0) {
    await notifyOwners({
      orgId,
      owners,
      type: "WA_WEBHOOK_ERRORS",
      entityId: null,
      title: "أخطاء في استقبال رسائل واتساب",
      body:
        `فشل معالجة ${parkedRecently} رسالة واردة خلال الساعتين الماضيتين ولم تنجح إعادة المحاولة. ` +
        `الرسائل محفوظة وسيُعاد تشغيلها تلقائيًا، لكن يلزم فحص الخطأ في /api/wa/webhook.`,
    });
  }

  return NextResponse.json({
    ok: true,
    newestSentAt,
    silentHours: silentHours === null ? null : Math.round(silentHours),
    accounts: report,
    parkedRecently,
    deadletter,
  });
}
