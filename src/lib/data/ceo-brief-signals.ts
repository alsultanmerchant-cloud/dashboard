import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getExecutiveScores, gradeFor } from "@/lib/data/executive-scores";
import { buildCeoBriefData } from "@/lib/brief/data";
import { getTeamActivityOverview } from "@/lib/data/activity-scores";
import {
  getPulseStats,
  getTopStuckProjects,
  getApprovalBottlenecks,
  getClientHealth,
  getPerformerLeaderboard,
  getServiceLineHealth,
  getWipAging,
} from "@/lib/data/executive";
import { getOrgSatisfactionAggregate, getAtRiskClients } from "@/lib/data/satisfaction";
import { getAiDataQuality, type AiDataQuality } from "@/lib/data/ai-data-quality";

// =========================================================================
// CEO Brief — deterministic signal builder.
//
// The dashboard brief answers three questions: is the company improving or
// worsening (verdict + changes), where is the danger (risks), what to do
// (Gemini turns each risk into an action). EVERY number here is computed from
// existing audited loaders — Gemini never invents figures, it only narrates
// the facts assembled below. See ceo-brief-generate.ts for the AI step.
// =========================================================================

export type Verdict = "improving" | "stable" | "declining";

export interface BriefChange {
  // i18n key under Executive.brief.changes; serviceName fills the {name} slot.
  labelKey: "stability" | "delivery" | "overdue" | "completed" | "onTime" | "service";
  serviceName?: string;
  value: number; // signed magnitude of the change
  unit: "points" | "tasks" | "percent";
  dir: "up" | "down" | "flat";
  good: boolean; // did the business get better on this metric?
}

export type RiskKind =
  | "delivery_slip"
  | "client_churn"
  | "stuck_project"
  | "idle_people"
  | "review_bottleneck"
  | "overdue_money"
  | "at_risk_client"
  | "weak_index";

export interface BriefRisk {
  id: RiskKind;
  title: string; // Arabic — what the risk is
  severity: "critical" | "high" | "medium";
  metric: string; // Arabic — the supporting numbers
  href: string | null; // where the CEO drills into the SPECIFIC evidence (deep link)
  // The concrete entity this risk is about (project/client/employee/task/index
  // key). Drives both the deep link and per-instance dismissal: a dismissal
  // scoped to this entity suppresses only this instance, not the whole kind.
  // Undefined for genuinely agency-wide risks (delivery_slip, overdue_money …).
  entityId?: string;
  weight: number; // internal ranking only (not rendered)
}

export type BriefEventSource = "client_group" | "technical_group" | "system";
export type BriefEventCategory = "complaint" | "approval" | "delay" | "internal" | "decision";
export interface BriefEvent {
  id: string;
  title: string;
  date: string | null;
  source: BriefEventSource;
  category: BriefEventCategory;
  severity: "critical" | "high" | "medium" | "low";
  href: string | null;
}

// Cross-cutting facts (beyond the top risks) that the AI turns into a broad
// action plan — capacity, money, process, people. Prompt-context only; never
// rendered directly, so Arabic labels here are fine.
export interface CeoBriefOpportunities {
  overloaded: number; // specialists carrying well above team-mean load
  underutilized: number; // specialists well below mean (rebalancing room)
  medianActivity: number | null; // team activity median %
  renewalsCount: number; // contracts due to renew in 30d
  renewalsValue: number; // SAR value of those renewals
  reviewBottleneckHours: number | null; // worst review dwell (business hours)
  weakestIndex: { label: string; score: number } | null;
  topPerformer: string | null;
  bottomPerformer: string | null;
}

// Deep connected context — the dashboard surfaces Gemini was previously blind
// to. Prompt-only (drives root-cause headline, interpretations, recommendations);
// never rendered, so Arabic labels are fine.
export interface CeoBriefContext {
  worstServices: Array<{ name: string; onTimePct: number | null; overdue: number; open: number }>;
  bestService: { name: string; onTimePct: number | null } | null;
  intake: { newOpen: number; dwellHours: number; pctOfOpen: number } | null;
  wip: { chronicOverdue: number; freshOverdue: number } | null; // 31-90d vs 0-7d
  satisfaction: {
    avg: number | null;
    briefAdherence: number | null;
    analyzed: number;
    atRisk: number;
    topChurn: Array<{ client: string; score: number | null; risk: string | null }>;
  } | null;
  zeroOnTimePerformers: string[];
  topPerformers: Array<{ name: string; onTimePct: number | null }>;
  bestClients: Array<{ name: string; onTimePct: number | null }>;
  discipline: { staleTasks: number; slaCompliancePct: number | null };
  reworkRate: number; // 0..1 — for "is the process looping?"
}

