import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getExecutiveScores, gradeFor, type ExecutiveScores } from "@/lib/data/executive-scores";
import { getAccountabilityOverview } from "@/lib/data/accountability";

// =========================================================================
// CEO morning brief — data composer.
// Pulls the three card payloads from loaders that are already audited:
// executive scores (dashboard hero), accountability (Tier-A only), and the
// contracts/installments money snapshot. No AI calls — everything here is
// deterministic so the brief never blocks on Gemini credits.
// =========================================================================

export interface BriefScoreLine {
  key: "delivery" | "quality" | "discipline" | "productivity" | "stability";
  label: string; // Arabic
  score: number;
  grade: string;
  delta: number | null;
}

export interface BriefPersonLine {
  name: string;
  roleLabel: string; // Arabic
  score: number | null;
  overdue: number;
  openTasks: number;
}

export interface BriefReviewerLine {
  name: string;
  reviews: number;
  medianMinutes: number | null;
  reworkPct: number | null;
}

export interface BriefMoney {
  renew30Count: number;
  renew30Value: number;
  overdueInstallments: number;
  overdueClients: number; // distinct clients behind the overdue installments
  overdueValue: number;
  paidThisMonth: number;
}

export interface CeoBriefData {
  dateLabel: string; // Arabic Gregorian date
  scores: BriefScoreLine[];
  overdueTotal: number;
  people: BriefPersonLine[];
  reviewers: BriefReviewerLine[];
  money: BriefMoney;
  caption: string; // Arabic WhatsApp message accompanying the cards
}

const SCORE_LABELS: Record<BriefScoreLine["key"], string> = {
  delivery: "الالتزام بالتسليم",
  quality: "جودة التنفيذ",
  discipline: "انضباط الفريق",
  productivity: "الإنتاجية",
  stability: "الاستقرار التشغيلي",
};

const ROLE_LABELS: Record<string, string> = {
  agent: "منفّذ",
  account_manager: "مدير حساب",
  team_manager: "مدير قسم",
};

function scoreLines(s: ExecutiveScores): BriefScoreLine[] {
  return (Object.keys(SCORE_LABELS) as BriefScoreLine["key"][]).map((key) => ({
    key,
    label: SCORE_LABELS[key],
    score: Math.round(s[key].score),
    grade: gradeFor(s[key].score),
    delta: s[key].delta,
  }));
}

async function loadMoney(orgId: string): Promise<BriefMoney> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  // Last day of the current month — needed for the engine's "overdue
  // installment" window (collected-this-month still counts as overdue).
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);

  const [renewals, overdueInst, paid, monthRow] = await Promise.all([
    supabaseAdmin
      .from("contracts")
      .select("total_value", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", horizon),
    // Overdue installments aligned to the CONTRACTS ENGINE definition (sheet
    // cells acc_exp_overdue_inst / sales_exp_overdue_inst, migrations 0168/0172):
    // payment seq >= 2 (seq 1 = signing deposit), real revenue source types,
    // expected before this month, still open or collected this month, contract
    // not lost before this month. Status is NOT a filter (the sheet keys off
    // lost_date). The headline VALUE is read from the engine store below so it
    // matches the sheet to the riyal; these rows drive the client/payment counts.
    supabaseAdmin
      .from("installments")
      .select("expected_amount, contract:contracts!inner(client_id)", { count: "exact" })
      .eq("organization_id", orgId)
      .gte("sequence", 2)
      .in("source_type_key", ["Renew", "WinBack", "UPSELL", "New"])
      .lt("expected_date", monthStart)
      .or(`actual_date.is.null,and(actual_date.gte.${monthStart},actual_date.lte.${monthEnd})`)
      .or(`lost_date.is.null,lost_date.gte.${monthStart}`),
    supabaseAdmin
      .from("installments")
      .select("actual_amount")
      .eq("organization_id", orgId)
      .gte("actual_date", monthStart)
      .gt("actual_amount", 0),
    // Engine store for the selected month — same source the /contracts dashboard
    // and the sheet show. For a frozen (sheet-imported) month this is the exact
    // sheet value; for a live month it's the engine recompute.
    supabaseAdmin
      .from("monthly_dashboard_totals")
      .select("acc_exp_overdue_inst, sales_exp_overdue_inst")
      .eq("organization_id", orgId)
      .eq("month", monthStart)
      .maybeSingle(),
  ]);

  const sum = (rows: Array<Record<string, unknown>> | null, k: string) =>
    (rows ?? []).reduce((acc, r) => acc + (Number(r[k]) || 0), 0);

  if (renewals.error) console.error("[brief.loadMoney.renewals]", renewals.error.message);
  if (overdueInst.error) console.error("[brief.loadMoney.installments]", overdueInst.error.message);
  if (paid.error) console.error("[brief.loadMoney.paid]", paid.error.message);
  if (monthRow.error) console.error("[brief.loadMoney.monthRow]", monthRow.error.message);

  // Distinct clients behind those overdue installments (the embedded contract
  // carries client_id) — the brief leads with this so the count matches the
  // client list the "overdue payments" drill-down opens.
  const overdueClientIds = new Set<string>();
  for (const r of (overdueInst.data ?? []) as Array<{ contract: { client_id: string | null } | { client_id: string | null }[] | null }>) {
    const c = Array.isArray(r.contract) ? r.contract[0] : r.contract;
    if (c?.client_id) overdueClientIds.add(c.client_id);
  }

  // Headline overdue value: prefer the engine store (matches the sheet &
  // /contracts page exactly); fall back to summing the live rows if no row yet.
  const overdueValue = monthRow.data
    ? Number(monthRow.data.acc_exp_overdue_inst ?? 0) +
      Number(monthRow.data.sales_exp_overdue_inst ?? 0)
    : sum(overdueInst.data, "expected_amount");

  return {
    renew30Count: renewals.count ?? 0,
    renew30Value: sum(renewals.data, "total_value"),
    overdueInstallments: overdueInst.count ?? 0,
    overdueClients: overdueClientIds.size,
    overdueValue,
    paidThisMonth: sum(paid.data, "actual_amount"),
  };
}

