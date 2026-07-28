import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getExecutiveScores, gradeFor } from "@/lib/data/executive-scores";
import { buildCeoBriefData } from "@/lib/brief/data";
import { getTeamActivityOverview } from "@/lib/data/activity-scores";
import {
  getPulseStats,
  getApprovalBottlenecks,
  getClientHealth,
  getPerformerLeaderboard,
  getServiceLineHealth,
  getWipAging,
  getDepartmentCapacity,
  type DepartmentCapacityRow,
} from "@/lib/data/executive";
import { getSatisfactionRows, getAtRiskClients, isClientAtRisk } from "@/lib/data/satisfaction";
import { getAiDataQuality, type AiDataQuality } from "@/lib/data/ai-data-quality";
import {
  listDashboardMonths,
  refreshMonthlyDashboard,
  getMonthlyDashboard,
} from "@/lib/data/contracts";
import { SLA_STAGES } from "@/lib/data/sla";
import { riyadhDaysAgoIso } from "@/lib/tz";

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
  labelKey:
    | "stability"
    | "delivery"
    | "overdue"
    | "completed"
    | "onTime"
    | "delaysCleared"
    | "service";
  serviceName?: string;
  value: number; // signed magnitude of the change
  unit: "points" | "tasks" | "percent";
  dir: "up" | "down" | "flat";
  good: boolean; // did the business get better on this metric?
  // The before→after numbers that produced `value`, plus where the CEO can drill
  // into the underlying records. Drives the "why is this changing?" popover on
  // each pill — no AI, just the snapshot facts behind the delta.
  detail?: {
    from: number; // previous-period value
    to: number; // current-period value
    href?: string; // deep link into the records behind this metric
    // For window-based delivery ratios (on-time, delays-cleared): the raw
    // "num of den" counts behind each side, so the popover can show both the
    // task count AND the percentage the team asked for.
    sample?: {
      current: { num: number; den: number };
      previous: { num: number; den: number };
    };
  };
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
  renewalsCount: number; // renewal-pipeline clients this month (On-Target + Overdue)
  renewalsValue: number; // SAR expected renewal income (= /contracts expected_renewals)
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
  supportRiskPerformers: Array<{ name: string; open: number; overdue: number; stale: number }>;
  topPerformers: Array<{ name: string; onTimePct: number | null }>;
  bestClients: Array<{ name: string; onTimePct: number | null }>;
  discipline: { staleTasks: number; slaCompliancePct: number | null };
  reworkRate: number; // 0..1 — for "is the process looping?"
  // The brief's ONE definition of متأخرة: tasks currently over their stage SLA.
  slaLate: {
    taskCount: number;
    projectCount: number;
    newToday: number;
    topProjects: Array<{ project: string; client: string | null; lateCount: number }>;
  };
  // Per-DEPARTMENT load imbalance so the action plan only ever proposes
  // SAME-department task rebalancing (a Social-Media task can't go to SEO).
  departmentCapacity: DepartmentCapacityRow[];
}

// ---- Adaptive emphasis (code-computed, NEVER the model) ------------------
// A deterministic "where to look first" hint derived purely from the ranked
// risks + verdict. The card reacts to it (a focus chip + a spotlighted hero
// risk) so the brief FEELS adaptive month-to-month, while the model has zero
// say over what is emphasised — layout authority stays in code. See
// [[project_ceo_brief_generative_ui]].
export type BriefLayout = "standard" | "risk-first" | "money-first" | "people-first";
export type BriefFocus = "delivery" | "money" | "people" | "clients" | "stable";
export interface BriefEmphasis {
  layout: BriefLayout;
  focus: BriefFocus;
  heroRiskId: RiskKind | null; // the single risk to spotlight (critical/high only)
}

// Map the top-ranked risk kind → the area the CEO should focus on.
function focusForRisk(kind: RiskKind): { layout: BriefLayout; focus: BriefFocus } {
  switch (kind) {
    case "overdue_money":
      return { layout: "money-first", focus: "money" };
    case "client_churn":
    case "at_risk_client":
      return { layout: "risk-first", focus: "clients" };
    case "idle_people":
    case "review_bottleneck":
      return { layout: "people-first", focus: "people" };
    case "delivery_slip":
    case "stuck_project":
    case "weak_index":
    default:
      return { layout: "risk-first", focus: "delivery" };
  }
}

// Pure: the ranked risks (severity-sorted) + verdict → emphasis. The top risk
// drives the focus; it is only spotlighted as "hero" when critical/high (a
// medium risk shouldn't hijack the layout).
export function computeEmphasis(risks: BriefRisk[], verdict: Verdict): BriefEmphasis {
  const top = risks[0];
  if (!top) {
    return { layout: "standard", focus: verdict === "declining" ? "delivery" : "stable", heroRiskId: null };
  }
  const { layout, focus } = focusForRisk(top.id);
  return {
    layout,
    focus,
    heroRiskId: top.severity === "critical" || top.severity === "high" ? top.id : null,
  };
}