export interface CeoBriefSignals {
  statusPct: number; // operational stability composite (0-100)
  grade: string; // A..F
  verdict: Verdict;
  changes: BriefChange[];
  risks: BriefRisk[];
  criticalEvents: BriefEvent[];
  timelineEvents: BriefEvent[];
  opportunities: CeoBriefOpportunities;
  context: CeoBriefContext;
  // Which signal families are trustworthy given the current (Odoo-synced) data.
  // The AI generation prompt injects `dataQuality.caveats` so the model never
  // states an unbacked metric (e.g. on-time % with no due dates) as fact.
  dataQuality: AiDataQuality;
}

// ---- helpers -------------------------------------------------------------

// Week-over-week deltas from the nightly snapshot rollup. This is the reliable
// source for "better or worse" — the Odoo-backed hero overdue metric reads 0
// and must NOT be used here (it produced a phantom "-238 overdue" improvement).
interface SnapshotDeltas {
  overdueNow: number;
  overduePrev: number;
  onTimeNow: number | null;
  onTimePrev: number | null;
}

async function loadSnapshotDeltas(orgId: string): Promise<SnapshotDeltas | null> {
  const { data } = await supabaseAdmin
    .from("dashboard_daily_snapshots")
    .select("snapshot_date, overdue_count, on_time_pct_30d")
    .eq("organization_id", orgId)
    .order("snapshot_date", { ascending: false })
    .limit(14);
  const rows = (data ?? []) as Array<{
    snapshot_date: string;
    overdue_count: number;
    on_time_pct_30d: number | null;
  }>;
  if (rows.length === 0) return null;
  const cur = rows[0];
  // ~7 days back; fall back to the oldest row we have.
  const cutoff = new Date(new Date(cur.snapshot_date).getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const prev = rows.find((r) => r.snapshot_date <= cutoff) ?? rows[rows.length - 1];
  return {
    overdueNow: cur.overdue_count,
    overduePrev: prev.overdue_count,
    onTimeNow: cur.on_time_pct_30d,
    onTimePrev: prev.on_time_pct_30d,
  };
}

// Risks the CEO has explicitly dismissed ("this isn't a problem"). A row with a
// null entity_id suppresses the whole kind; a scoped row suppresses only that
// instance, so a genuinely new project/client of the same kind still surfaces.
interface DismissedRisk {
  riskId: string;
  entityId: string | null;
}

async function loadDismissedRisks(orgId: string): Promise<DismissedRisk[]> {
  const { data } = await supabaseAdmin
    .from("ceo_brief_dismissed_risks")
    .select("risk_id, entity_id")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  return ((data ?? []) as Array<{ risk_id: string; entity_id: string | null }>).map((r) => ({
    riskId: r.risk_id,
    entityId: r.entity_id,
  }));
}

function isDismissed(risk: BriefRisk, dismissed: DismissedRisk[]): boolean {
  return dismissed.some(
    (d) => d.riskId === risk.id && (d.entityId == null || d.entityId === risk.entityId),
  );
}

function computeVerdict(
  snap: SnapshotDeltas | null,
  completedShift: number,
  stabilityScore: number,
): Verdict {
  let net = 0;
  let evidence = 0;
  if (snap) {
    if (snap.onTimeNow != null && snap.onTimePrev != null) {
      net += snap.onTimeNow - snap.onTimePrev; // percentage-point swing, direct weight
      evidence += 1;
    }
    // Overdue rising is bad; cap influence so a noisy count can't dominate.
    const overdueImproved = snap.overduePrev - snap.overdueNow; // positive = fewer overdue
    net += Math.max(-6, Math.min(6, overdueImproved * 0.5));
    evidence += 1;
  }
  net += Math.max(-4, Math.min(4, completedShift * 0.05));
  if (completedShift !== 0) evidence += 1;

  if (evidence === 0) return "stable";
  let v: Verdict = net >= 3 ? "improving" : net <= -3 ? "declining" : "stable";
  // Guard: a D/F operation can't read "improving" off one noisy week.
  if (v === "improving" && stabilityScore < 55) v = "stable";
  return v;
}

function parseEventTime(date: string | null): number {
  if (!date) return 0;
  const ts = new Date(date).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function eventCategoryFromHighlight(
  type: string,
  text: string,
  audience: string | null,
): BriefEventCategory {
  const body = text.toLowerCase();
  if (audience === "team") return "internal";
  if (type === "complaint" || type === "escalation") return "complaint";
  if (type === "milestone" || /اعتماد|اعتمد|وافق|موافقة|approved|approval/.test(body)) return "approval";
  if (/تأخير|متأخر|اتأخر|تأخر|delay|late|deadline|موعد/.test(body)) return "delay";
  if (/قرار|تقرر|قرر|decided|decision/.test(body)) return "decision";
  return "decision";
}

function eventCategoryFromRisk(id: RiskKind): BriefEventCategory {
  if (id === "client_churn" || id === "at_risk_client") return "complaint";
  if (id === "idle_people" || id === "review_bottleneck") return "internal";
  return "delay";
}

function riskToEvent(risk: BriefRisk, index: number, date: string): BriefEvent {
  return {
    id: `risk-${risk.id}-${index}`,
    title: risk.title,
    date,
    source: "system",
    category: eventCategoryFromRisk(risk.id),
    severity: risk.severity,
    href: risk.href,
  };
}

async function loadBriefTimelineEvents(
  orgId: string,
  risks: BriefRisk[],
  runDate: string,
): Promise<{ criticalEvents: BriefEvent[]; timelineEvents: BriefEvent[] }> {
  const [analysisRes, tasksRes] = await Promise.all([
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select("id, client_id, created_at, highlights, risks, satisfaction_score, sentiment, client:clients!inner(name)")
      .eq("organization_id", orgId)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(40),
    supabaseAdmin
      .from("tasks")
      .select(
        "id, task_code, title, delay_days, due_date, stage_entered_at, project:projects!inner(id, name, project_code, status, client:clients!inner(name))",
      )
      .eq("organization_id", orgId)
      .eq("is_overdue", true)
      .is("archived_at", null)
      .neq("project.status", "archived")
      .order("delay_days", { ascending: false, nullsFirst: false })
      .limit(25),
  ]);

  const events: BriefEvent[] = [];

  type Highlight = {
    type?: string;
    audience?: string | null;
    text?: string;
    date?: string | null;
  };
  type AnalysisRow = {
    id: string;
    client_id: string;
    created_at: string;
    highlights: Highlight[] | null;
    risks: string[] | null;
    satisfaction_score: number | null;
    sentiment: string | null;
    client: { name: string } | { name: string }[] | null;
  };
  for (const row of (analysisRes.data ?? []) as unknown as AnalysisRow[]) {
    const client = Array.isArray(row.client) ? row.client[0] : row.client;
    const clientName = client?.name ?? "—";
    for (const [i, highlight] of (row.highlights ?? []).entries()) {
      const text = (highlight.text ?? "").trim();
      if (!text) continue;
      const type = highlight.type ?? "request";
      const audience = highlight.audience ?? "client";
      const category = eventCategoryFromHighlight(type, text, audience);
      const severity =
        type === "escalation"
          ? "critical"
          : type === "complaint"
            ? "high"
            : category === "internal" || category === "delay"
              ? "medium"
              : "low";
      events.push({
        id: `sat-${row.id}-${i}`,
        title: `${clientName}: ${text}`,
        date: highlight.date ?? row.created_at,
        source: audience === "team" ? "technical_group" : "client_group",
        category,
        severity,
        href: `/satisfaction?client=${row.client_id}`,
      });
    }

    if (
      (row.sentiment === "negative" || (row.satisfaction_score ?? 100) < 55) &&
      row.risks &&
      row.risks.length > 0
    ) {
      events.push({
        id: `sat-risk-${row.id}`,
        title: `${clientName}: ${row.risks[0]}`,
        date: row.created_at,
        source: "client_group",
        category: "complaint",
        severity: row.sentiment === "negative" ? "high" : "medium",
        href: `/satisfaction?client=${row.client_id}`,
      });
    }
  }

  type TaskRow = {
    id: string;
    task_code: string | null;
    title: string | null;
    delay_days: number | null;
    due_date: string | null;
    stage_entered_at: string | null;
    project:
      | {
          id: string;
          name: string;
          project_code: string | null;
          client: { name: string } | { name: string }[] | null;
        }
      | {
          id: string;
          name: string;
          project_code: string | null;
          client: { name: string } | { name: string }[] | null;
        }[]
      | null;
  };
  for (const row of (tasksRes.data ?? []) as unknown as TaskRow[]) {
    const project = Array.isArray(row.project) ? row.project[0] : row.project;
    const client = Array.isArray(project?.client) ? project?.client[0] : project?.client;
    const delay = row.delay_days ?? 0;
    const taskLabel = [row.task_code, row.title].filter(Boolean).join(" · ");
    events.push({
      id: `task-${row.id}`,
      title: `${client?.name ?? "—"}: ${taskLabel || "مهمة متأخرة"}${delay > 0 ? ` (${delay} يوم)` : ""}`,
      date: row.due_date ?? row.stage_entered_at ?? runDate,
      source: "system",
      category: "delay",
      severity: delay >= 7 ? "critical" : delay >= 3 ? "high" : "medium",
      href: `/tasks/${row.id}`,
    });
  }

  for (const [index, risk] of risks.entries()) {
    events.push(riskToEvent(risk, index, runDate));
  }

  const timelineEvents = events
    .sort((a, b) => parseEventTime(b.date) - parseEventTime(a.date))
    .slice(0, 80);
  const criticalEvents = timelineEvents
    .filter((event) => event.severity === "critical" || event.severity === "high")
    .slice(0, 10);

  return { criticalEvents, timelineEvents };
}

// ---- main ----------------------------------------------------------------

export async function buildCeoBriefSignals(orgId: string): Promise<CeoBriefSignals> {
  const [
    scores,
    briefData,
    pulse,
    stuck,
    bottlenecks,
    clientHealth,
    activity,
    performers,
    snap,
    services,
    wip,
    satAgg,
    satRisk,
    dismissed,
    dataQuality,
  ] = await Promise.all([
    getExecutiveScores(orgId),
    buildCeoBriefData(orgId),
    getPulseStats(orgId),
    getTopStuckProjects(orgId),
    getApprovalBottlenecks(orgId),
    getClientHealth(orgId),
    getTeamActivityOverview(orgId),
    getPerformerLeaderboard(orgId),
    loadSnapshotDeltas(orgId),
    getServiceLineHealth(orgId),
    getWipAging(orgId),
    getOrgSatisfactionAggregate(orgId).catch(() => null),
    getAtRiskClients(orgId).catch(() => []),
    loadDismissedRisks(orgId),
    getAiDataQuality(orgId),
  ]);

  const statusPct = Math.round(scores.stability.score);
  const grade = gradeFor(scores.stability.score);

  const completedShift = pulse.completed.current - pulse.completed.previous;
  const verdict = computeVerdict(snap, completedShift, scores.stability.score);

  // ── Changes (evidence for "better or worse") ───────────────────────────
  // All snapshot-backed and reliable. Service-line deltas are intentionally
  // excluded — the "services" taxonomy is per-package (Account Manager, Renewal
  // …) and noisy; service trends live in the detailed Service Health section.
  const changes: BriefChange[] = [];

  if (snap && snap.onTimeNow != null && snap.onTimePrev != null) {
    const d = Math.round(snap.onTimeNow - snap.onTimePrev);
    if (d !== 0)
      changes.push({
        labelKey: "onTime",
        value: d,
        unit: "points",
        dir: d > 0 ? "up" : "down",
        good: d > 0,
      });
  }
  if (snap) {
    const od = snap.overdueNow - snap.overduePrev;
    if (od !== 0)
      changes.push({
        labelKey: "overdue",
        value: od,
        unit: "tasks",
        dir: od > 0 ? "up" : "down",
        good: od < 0, // fewer overdue is better
      });
  }
  if (scores.stability.delta != null && scores.stability.delta !== 0) {
    changes.push({
      labelKey: "stability",
      value: scores.stability.delta,
      unit: "points",
      dir: scores.stability.delta > 0 ? "up" : "down",
      good: scores.stability.delta > 0,
    });
  }
  if (completedShift !== 0) {
    changes.push({
      labelKey: "completed",
      value: completedShift,
      unit: "tasks",
      dir: completedShift > 0 ? "up" : "down",
      good: completedShift > 0,
    });
  }

  // ── Risks (where is the danger), ranked by weight ──────────────────────
  const risks: BriefRisk[] = [];

  // Agency-wide delivery slip — the systemic signal. Uses the real overdue load
  // (from tasks, via executive-scores) + the snapshot on-time trend. This is the
  // risk that was previously invisible because the hero overdue metric read 0.
  const overdueCount = scores.delivery.overdueCount;
  const lateProjects = scores.delivery.lateProjects;
  const onTimePct = scores.delivery.onTimePct;
  const onTimeDrop =
    snap && snap.onTimeNow != null && snap.onTimePrev != null
      ? Math.round(snap.onTimePrev - snap.onTimeNow) // positive = declined
      : null;
  if (overdueCount >= 20 || (onTimeDrop != null && onTimeDrop >= 5)) {
    const esc = scores.stability.unackEscalations;
    const parts = [`${overdueCount} مهمة متأخرة في ${lateProjects} مشروع`];
    // On-time % and the weekly trend are snapshot/due-date derived — only quote
    // them when the data actually backs them, else they read as confident noise.
    if (onTimePct != null && dataQuality.onTimePct.level !== "missing")
      parts.push(`الالتزام ${Math.round(onTimePct)}%`);
    if (onTimeDrop != null && onTimeDrop > 0 && dataQuality.weekOverWeek.level === "reliable")
      parts.push(`متراجع ${onTimeDrop} نقطة هذا الأسبوع`);
    if (esc > 0) parts.push(`${esc} تصعيد غير معالَج`);
    risks.push({
      id: "delivery_slip",
      title: "تراجع الالتزام بالتسليم على مستوى الوكالة",
      severity:
        (onTimePct != null && onTimePct < 50) || overdueCount >= 150 ? "critical" : "high",
      metric: parts.join(" · "),
      href: "/tasks?view=list&filter=overdue",
      weight: overdueCount * 0.5 + lateProjects * 2 + (onTimeDrop ?? 0),
    });
  }

  // NOTE: the "intake bottleneck" risk (large/slow «new» stage) was removed on
  // the team's instruction (2026-06-17). The «new» stage backlog is an Odoo
  // import artifact — hundreds of tasks parked in "new" is a data-shape quirk,
  // not a real operational signal — so reporting it as a top danger was noise.
  // Do NOT reintroduce it without confirming the stage data is genuine.

  // Client churn — the satisfaction layer (imported WhatsApp chats, AI-scored).
  // This is the commercial risk the brief was previously blind to.
  if (satAgg && satAgg.atRiskClients >= 3) {
    const top = satRisk.slice(0, 3).map((c) => c.clientName).filter(Boolean).join("، ");
    const avg = satAgg.avgSatisfaction;
    const parts = [`${satAgg.atRiskClients} من ${satAgg.analyzedClients} عميلًا معرّضون للفقد`];
    if (avg != null) parts.push(`متوسط الرضا ${avg}/100`);
    if (top) parts.push(`أبرزهم: ${top}`);
    // Deep-link straight to the single worst at-risk client (the concrete
    // evidence) rather than the whole satisfaction page; scope dismissal to it.
    const worstChurn = satRisk[0];
    risks.push({
      id: "client_churn",
      title: "خطر فقدان عملاء",
      severity: satAgg.atRiskClients >= 10 || (avg != null && avg < 50) ? "critical" : "high",
      metric: parts.join(" · "),
      href: worstChurn?.clientId ? `/satisfaction?client=${worstChurn.clientId}` : "/satisfaction",
      entityId: worstChurn?.clientId,
      weight: 40 + satAgg.atRiskClients * 3,
    });
  }

  const topStuck = stuck[0];
  if (topStuck && (topStuck.overdueTasks > 0 || topStuck.worstSlipPercent >= 20)) {
    const slip = Math.round(topStuck.worstSlipPercent);
    const severity =
      slip >= 50 || topStuck.overdueTasks >= 5
        ? "critical"
        : slip >= 20 || topStuck.overdueTasks >= 2
          ? "high"
          : "medium";
    const idleDays = topStuck.daysSinceActivity ?? 0;
    const idle = idleDays > 0 ? ` · ${idleDays} يوم بلا نشاط` : "";
    const client = topStuck.clientName ? ` · ${topStuck.clientName}` : "";
    risks.push({
      id: "stuck_project",
      title: `مشروع ${topStuck.projectName} متعثّر`,
      severity,
      metric: `${topStuck.overdueTasks} متأخرة من ${topStuck.openTasks} مفتوحة · انزلاق ${slip}%${idle}${client}`,
      href: `/tasks?view=list&projectId=${topStuck.projectId}&filter=overdue`,
      entityId: topStuck.projectId,
      weight: topStuck.overdueTasks * 3 + slip,
    });
  }

  // Genuinely idle only — NOT noDutyCount (that's an assignment/instrumentation
  // gap: e.g. 92 of 99 staff simply have no owned task episodes tracked, which
  // is not the same as being inactive and must not be reported as a risk).
  const idlePeople = activity.counts.idle;
  if (idlePeople >= 1) {
    // Deep-link to the single idle person when there's exactly one; otherwise the
    // accountability board (the aggregate) is the right landing for several.
    const idleRows = activity.rows.filter((r) => r.status === "idle");
    const soleIdle = idleRows.length === 1 ? idleRows[0] : null;
    risks.push({
      id: "idle_people",
      title: "موظفون خاملون",
      severity: idlePeople >= 3 ? "high" : "medium",
      metric: `${idlePeople} موظف بلا نشاط رغم وجود مهام مُسندة`,
      href: soleIdle ? `/accountability?emp=${soleIdle.employeeId}` : "/accountability",
      weight: 10 + idlePeople * 4,
    });
  }

  const topBottleneck = bottlenecks[0];
  if (topBottleneck && topBottleneck.businessHoursInStage >= 16) {
    const hrs = Math.round(topBottleneck.businessHoursInStage);
    risks.push({
      id: "review_bottleneck",
      title: "اختناق في مرحلة المراجعة",
      severity: hrs >= 48 ? "high" : "medium",
      metric: `«${topBottleneck.title}» عالقة ${hrs} ساعة عمل في ${topBottleneck.stage} · ${topBottleneck.projectName}`,
      href: `/tasks/${topBottleneck.taskId}`,
      entityId: topBottleneck.taskId,
      weight: 8 + Math.min(40, hrs / 2),
    });
  }

  if (briefData.money.overdueInstallments > 0) {
    const val = Math.round(briefData.money.overdueValue);
    risks.push({
      id: "overdue_money",
      title: "دفعات متأخرة التحصيل",
      severity: val >= 50000 ? "critical" : val >= 10000 ? "high" : "medium",
      metric: `${briefData.money.overdueInstallments} دفعة بقيمة ${val.toLocaleString("en-US")} ريال`,
      href: "/contracts?view=table&target=Overdue",
      weight: 50 + Math.min(60, val / 3000),
    });
  }

  // Driven by overdue load (reliable). On-time % only shown when backed by a
  // real sample (≥3 deliveries) — a "0%" from a single delivery is noise.
  const worstClient = clientHealth.worst[0];
  if (worstClient && worstClient.overdueTaskCount >= 3) {
    const ot = worstClient.onTimePct30d;
    const showOt = ot != null && worstClient.deliveredCount30d >= 3;
    risks.push({
      id: "at_risk_client",
      title: `العميل ${worstClient.clientName} في منطقة الخطر`,
      severity: worstClient.overdueTaskCount >= 10 ? "high" : "medium",
      metric: `${showOt ? `التزام ${ot}% · ` : ""}${worstClient.overdueTaskCount} مهمة متأخرة`,
      href: `/satisfaction?client=${worstClient.clientId}`,
      entityId: worstClient.clientId,
      weight: 9 + worstClient.overdueTaskCount * 2 + (showOt ? (100 - ot) / 5 : 0),
    });
  }

  // Weakest composite index, only if genuinely weak and not already implied.
  const worstLine = [...briefData.scores].sort((a, b) => a.score - b.score)[0];
  if (worstLine && worstLine.score < 55) {
    risks.push({
      id: "weak_index",
      title: `ضعف في مؤشر ${worstLine.label}`,
      severity: worstLine.score < 40 ? "high" : "medium",
      metric: `المؤشر عند ${worstLine.score}% (تقدير ${worstLine.grade})`,
      // The composite indices break down in /reports — link there, not back to
      // the dashboard the CEO is already looking at.
      href: "/reports",
      entityId: worstLine.label,
      weight: 6 + (55 - worstLine.score) / 3,
    });
  }

  // Drop anything the CEO has explicitly dismissed ("this isn't a problem").
  const activeRisks = risks.filter((r) => !isDismissed(r, dismissed));
  activeRisks.sort((a, b) => b.weight - a.weight);

  // ── Opportunities — cross-cutting facts for a broad action plan ─────────
  const opportunities: CeoBriefOpportunities = {
    overloaded: scores.productivity.overloaded,
    underutilized: scores.productivity.underutilized,
    medianActivity: activity.median,
    renewalsCount: briefData.money.renew30Count,
    renewalsValue: briefData.money.renew30Value,
    reviewBottleneckHours: bottlenecks[0]
      ? Math.round(bottlenecks[0].businessHoursInStage)
      : null,
    weakestIndex: worstLine ? { label: worstLine.label, score: worstLine.score } : null,
    topPerformer: performers.top[0]?.fullName ?? null,
    bottomPerformer: performers.bottom[0]?.fullName ?? null,
  };

  // ── Deep connected context (root-cause material for the AI) ─────────────
  const ranked = [...services].sort(
    (a, b) => (a.onTimePct30d ?? 101) - (b.onTimePct30d ?? 101),
  );
  const bestSvc = [...services]
    .filter((s) => s.onTimePct30d != null && s.delivered30d >= 5)
    .sort((a, b) => (b.onTimePct30d ?? 0) - (a.onTimePct30d ?? 0))[0];
  const wipChronic = wip.find((w) => w.bucket === "31-90")?.overdueCount ?? 0;
  const wipFresh = wip.find((w) => w.bucket === "0-7")?.overdueCount ?? 0;

  const context: CeoBriefContext = {
    worstServices: ranked
      .filter((s) => s.delivered30d >= 5)
      .slice(0, 3)
      .map((s) => ({
        name: s.name,
        onTimePct: s.onTimePct30d,
        overdue: s.overdueCount,
        open: s.openCount,
      })),
    bestService: bestSvc ? { name: bestSvc.name, onTimePct: bestSvc.onTimePct30d } : null,
    // Intake/«new» stage intentionally not surfaced — see the removed risk above.
    intake: null,
    wip: { chronicOverdue: wipChronic, freshOverdue: wipFresh },
    satisfaction: satAgg
      ? {
          avg: satAgg.avgSatisfaction,
          briefAdherence: satAgg.avgBriefAdherence,
          analyzed: satAgg.analyzedClients,
          atRisk: satAgg.atRiskClients,
          topChurn: satRisk.slice(0, 5).map((c) => ({
            client: c.clientName,
            score: c.satisfactionScore,
            risk: c.topRisk,
          })),
        }
      : null,
    zeroOnTimePerformers: performers.bottom
      .filter((p) => p.onTimePct === 0 && p.delivered30d >= 3)
      .map((p) => p.fullName),
    topPerformers: performers.top.slice(0, 3).map((p) => ({
      name: p.fullName,
      onTimePct: p.onTimePct,
    })),
    bestClients: clientHealth.best.slice(0, 3).map((c) => ({
      name: c.clientName,
      onTimePct: c.onTimePct30d,
    })),
    discipline: {
      staleTasks: scores.discipline.staleTasks,
      slaCompliancePct: scores.discipline.slaCompliancePct,
    },
    reworkRate: scores.quality.reworkRate,
  };

  const eventPack = await loadBriefTimelineEvents(orgId, activeRisks.slice(0, 5), new Date().toISOString());

  return {
    statusPct,
    grade,
    verdict,
    changes: changes.slice(0, 5),
    risks: activeRisks.slice(0, 5),
    criticalEvents: eventPack.criticalEvents,
    timelineEvents: eventPack.timelineEvents,
    opportunities,
    context,
    dataQuality,
  };
}