// "ريال" instead of "ر.س": satori splits the Arabic run on the dots and
// reorders the fragments, so the abbreviation renders backwards on cards.
export const formatSar = (n: number) =>
  `${Math.round(n).toLocaleString("en-US")} ريال`;

export async function buildCeoBriefData(orgId: string): Promise<CeoBriefData> {
  const [scores, accountability, money] = await Promise.all([
    getExecutiveScores(orgId),
    getAccountabilityOverview(orgId),
    loadMoney(orgId),
  ]);

  const dateLabel = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  // Worst measurable people: enough SLA evidence, lowest score first.
  const people = accountability.rows
    .filter((r) => r.confidence === "high" && r.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 5)
    .map((r) => ({
      name: r.fullName,
      roleLabel: ROLE_LABELS[r.role] ?? r.role,
      score: r.score,
      overdue: r.overdueOwned,
      openTasks: r.openTasks,
    }));

  // accountability.reviewers is now split into two review stages (manager vs
  // specialist — see migration 0196 / two-stage review rigor). Flatten both and
  // dedupe by employee (a person can review at both stages), keeping their
  // higher rework rate, before picking the worst rubber-stampers.
  const reviewerById = new Map<string, (typeof accountability.reviewers.managerReview)[number]>();
  for (const r of [
    ...accountability.reviewers.managerReview,
    ...accountability.reviewers.specialistReview,
  ]) {
    const prev = reviewerById.get(r.employeeId);
    if (!prev || (r.reworkAfterPassRate ?? 0) > (prev.reworkAfterPassRate ?? 0)) {
      reviewerById.set(r.employeeId, r);
    }
  }
  const reviewers = [...reviewerById.values()]
    .filter((r) => r.confidence === "high" && (r.reworkAfterPassRate ?? 0) >= 20)
    .sort((a, b) => (b.reworkAfterPassRate ?? 0) - (a.reworkAfterPassRate ?? 0))
    .slice(0, 3)
    .map((r) => ({
      name: r.fullName,
      reviews: r.reviewsCompleted,
      medianMinutes: r.medianReviewBusinessMinutes,
      reworkPct: r.reworkAfterPassRate,
    }));

  const overdueTotal = accountability.coverage.distinctOverdueTasks;
  const lines = scoreLines(scores);
  const worst = [...lines].sort((a, b) => a.score - b.score)[0];

  const caption = [
    `📊 *الموجز الصباحي — ${dateLabel}*`,
    "",
    `أدنى مؤشر اليوم: *${worst.label} ${worst.score}%* (تقدير ${worst.grade})`,
    `مهام متأخرة قيد التنفيذ: *${overdueTotal}*`,
    `عقود تستحق التجديد خلال ٣٠ يومًا: *${money.renew30Count}* بقيمة *${formatSar(money.renew30Value)}*`,
    `دفعات متأخرة التحصيل: *${money.overdueInstallments}* بقيمة *${formatSar(money.overdueValue)}*`,
    "",
    "التفاصيل في البطاقات المرفقة، ولكل رقم صفحة أدلة داخل لوحة التحكم.",
  ].join("\n");

  return { dateLabel, scores: lines, overdueTotal, people, reviewers, money, caption };
}
