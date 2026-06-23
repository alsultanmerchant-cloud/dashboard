import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/audit";
import { getAtRiskClients } from "@/lib/data/satisfaction";
import { getCurrentStoredInsight } from "@/lib/data/ai-insights";
import { getOwnerAdminUserIds } from "@/lib/data/org-roles";

// Turns already-computed analysis signals into owner/admin notifications.
// Runs daily via /api/cron/insight-alerts. Three signal families (per the
// agreed scope): client-satisfaction risk, contracts & collection, and the
// critical items from the latest AI insights run. Executive-score drops are
// intentionally out of scope for now.
//
// Dedup: a signal is emitted to a recipient only if they don't already have an
// UNREAD notification of the same (type, entity_id). Once they read/act on it,
// a still-true condition legitimately re-surfaces the next day — no schema
// change, mirrors notifyWaLinkingState in satisfaction/_actions.ts.

export interface InsightAlertsSummary {
  created: number;
  skipped: number;
  byType: Record<string, number>;
  recipients: number;
  dryRun: boolean;
}

const RENEWAL_MIN_DAYS = 7;
const RENEWAL_MAX_DAYS = 30;

function fmtMoney(n: number | null | undefined): string {
  if (!n) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

type Plan = {
  type: string;
  title: string;
  body: string | null;
  entityType: string;
  entityId: string;
};

export async function generateInsightAlerts(
  orgId: string,
  opts?: { dryRun?: boolean },
): Promise<InsightAlertsSummary> {
  const dryRun = opts?.dryRun ?? false;
  const summary: InsightAlertsSummary = {
    created: 0,
    skipped: 0,
    byType: {},
    recipients: 0,
    dryRun,
  };

  const owners = await getOwnerAdminUserIds(orgId);
  summary.recipients = owners.length;
  if (owners.length === 0) return summary;

  const plans: Plan[] = [];

  // ---- 1) Client satisfaction risk --------------------------------------
  const atRisk = await getAtRiskClients(orgId);
  for (const c of atRisk) {
    const bits: string[] = [];
    if (c.satisfactionScore != null) bits.push(`الرضا ${c.satisfactionScore}/100`);
    if (c.sentiment) bits.push(`المشاعر: ${c.sentiment}`);
    if (c.topRisk) bits.push(c.topRisk);
    plans.push({
      type: "CLIENT_SATISFACTION_RISK",
      title: `العميل «${c.clientName}» في خطر`,
      body: bits.join(" — ") || null,
      entityType: "client",
      entityId: c.clientId,
    });
  }

  // ---- 2) Contracts & collection ----------------------------------------
  const today = isoDay(0);
  const { data: renewals } = await supabaseAdmin
    .from("contracts")
    .select("id, contract_code, total_value, end_date, client:clients(name)")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .gte("end_date", isoDay(RENEWAL_MIN_DAYS))
    .lte("end_date", isoDay(RENEWAL_MAX_DAYS));
  for (const r of (renewals ?? []) as Array<{
    id: string;
    contract_code: string | null;
    total_value: number | null;
    end_date: string | null;
    client: { name: string } | { name: string }[] | null;
  }>) {
    const client = Array.isArray(r.client) ? r.client[0] : r.client;
    const label = r.contract_code ? `${r.contract_code} · ` : "";
    plans.push({
      type: "CONTRACT_RENEWAL_DUE",
      title: `تجديد عقد «${client?.name ?? "—"}» قريبًا`,
      body: `${label}ينتهي بتاريخ ${r.end_date ?? "—"} — بقيمة ${fmtMoney(r.total_value)} ريال. جهّز التجديد.`,
      entityType: "contract",
      entityId: r.id,
    });
  }

  // Overdue installments — one alert per contract (not per installment) to
  // avoid spamming a contract with several missed payments.
  const { data: overdue } = await supabaseAdmin
    .from("installments")
    // Inner-join + status filter: only alert on receivables for LIVE contracts.
    // Closed/lost/expired contracts carry uncollectible installments that are
    // not a real collection threat.
    .select("id, contract_id, expected_amount, expected_date, contract:contracts!inner(contract_code, status, client:clients(name))")
    .eq("organization_id", orgId)
    .lt("expected_date", today)
    .or("actual_amount.is.null,actual_amount.eq.0")
    .in("contract.status", ["active", "hold"]);
  const byContract = new Map<string, { count: number; amount: number; code: string | null; client: string | null }>();
  for (const i of (overdue ?? []) as Array<{
    contract_id: string | null;
    expected_amount: number | null;
    contract:
      | { contract_code: string | null; client: { name: string } | { name: string }[] | null }
      | { contract_code: string | null; client: { name: string } | { name: string }[] | null }[]
      | null;
  }>) {
    if (!i.contract_id) continue;
    const ct = Array.isArray(i.contract) ? i.contract[0] : i.contract;
    const client = ct ? (Array.isArray(ct.client) ? ct.client[0] : ct.client) : null;
    const prev = byContract.get(i.contract_id) ?? {
      count: 0,
      amount: 0,
      code: ct?.contract_code ?? null,
      client: client?.name ?? null,
    };
    prev.count += 1;
    prev.amount += i.expected_amount ?? 0;
    byContract.set(i.contract_id, prev);
  }
  for (const [contractId, agg] of byContract) {
    const label = agg.code ? `${agg.code} · ` : "";
    plans.push({
      type: "INSTALLMENT_OVERDUE",
      title: `دفعات متأخرة التحصيل — «${agg.client ?? "—"}»`,
      body: `${label}${agg.count} دفعة متأخرة بقيمة ${fmtMoney(agg.amount)} ريال.`,
      entityType: "contract",
      entityId: contractId,
    });
  }

  // ---- 3) AI critical priorities ----------------------------------------
  const run = await getCurrentStoredInsight(orgId);
  if (run?.result) {
    const critical = run.result.topPriorities.filter((p) => p.severity === "critical");
    const bottlenecks = run.result.stageBottlenecks ?? [];
    if (critical.length > 0 || bottlenecks.length > 0) {
      const lines: string[] = [];
      if (critical.length > 0) {
        lines.push(`${critical.length} أولوية حرجة: ` + critical.map((p) => p.title).slice(0, 3).join("، "));
      }
      if (bottlenecks.length > 0) {
        lines.push("اختناقات: " + bottlenecks.map((b) => `${b.stage} (${b.count})`).slice(0, 3).join("، "));
      }
      plans.push({
        type: "AI_INSIGHT_CRITICAL",
        title: "تحليل الذكاء الاصطناعي: مسائل حرجة تحتاج انتباهك",
        body: lines.join(" — "),
        entityType: "ai_insight_run",
        entityId: run.id,
      });
    }
  }

  // ---- Emit (deduped per recipient) -------------------------------------
  for (const plan of plans) {
    summary.byType[plan.type] = (summary.byType[plan.type] ?? 0) + 0; // ensure key exists
    for (const userId of owners) {
      const { count } = await supabaseAdmin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("recipient_user_id", userId)
        .eq("type", plan.type)
        .eq("entity_id", plan.entityId)
        .is("read_at", null);
      if ((count ?? 0) > 0) {
        summary.skipped += 1;
        continue;
      }
      if (!dryRun) {
        await createNotification({
          organizationId: orgId,
          recipientUserId: userId,
          type: plan.type,
          title: plan.title,
          body: plan.body,
          entityType: plan.entityType,
          entityId: plan.entityId,
        });
      }
      summary.created += 1;
      summary.byType[plan.type] = (summary.byType[plan.type] ?? 0) + 1;
    }
  }

  return summary;
}