export interface CeoBriefSignals {
  statusPct: number; // operational stability composite (0-100)
  grade: string; // A..F
  verdict: Verdict;
  emphasis: BriefEmphasis; // code-computed focus/hero hint (no model input)
  changes: BriefChange[];
  risks: BriefRisk[];
  today: BriefTodayItem[]; // «الجديد اليوم» — code-computed secretary digest
  criticalEvents: BriefEvent[];
  timelineEvents: BriefEvent[];
  opportunities: CeoBriefOpportunities;
  context: CeoBriefContext;
  // Which signal families are trustworthy given the current (Odoo-synced) data.
  // The AI generation prompt injects `dataQuality.caveats` so the model never
  // states an unbacked metric (e.g. on-time % with no due dates) as fact.
  dataQuality: AiDataQuality;
}

// ---- "متأخرة" = stage-SLA breach ----------------------------------------
// The dashboard carries TWO meanings of "overdue": the task passed its delivery
// deadline (planned_date), and the task has been sitting in its current stage
// longer than that stage's SLA (sla_rules, per the templates). The team decided
// the BRIEF speaks the SLA meaning — it's the actionable "who is sitting on
// what right now" signal — so every risk/event below that says متأخرة reads
// from this loader, never from planned_date. See [[late-metric-scoping]].

export const SLA_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  SLA_STAGES.map((s) => [s.key, s.label]),
);

// One working day in business minutes — used to approximate "breached since
// yesterday" (excess over the limit still under a day's worth of work time).
const BUSINESS_MINUTES_PER_DAY = 480;

export interface BriefSlaLate {
  taskCount: number;
  projectCount: number;
  newToday: number; // breaches younger than ~1 working day
  topProjects: Array<{
    projectId: string;
    projectName: string;
    clientId: string | null;
    clientName: string | null;
    lateCount: number;
    openCount: number;
  }>;
  topClients: Array<{ clientId: string; clientName: string; lateCount: number }>;
  worstTasks: Array<{
    taskId: string;
    title: string;
    taskCode: string | null;
    stage: string;
    clientName: string | null;
    excessMinutes: number;
  }>;
}

const EMPTY_SLA_LATE: BriefSlaLate = {
  taskCount: 0,
  projectCount: 0,
  newToday: 0,
  topProjects: [],
  topClients: [],
  worstTasks: [],
};

// agent_run_readonly_sql (0126): single SELECT/WITH, no semicolons, and a
// word-boundary blocklist of write/DDL keywords that matches even inside
// comments and aliases — keep those words out of the SQL text entirely.
async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`brief sla-late query failed: ${error.message}`);
  return (data ?? []) as T[];
}

export interface SlaLateSqlRow {
  task_id: string;
  title: string | null;
  task_code: string | null;
  stage: string;
  excess_min: number;
  project_id: string;
  project_name: string;
  client_id: string | null;
  client_name: string | null;
  open_count: number;
}

// The one query behind every SLA-late number in the brief. Exported so the
// evidence API (the "show details" modal) lists the EXACT rows this loader
// aggregated — the headline count and its breakdown can never disagree.
//
// Sourced from task_stage_history's OPEN intervals (the task's current stage),
// preferring the precomputed dwell cache but FALLING BACK to computing the
// business minutes live when the cache row is missing: the hourly Odoo sync
// rewrites history delete-then-insert, which cascade-drops dwell rows until
// the next */10 refresh — reading the cache alone made every SLA-late number
// transiently collapse to 0 right after a sync (observed live 11:30). The
// fallback fires only for the few uncached open SLA-stage rows, so the slow
// plpgsql helper runs at most a few dozen times.
export async function querySlaLateRows(
  orgId: string,
  opts: { projectId?: string; clientId?: string } = {},
): Promise<SlaLateSqlRow[]> {
  const uuidRe = /^[0-9a-f-]{36}$/i;
  const scope = [
    opts.projectId && uuidRe.test(opts.projectId) ? `and t.project_id = '${opts.projectId}'` : "",
    opts.clientId && uuidRe.test(opts.clientId) ? `and p.client_id = '${opts.clientId}'` : "",
  ]
    .filter(Boolean)
    .join("\n     ");
  const sql = `
with open_sla as (
  select h.task_id, h.to_stage::text as stage,
         coalesce(
           d.dwell_business_minutes,
           public.business_minutes_between(h.entered_at, now())::int
         ) as dwell_min,
         r.max_minutes
    from task_stage_history h
    join sla_rules r on r.organization_id = h.organization_id and r.stage_key = h.to_stage::text
    left join task_stage_dwell d on d.history_id = h.id
   where h.organization_id = '${orgId}'
     and h.exited_at is null
), late as (
  select o.task_id, o.stage,
         (o.dwell_min - o.max_minutes)::int as excess_min,
         t.title, t.task_code, t.project_id,
         p.name as project_name, p.client_id, c.name as client_name
    from open_sla o
    join tasks t on t.id = o.task_id
    join projects p on p.id = t.project_id
    left join clients c on c.id = p.client_id
   where o.dwell_min > o.max_minutes
     and t.archived_at is null
     and t.stage <> 'done'
     and p.status <> 'archived'
     ${scope}
), open_counts as (
  select t.project_id, count(*)::int as open_count
    from tasks t
   where t.organization_id = '${orgId}'
     and t.archived_at is null
     and t.stage <> 'done'
     and t.project_id in (select distinct project_id from late)
   group by t.project_id
)
select l.task_id, l.title, l.task_code, l.stage, l.excess_min,
       l.project_id, l.project_name, l.client_id, l.client_name,
       oc.open_count
  from late l
  join open_counts oc on oc.project_id = l.project_id
 order by l.excess_min desc
 limit 500`;
  return runSql<SlaLateSqlRow>(sql);
}

