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
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [renewals, overdueInst, paid] = await Promise.all([
    supabaseAdmin
      .from("contracts")
      .select("total_value", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", horizon),
    supabaseAdmin
      .from("installments")
      .select("expected_amount", { count: "exact" })
      .eq("organization_id", orgId)
      .lt("expected_date", today)
      .or("actual_amount.is.null,actual_amount.eq.0"),
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

  return {
    renew30Count: renewals.count ?? 0,
    renew30Value: sum(renewals.data, "total_value"),
    overdueInstallments: overdueInst.count ?? 0,
    overdueValue: sum(overdueInst.data, "expected_amount"),
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
