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
  overdueInstallments: number; // still OUTSTANDING (not yet collected) — the to-chase count
  overdueClients: number; // distinct clients behind the outstanding installments
  overdueValue: number; // value still to collect
  overdueCollectedCount: number; // overdue installments already collected this month
  overdueCollectedValue: number; // their value — no longer outstanding
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

  const [renewals, overdueInst, paid] = await Promise.all([
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
    // expected before this month, still open OR collected this month, contract
    // not lost before this month. We pull actual_date so we can split these into
    // still-OUTSTANDING (to chase) vs already-COLLECTED this month: the sheet
    // strikes the collected ones through and moves them to its "Actual paid
    // clients ✅" column, so they are no longer overdue to collect — the card
    // must not lump them in.
    //
    // LIVE-CONTRACT SCOPE (active/hold): the sheet removes lost clients from the
    // overdue bucket by setting col R (installments.lost_date). Our importer only
    // fills lost_date on ~17/168 rows, so relying on it alone leaked overdue
    // installments of already-CLOSED/EXPIRED contracts (Empen, روعة المنزل, غيث…)
    // into the total — inflating it ~2x (77.9k vs the sheet's ~35k). Scoping to a
    // live contract status is the same LIVE-client rule the other CEO danger cards
    // use. See [[project_brief_live_client_scoping]], [[project_contracts_income_model]].
    supabaseAdmin
      .from("installments")
      .select("expected_amount, actual_date, contract:contracts!inner(client_id, status)")
      .eq("organization_id", orgId)
      .in("contract.status", ["active", "hold"])
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
  ]);

  const sum = (rows: Array<Record<string, unknown>> | null, k: string) =>
    (rows ?? []).reduce((acc, r) => acc + (Number(r[k]) || 0), 0);

  if (renewals.error) console.error("[brief.loadMoney.renewals]", renewals.error.message);
  if (overdueInst.error) console.error("[brief.loadMoney.installments]", overdueInst.error.message);
  if (paid.error) console.error("[brief.loadMoney.paid]", paid.error.message);

  // Split the overdue rows into still-outstanding (no actual_date = money still
  // owed) vs collected this month. The card leads with OUTSTANDING — what's still
  // to chase — and reports the collected subset separately, rather than counting
  // already-paid clients as overdue.
  type OvRow = {
    expected_amount: number | string | null;
    actual_date: string | null;
    contract: { client_id: string | null } | { client_id: string | null }[] | null;
  };
  const outstandingClients = new Set<string>();
  let overdueInstallments = 0;
  let overdueValue = 0;
  let overdueCollectedCount = 0;
  let overdueCollectedValue = 0;
  for (const r of (overdueInst.data ?? []) as OvRow[]) {
    const amt = Number(r.expected_amount) || 0;
    if (r.actual_date) {
      overdueCollectedCount += 1;
      overdueCollectedValue += amt;
    } else {
      overdueInstallments += 1;
      overdueValue += amt;
      const c = Array.isArray(r.contract) ? r.contract[0] : r.contract;
      if (c?.client_id) outstandingClients.add(c.client_id);
    }
  }

  return {
    renew30Count: renewals.count ?? 0,
    renew30Value: sum(renewals.data, "total_value"),
    overdueInstallments,
    overdueClients: outstandingClients.size,
    overdueValue,
    overdueCollectedCount,
    overdueCollectedValue,
    paidThisMonth: sum(paid.data, "actual_amount"),
  };
}

// Row-level breakdown of the SAME overdue-installments population loadMoney
// aggregates (identical filter chain — keep the two in lockstep). Powers the
// CEO brief's "show details" evidence modal, so the 22,543-style headline and
// its breakdown can never disagree.
export interface OverdueInstallmentRow {
  contractId: string;
  contractCode: string | null;
  clientName: string;
  amount: number;
  expectedDate: string | null;
  collectedDate: string | null; // non-null → collected this month, not outstanding
}

export async function listOverdueInstallmentRows(
  orgId: string,
): Promise<OverdueInstallmentRow[]> {
  const now = new Date();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("installments")
    .select(
      "expected_amount, expected_date, actual_date, contract:contracts!inner(id, contract_code, status, client:clients(name))",
    )
    .eq("organization_id", orgId)
    .in("contract.status", ["active", "hold"])
    .gte("sequence", 2)
    .in("source_type_key", ["Renew", "WinBack", "UPSELL", "New"])
    .lt("expected_date", monthStart)
    .or(`actual_date.is.null,and(actual_date.gte.${monthStart},actual_date.lte.${monthEnd})`)
    .or(`lost_date.is.null,lost_date.gte.${monthStart}`);
  if (error) throw new Error(`listOverdueInstallmentRows: ${error.message}`);

  type Row = {
    expected_amount: number | string | null;
    expected_date: string | null;
    actual_date: string | null;
    contract:
      | { id: string; contract_code: string | null; client: { name: string } | { name: string }[] | null }
      | { id: string; contract_code: string | null; client: { name: string } | { name: string }[] | null }[]
      | null;
  };
  return ((data ?? []) as Row[])
    .map((r) => {
      const c = Array.isArray(r.contract) ? r.contract[0] : r.contract;
      const client = Array.isArray(c?.client) ? c?.client[0] : c?.client;
      return {
        contractId: c?.id ?? "",
        contractCode: c?.contract_code ?? null,
        clientName: client?.name ?? "—",
        amount: Number(r.expected_amount) || 0,
        expectedDate: r.expected_date,
        collectedDate: r.actual_date,
      };
    })
    .sort((a, b) => b.amount - a.amount);
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
    `دفعات متأخرة التحصيل: *${money.overdueInstallments}* بقيمة *${formatSar(money.overdueValue)}*` +
      (money.overdueCollectedCount > 0
        ? ` _(إضافةً إلى ${money.overdueCollectedCount} محصّلة هذا الشهر)_`
        : ""),
    "",
    "التفاصيل في البطاقات المرفقة، ولكل رقم صفحة أدلة داخل لوحة التحكم.",
  ].join("\n");

  return { dateLabel, scores: lines, overdueTotal, people, reviewers, money, caption };
}