async function loadSlaLate(orgId: string): Promise<BriefSlaLate> {

  // Even though buildCeoBriefSignals runs this loader before its parallel
  // burst, other surfaces (Team Pulse refresh, accountability cache crons) can
  // still contend it past the RPC's 12s statement timeout — it runs in ~2s
  // alone. One delayed retry lands after the burst has drained.
  let rows: SlaLateSqlRow[];
  try {
    rows = await querySlaLateRows(orgId);
  } catch {
    try {
      await new Promise((r) => setTimeout(r, 5000));
      rows = await querySlaLateRows(orgId);
    } catch (e) {
      console.error("[ceo-brief-signals] loadSlaLate failed (after retry):", e);
      return EMPTY_SLA_LATE;
    }
  }
  if (rows.length === 0) return EMPTY_SLA_LATE;

  const byProject = new Map<string, BriefSlaLate["topProjects"][number]>();
  const byClient = new Map<string, { clientId: string; clientName: string; lateCount: number }>();
  for (const r of rows) {
    const p = byProject.get(r.project_id) ?? {
      projectId: r.project_id,
      projectName: r.project_name,
      clientId: r.client_id,
      clientName: r.client_name,
      lateCount: 0,
      openCount: r.open_count,
    };
    p.lateCount += 1;
    byProject.set(r.project_id, p);
    if (r.client_id) {
      const c = byClient.get(r.client_id) ?? {
        clientId: r.client_id,
        clientName: r.client_name ?? "—",
        lateCount: 0,
      };
      c.lateCount += 1;
      byClient.set(r.client_id, c);
    }
  }

  return {
    taskCount: rows.length,
    projectCount: byProject.size,
    newToday: rows.filter((r) => r.excess_min <= BUSINESS_MINUTES_PER_DAY).length,
    topProjects: [...byProject.values()].sort((a, b) => b.lateCount - a.lateCount).slice(0, 3),
    topClients: [...byClient.values()].sort((a, b) => b.lateCount - a.lateCount).slice(0, 3),
    worstTasks: rows.slice(0, 25).map((r) => ({
      taskId: r.task_id,
      title: r.title ?? "مهمة",
      taskCode: r.task_code,
      stage: r.stage,
      clientName: r.client_name,
      excessMinutes: r.excess_min,
    })),
  };
}

// ---- «الجديد اليوم» — the secretary digest -------------------------------
// Code-computed, newsy facts since yesterday: what got done, what newly broke
// its stage SLA, what arrived from clients, what money moved. Rendered
// verbatim by the card (no AI wording) with a deep link per item.

export interface BriefTodayItem {
  id: string;
  text: string; // Arabic, code-built — same convention as risk titles/metrics
  href: string | null;
  tone: "good" | "bad" | "info";
}

async function loadTodayCounts(orgId: string): Promise<{
  doneSinceYesterday: number;
  collectedSinceYesterday: { count: number; value: number };
}> {
  const yesterday = riyadhDaysAgoIso(1);
  const [doneRes, paidRes] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("stage", "done")
      .is("archived_at", null)
      .gte("actual_done_date", yesterday),
    supabaseAdmin
      .from("installments")
      .select("actual_amount")
      .eq("organization_id", orgId)
      .gte("actual_date", yesterday)
      .gt("actual_amount", 0),
  ]);
  const paid = (paidRes.data ?? []) as Array<{ actual_amount: number | string | null }>;
  return {
    doneSinceYesterday: doneRes.count ?? 0,
    collectedSinceYesterday: {
      count: paid.length,
      value: paid.reduce((acc, r) => acc + (Number(r.actual_amount) || 0), 0),
    },
  };
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

// Live 7-day delivery window straight from the tasks table (not the 30-day
// snapshot). The team wants the Q1 "on-time" pill to answer: of the tasks DUE in
// the last 7 days, how many were delivered on time — count + pct, vs the prior 7
// days. The same pass yields "delays cleared" (of the tasks that went late this
// week, how many were eventually finished). planned_date is the real deadline
// (due_date is empty org-wide); actual_done_date is the real completion date.
interface DeliveryWindowSide {
  due: number; // tasks whose deadline fell in this window
  onTime: number; // …delivered on or before their deadline
  late: number; // …whose deadline passed without an on-time delivery
  cleared: number; // …of the late ones, how many are now finished (late but done)
}

interface DeliveryWindow {
  current: DeliveryWindowSide;
  previous: DeliveryWindowSide;
}

async function loadDeliveryWindow(orgId: string): Promise<DeliveryWindow | null> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const todayStr = iso(now);
  const d7 = iso(now - 7 * 86_400_000);
  const d14 = iso(now - 14 * 86_400_000);

  const { data } = await supabaseAdmin
    .from("tasks")
    .select("stage, planned_date, actual_done_date")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .not("planned_date", "is", null)
    .gt("planned_date", d14)
    .lte("planned_date", todayStr);

  const rows = (data ?? []) as Array<{
    stage: string;
    planned_date: string;
    actual_done_date: string | null;
  }>;
  if (rows.length === 0) return null;

  const blank = (): DeliveryWindowSide => ({ due: 0, onTime: 0, late: 0, cleared: 0 });
  const current = blank();
  const previous = blank();

  for (const t of rows) {
    const side = t.planned_date > d7 ? current : previous;
    side.due += 1;
    const done = t.stage === "done";
    const onTime = done && t.actual_done_date != null && t.actual_done_date <= t.planned_date;
    if (onTime) {
      side.onTime += 1;
      continue;
    }
    // Not on time. It's "late" once its deadline has actually passed.
    if (t.planned_date < todayStr) {
      side.late += 1;
      if (done) side.cleared += 1; // finished, just after the deadline
    }
  }

  return { current, previous };
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
  slaLate: BriefSlaLate,
): Promise<{
  criticalEvents: BriefEvent[];
  timelineEvents: BriefEvent[];
  // «الجديد اليوم» complaints item — counted PRE-cap from actual client-group
  // complaint/escalation highlights only. Counting from the capped timeline
  // mixed in AI risk-summary events (dated by analysis time, not message time)
  // and truncated at 80, so the digest number matched neither its label nor
  // the evidence modal (claimed 7 when real in-window complaints were 3).
  freshComplaints: { count: number; latestTitle: string | null };
}> {
  const analysisRes = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("id, client_id, created_at, highlights, risks, satisfaction_score, sentiment, client:clients!inner(name)")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(40);

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
  const complaintCutoff = riyadhDaysAgoIso(2);
  const complaintPool: Array<{ date: string; title: string }> = [];
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
      const date = highlight.date ?? row.created_at;
      // ACTUAL client-group complaints in-window (highlight-dated, not the
      // AI risk-summary rows below, which carry the analysis date) — this is
      // the population the digest item claims and the evidence modal lists.
      if (
        audience !== "team" &&
        (type === "complaint" || type === "escalation") &&
        date >= complaintCutoff
      ) {
        complaintPool.push({ date, title: `${clientName}: ${text}` });
      }
      events.push({
        id: `sat-${row.id}-${i}`,
        title: `${clientName}: ${text}`,
        date,
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

  // Late = the SLA meaning (stage dwell over the template limit), NOT the
  // delivery deadline — the brief carries one definition of متأخرة only.
  for (const t of slaLate.worstTasks) {
    const taskLabel = [t.taskCode, t.title].filter(Boolean).join(" · ");
    const stageLabel = SLA_STAGE_LABEL[t.stage] ?? t.stage;
    const excessHours = Math.round(t.excessMinutes / 60);
    events.push({
      id: `task-${t.taskId}`,
      title: `${t.clientName ?? "—"}: ${taskLabel || "مهمة"} — متجاوزة مهلة «${stageLabel}» بـ ${excessHours} ساعة عمل`,
      date: runDate,
      source: "system",
      category: "delay",
      severity:
        t.excessMinutes >= BUSINESS_MINUTES_PER_DAY * 2
          ? "critical"
          : t.excessMinutes >= BUSINESS_MINUTES_PER_DAY
            ? "high"
            : "medium",
      href: `/tasks/${t.taskId}`,
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

  complaintPool.sort((a, b) => b.date.localeCompare(a.date));
  return {
    criticalEvents,
    timelineEvents,
    freshComplaints: {
      count: complaintPool.length,
      latestTitle: complaintPool[0]?.title ?? null,
    },
  };
}

// ---- main ----------------------------------------------------------------

// Renewal pipeline for the CURRENT month, mirroring exactly what the /contracts
// CEO dashboard shows (RenewalFunnelStrip): count = On-Target + Overdue renewal
// clients, value = `expected_renewals` (the sheet's Next-Contract-Value income
// for those clients). The brief used to sum `contracts.total_value` over a rolling
// today→+30d window, which (a) double-counts a contract's whole value instead of
// the renewal income and (b) is dominated by Sales-Deposit contracts that aren't
// renewals at all — so it matched neither the On-Target expected nor the month
// total. Sourcing from the same month-aware engine keeps the brief and /contracts
// consistent for the CEO who clicks through.
async function loadRenewalPipeline(
  orgId: string,
): Promise<{ count: number; value: number }> {
  const now = new Date();
  const monthIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  try {
    const months = await listDashboardMonths(orgId);
    const entry = months.find((m) => m.month === monthIso);
    // Frozen months are immutable; live months recompute once before reading.
    if (!entry?.is_frozen) await refreshMonthlyDashboard(orgId, monthIso);
    const d = await getMonthlyDashboard(orgId, monthIso);
    if (!d) return { count: 0, value: 0 };
    return {
      count: d.cnt_on_target + d.cnt_overdue,
      value: d.expected_renewals,
    };
  } catch {
    return { count: 0, value: 0 };
  }
}

export async function buildCeoBriefSignals(orgId: string): Promise<CeoBriefSignals> {
  // Run ALONE, before the parallel burst below: the ~18 concurrent loaders
  // (several heavy accountability aggregations) create enough DB contention to
  // blow this query past the RPC's 12s statement timeout, even though it runs
  // in ~2s uncontended. Serializing it costs ~2s and removes the flake.
  const slaLate = await loadSlaLate(orgId);

  const [
    scores,
    briefData,
    pulse,
    bottlenecks,
    clientHealth,
    activity,
    performers,
    snap,
    services,
    wip,
    satRows,
    satRisk,
    dismissed,
    dataQuality,
    deliveryWindow,
    deptCapacity,
    renewalPipeline,
    todayCounts,
  ] = await Promise.all([
    getExecutiveScores(orgId),
    buildCeoBriefData(orgId),
    getPulseStats(orgId),
    getApprovalBottlenecks(orgId),
    getClientHealth(orgId),
    getTeamActivityOverview(orgId),
    getPerformerLeaderboard(orgId),
    loadSnapshotDeltas(orgId),
    getServiceLineHealth(orgId),
    getWipAging(orgId),
    getSatisfactionRows(orgId).catch(() => []),
    getAtRiskClients(orgId).catch(() => []),
    loadDismissedRisks(orgId),
    getAiDataQuality(orgId),
    loadDeliveryWindow(orgId),
    getDepartmentCapacity(orgId).catch(() => []),
    loadRenewalPipeline(orgId),
    loadTodayCounts(orgId).catch(() => ({
      doneSinceYesterday: 0,
      collectedSinceYesterday: { count: 0, value: 0 },
    })),
  ]);

  const statusPct = Math.round(scores.stability.score);
  const grade = gradeFor(scores.stability.score);

  const completedShift = pulse.completed.current - pulse.completed.previous;
  const verdict = computeVerdict(snap, completedShift, scores.stability.score);

  // Client churn — scoped to the EXACT definition the /satisfaction page uses, so
  // the brief and that page can never disagree again. "At risk of loss" = ACTIVE
  // clients (those with a live project) whose AI satisfaction is negative or < 55.
  // Already-lost clients are intentionally excluded — they can't churn, they're
  // gone. Reuses getSatisfactionRows (the page's own source) rather than the
  // contract-scoped aggregate, which under-counted (its merge-map canonicalization
  // silently dropped a few active clients).
  const activeSatRows = satRows.filter((r) => r.hasActiveProject);
  const atRiskActive = activeSatRows
    .filter((r) => isClientAtRisk(r.satisfactionScore, r.sentiment))
    .sort((a, b) => (a.satisfactionScore ?? 100) - (b.satisfactionScore ?? 100));
  const meanRound = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const riskTextById = new Map(satRisk.map((c) => [c.clientId, c.topRisk] as const));
  const churn = {
    activeClients: activeSatRows.length,
    atRisk: atRiskActive.length,
    avgSatisfaction: meanRound(
      activeSatRows.map((r) => r.satisfactionScore).filter((v): v is number => v != null),
    ),
    avgBriefAdherence: meanRound(
      activeSatRows.map((r) => r.briefAdherenceScore).filter((v): v is number => v != null),
    ),
    top: atRiskActive.slice(0, 5).map((r) => ({
      clientId: r.clientId,
      clientName: r.clientName,
      score: r.satisfactionScore,
      risk: riskTextById.get(r.clientId) ?? null,
    })),
  };

  // ── Changes (evidence for "better or worse") ───────────────────────────
  // All snapshot-backed and reliable. Service-line deltas are intentionally
  // excluded — the "services" taxonomy is per-package (Account Manager, Renewal
  // …) and noisy; service trends live in the detailed Service Health section.
  const changes: BriefChange[] = [];

  // On-time delivery (last 7 days vs prior 7) — of the tasks DUE in the window,
  // how many were delivered on time. Count + pct, live from the tasks table
  // (the team explicitly wanted the 7-day required-vs-delivered view, not the
  // rolling 30-day snapshot, and no task-list drill-down on this pill).
  if (deliveryWindow && deliveryWindow.current.due > 0) {
    const cur = deliveryWindow.current;
    const prv = deliveryWindow.previous;
    const nowPct = Math.round((cur.onTime / cur.due) * 100);
    const prevPct = prv.due > 0 ? Math.round((prv.onTime / prv.due) * 100) : null;
    const d = prevPct == null ? 0 : nowPct - prevPct;
    changes.push({
      labelKey: "onTime",
      value: d,
      unit: "points",
      dir: d > 0 ? "up" : d < 0 ? "down" : "flat",
      good: d >= 0,
      detail: {
        from: prevPct ?? 0,
        to: nowPct,
        sample: {
          current: { num: cur.onTime, den: cur.due },
          previous: { num: prv.onTime, den: prv.due },
        },
      },
    });

    // Delays-cleared rate (new) — of the tasks that went late this week, how
    // many were eventually finished. Shows the team's recovery on overdue work.
    if (cur.late > 0) {
      const nowClr = Math.round((cur.cleared / cur.late) * 100);
      const prevClr = prv.late > 0 ? Math.round((prv.cleared / prv.late) * 100) : null;
      const dc = prevClr == null ? 0 : nowClr - prevClr;
      changes.push({
        labelKey: "delaysCleared",
        value: dc,
        unit: "points",
        dir: dc > 0 ? "up" : dc < 0 ? "down" : "flat",
        good: dc >= 0,
        detail: {
          from: prevClr ?? 0,
          to: nowClr,
          href: "/tasks?view=list&filter=overdue",
          sample: {
            current: { num: cur.cleared, den: cur.late },
            previous: { num: prv.cleared, den: prv.late },
          },
        },
      });
    }
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
        detail: {
          from: snap.overduePrev,
          to: snap.overdueNow,
          href: "/tasks?view=list&filter=overdue",
        },
      });
  }
  if (scores.stability.delta != null && scores.stability.delta !== 0) {
    changes.push({
      labelKey: "stability",
      value: scores.stability.delta,
      unit: "points",
      dir: scores.stability.delta > 0 ? "up" : "down",
      good: scores.stability.delta > 0,
      detail: {
        from: Math.round(scores.stability.score - scores.stability.delta),
        to: Math.round(scores.stability.score),
        href: "/reports",
      },
    });
  }
  if (completedShift !== 0) {
    changes.push({
      labelKey: "completed",
      value: completedShift,
      unit: "tasks",
      dir: completedShift > 0 ? "up" : "down",
      good: completedShift > 0,
      detail: {
        from: pulse.completed.previous,
        to: pulse.completed.current,
        // Open the tasks ACTUALLY completed this week (was opening all open
        // tasks) — done stage + actual_done_date inside the last-7-days window.
        href: "/tasks?view=list&f=completed_week",
      },
    });
  }

  // ── Risks (where is the danger), ranked by weight ──────────────────────
  const risks: BriefRisk[] = [];

  // Agency-wide delivery slip — the systemic signal, in the brief's ONE meaning
  // of متأخرة: tasks currently held past their stage's SLA (sla_rules, per the
  // templates) — NOT the delivery deadline (that count lives on the dashboard
  // KPIs already, with its own definition).
  if (slaLate.taskCount >= 10) {
    const esc = scores.stability.unackEscalations;
    const parts = [
      `${slaLate.taskCount} مهمة متجاوزة مهلة مرحلتها (SLA) في ${slaLate.projectCount} مشروع`,
    ];
    if (slaLate.newToday > 0) parts.push(`${slaLate.newToday} منها تجاوزت المهلة اليوم`);
    if (esc > 0) parts.push(`${esc} تصعيد غير معالَج`);
    risks.push({
      id: "delivery_slip",
      title: "مهام معلّقة تجاوزت مهلة مراحلها",
      severity: slaLate.taskCount >= 60 ? "critical" : "high",
      metric: parts.join(" · "),
      href: "/accountability",
      weight: slaLate.taskCount * 0.5 + slaLate.projectCount * 2,
    });
  }

  // NOTE: the "intake bottleneck" risk (large/slow «new» stage) was removed on
  // the team's instruction (2026-06-17). The «new» stage backlog is an Odoo
  // import artifact — hundreds of tasks parked in "new" is a data-shape quirk,
  // not a real operational signal — so reporting it as a top danger was noise.
  // Do NOT reintroduce it without confirming the stage data is genuine.

  // Client churn — the satisfaction layer (imported WhatsApp chats, AI-scored).
  // This is the commercial risk the brief was previously blind to.
  if (churn.atRisk >= 3) {
    const top = churn.top.slice(0, 3).map((c) => c.clientName).filter(Boolean).join("، ");
    const avg = churn.avgSatisfaction;
    const parts = [`${churn.atRisk} من ${churn.activeClients} عميلًا نشطًا معرّضون للفقد`];
    if (avg != null) parts.push(`متوسط الرضا ${avg}/100`);
    if (top) parts.push(`أبرزهم: ${top}`);
    // Deep-link straight to the single worst at-risk client (the concrete
    // evidence) rather than the whole satisfaction page; scope dismissal to it.
    const worstChurn = churn.top[0];
    risks.push({
      id: "client_churn",
      title: "خطر فقدان عملاء",
      severity: churn.atRisk >= 10 || (avg != null && avg < 50) ? "critical" : "high",
      metric: parts.join(" · "),
      // The risk spans several clients — open the at-risk-only list (exactly this
      // risk's entity set), not just the single worst client. Dismissal still
      // scopes to the worst client via entityId.
      href: "/satisfaction?risk=1",
      entityId: worstChurn?.clientId,
      weight: 40 + churn.atRisk * 3,
    });
  }

  // Track the client behind the stuck-project card so the client-level
  // "at-risk client" card below doesn't restate the SAME late load as a
  // second risk (e.g. a single-project client surfaces identically as both
  // "مشروع … متعثّر" and "العميل … في منطقة الخطر").
  // "Stuck" speaks the same SLA meaning: the project holding the most tasks
  // past their stage limit right now.
  let stuckProjectClientId: string | null = null;
  const topStuck = slaLate.topProjects[0];
  if (topStuck && topStuck.lateCount >= 3) {
    stuckProjectClientId = topStuck.clientId;
    const severity = topStuck.lateCount >= 8 ? "critical" : topStuck.lateCount >= 4 ? "high" : "medium";
    const client = topStuck.clientName ? ` · ${topStuck.clientName}` : "";
    risks.push({
      id: "stuck_project",
      title: `مشروع ${topStuck.projectName} متعثّر`,
      severity,
      metric: `${topStuck.lateCount} مهمة متجاوزة مهلة مرحلتها من ${topStuck.openCount} مفتوحة${client}`,
      href: `/tasks?view=list&projectId=${topStuck.projectId}`,
      entityId: topStuck.projectId,
      weight: topStuck.lateCount * 3,
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
    const clients = briefData.money.overdueClients;
    risks.push({
      id: "overdue_money",
      title: "دفعات متأخرة التحصيل",
      severity: val >= 50000 ? "critical" : val >= 10000 ? "high" : "medium",
      metric: `${clients} عميل · ${briefData.money.overdueInstallments} دفعة متأخرة بقيمة ${val.toLocaleString("en-US")} ريال`,
      // Evidence lives on لوحة الإيرادات: its overdue-installment cards use the
      // SAME contracts-engine formula (0168/0172) as this number, listing the
      // exact clients. (The table view has no installment-overdue filter — a
      // `pay=overdue` param there is silently ignored.)
      href: "/contracts?view=dashboard",
      weight: 50 + Math.min(60, val / 3000),
    });
  }

  // Worst client by the same SLA meaning. Suppressed when this client is
  // already represented by the stuck-project card above (same client → same
  // late tasks → duplicate card); the project card is kept because it's more
  // specific (names the project).
  const worstClient = slaLate.topClients.find((c) => c.clientId !== stuckProjectClientId);
  if (worstClient && worstClient.lateCount >= 3) {
    risks.push({
      id: "at_risk_client",
      title: `العميل ${worstClient.clientName} في منطقة الخطر`,
      severity: worstClient.lateCount >= 8 ? "high" : "medium",
      metric: `${worstClient.lateCount} مهمة متجاوزة مهلة مرحلتها`,
      href: `/satisfaction?client=${worstClient.clientId}`,
      entityId: worstClient.clientId,
      weight: 9 + worstClient.lateCount * 2,
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
      // Each composite index drills into the surface that holds its evidence,
      // rather than a generic /reports landing: delivery → the overdue tasks that
      // drag it down; quality/discipline → the accountability board (review rigor
      // & rework); productivity → the work actually completed this week;
      // stability → the open escalations behind it.
      href:
        {
          delivery: "/tasks?view=list&filter=overdue",
          quality: "/accountability",
          discipline: "/accountability",
          productivity: "/tasks?view=list&filter=completed_week",
          stability: "/escalations",
        }[worstLine.key] ?? "/reports",
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
    renewalsCount: renewalPipeline.count,
    renewalsValue: renewalPipeline.value,
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
    satisfaction: activeSatRows.length
      ? {
          avg: churn.avgSatisfaction,
          briefAdherence: churn.avgBriefAdherence,
          // Base = active clients (the churn denominator shown in the card), so
          // the AI narrates "X من Y" consistently with the visible pill.
          analyzed: churn.activeClients,
          atRisk: churn.atRisk,
          topChurn: churn.top.map((c) => ({
            client: c.clientName,
            score: c.score,
            risk: c.risk,
          })),
        }
      : null,
    zeroOnTimePerformers: [],
    supportRiskPerformers: performers.bottom.map((p) => ({
      name: p.fullName,
      open: p.openCount,
      overdue: p.overdueCount,
      stale: p.staleCount,
    })),
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
    departmentCapacity: deptCapacity,
    slaLate: {
      taskCount: slaLate.taskCount,
      projectCount: slaLate.projectCount,
      newToday: slaLate.newToday,
      topProjects: slaLate.topProjects.map((p) => ({
        project: p.projectName,
        client: p.clientName,
        lateCount: p.lateCount,
      })),
    },
  };

  const eventPack = await loadBriefTimelineEvents(
    orgId,
    activeRisks.slice(0, 5),
    new Date().toISOString(),
    slaLate,
  );

  // ── «الجديد اليوم» — the secretary digest ──────────────────────────────
  // Newsy, code-computed facts since yesterday: rendered verbatim by the card
  // with a deep link each. The AI never words these — a wrong "news" line is
  // worse than a plain one.
  const today: BriefTodayItem[] = [];
  if (slaLate.newToday > 0) {
    today.push({
      id: "sla-new",
      text: `${slaLate.newToday} مهمة تجاوزت مهلة مرحلتها منذ الأمس (الإجمالي المعلّق: ${slaLate.taskCount})`,
      href: "/accountability",
      tone: "bad",
    });
  }
  if (todayCounts.doneSinceYesterday > 0) {
    today.push({
      id: "done",
      text: `أُنجزت ${todayCounts.doneSinceYesterday} مهمة منذ الأمس`,
      href: "/tasks?view=list&f=completed_week",
      tone: "good",
    });
  }
  if (eventPack.freshComplaints.count > 0) {
    const latest = eventPack.freshComplaints.latestTitle;
    today.push({
      id: "complaints",
      text: `${eventPack.freshComplaints.count} شكوى/تصعيد من مجموعات العملاء خلال آخر يومين${latest ? ` — أحدثها: ${latest}` : ""}`,
      href: "/satisfaction",
      tone: "bad",
    });
  }
  if (todayCounts.collectedSinceYesterday.count > 0) {
    today.push({
      id: "collected",
      text: `حُصِّلت ${todayCounts.collectedSinceYesterday.count} دفعة بقيمة ${Math.round(
        todayCounts.collectedSinceYesterday.value,
      ).toLocaleString("en-US")} ريال منذ الأمس`,
      href: "/contracts?view=table",
      tone: "good",
    });
  }
  if (renewalPipeline.count > 0) {
    today.push({
      id: "renewals",
      text: `${renewalPipeline.count} عقدًا في مسار التجديد هذا الشهر بقيمة متوقعة ${Math.round(
        renewalPipeline.value,
      ).toLocaleString("en-US")} ريال`,
      href: "/contracts",
      tone: "info",
    });
  }
  if (today.length === 0) {
    today.push({ id: "quiet", text: "لا مستجدات تُذكر منذ الأمس", href: null, tone: "info" });
  }

  const finalRisks = activeRisks.slice(0, 5);
  return {
    statusPct,
    grade,
    verdict,
    emphasis: computeEmphasis(finalRisks, verdict),
    changes: changes.slice(0, 5),
    risks: finalRisks,
    today: today.slice(0, 6),
    criticalEvents: eventPack.criticalEvents,
    timelineEvents: eventPack.timelineEvents,
    opportunities,
    context,
    dataQuality,
  };
}
