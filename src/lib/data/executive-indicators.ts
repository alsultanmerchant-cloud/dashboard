import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { type DashboardRange } from "@/lib/dashboard-range";
import { riyadhTodayIso, riyadhDateOf } from "@/lib/tz";
import { serviceGroupKey, isRenewalName, displayServiceName } from "@/lib/data/executive";
import { getRiskThreshold } from "@/lib/data/kpi-settings";

// Executive Indicators — implements the client-authored spec at
// docs/EXECUTIVE_INDICATORS_SPEC.md. Every KPI card = a Main KPI Value (current
// live operational state) + a Trend (Selected Period vs Previous Equivalent
// Period) + a tooltip, per the spec's shared structure.
//
// All trends are computed in TypeScript from `completed_at` (which — with an
// `actual_done_date` fallback — marks 100% of done tasks, verified) so the
// feature has NO dependency on the historical-snapshot RPCs. Snapshot-style
// KPIs (Projects At Risk, Overdue) reconstruct the open+overdue set at a given
// day from those done-times; period-scoped KPIs (On-Time, Service, Client
// Changes) aggregate over completion/stage-entry timestamps inside the window.
//
// Existence is taken from tasks.source_created_at (the real Odoo create_date,
// backfilled in 0239), falling back to created_at (≈ the local sync date) only
// when absent — so trend endpoints before the sync are no longer approximate.

export type TrendDirection = "increase" | "decrease" | "no_change";

export interface KpiTrend {
  current: number;
  previous: number;
  /** current − previous (percentage points for %-valued KPIs). */
  difference: number;
  /** % change vs previous ((cur−prev)/prev·100); null when prev is 0. Spec KPI 5. */
  percentChange: number | null;
  direction: TrendDirection;
  available: boolean;
}

export interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

interface KpiBase {
  trend: KpiTrend;
  periods: { selected: Period; previous: Period };
  validation: { ok: boolean; missing: string[] };
}

export interface ProjectsAtRiskKpi extends KpiBase {
  mainValue: number | null;
  threshold: number;
}
export interface OnTimeKpi extends KpiBase {
  /** live: tasks delivered on time today */
  mainValue: number | null;
  /** live: ALL tasks completed today (regardless of on-time) */
  completedToday: number;
  /** on-time % over the selected period */
  onTimePct: number | null;
  completedCount: number;
}
export interface OverdueKpi extends KpiBase {
  mainValue: number | null;
}
export interface ClientChangesKpi extends KpiBase {
  mainValue: number | null;
}
export interface ServiceDeliveryRow {
  service: string;
  onTimePct: number | null;
  onTimeTrend: KpiTrend;
  completedCount: number;
  clientChanges: number;
  clientChangesTrend: KpiTrend;
  includesRenewals: boolean;
}

export interface ExecutiveIndicators {
  /** Projects with ≥1 overdue open task (Sky Light: "at least one overdue task"). */
  projectsAtRisk: ProjectsAtRiskKpi;
  /** Projects whose overdue-open-task count reaches the configured Risk Threshold (default 5). */
  highRisk: ProjectsAtRiskKpi;
  onTime: OnTimeKpi;
  overdue: OverdueKpi;
  clientChanges: ClientChangesKpi;
  serviceDelivery: ServiceDeliveryRow[];
  periods: { selected: Period; previous: Period };
}

// Configurable thresholds (spec §9) live in kpi_settings — see
// getRiskThreshold(orgId) in @/lib/data/kpi-settings.

// ── Period engine (spec §3) ────────────────────────────────────────────────
function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export function previousEquivalent(range: DashboardRange): Period {
  const to = addDaysIso(range.from, -1);
  const from = addDaysIso(to, -(range.days - 1));
  return { from, to };
}
function directionOf(difference: number): TrendDirection {
  if (difference > 0) return "increase";
  if (difference < 0) return "decrease";
  return "no_change";
}
function trendOf(current: number, previous: number, available = true): KpiTrend {
  const difference = Math.round((current - previous) * 10) / 10;
  const percentChange = previous !== 0 ? Math.round(((current - previous) / previous) * 100) : null;
  return { current, previous, difference, percentChange, direction: directionOf(difference), available };
}

// Riyadh day boundaries as epoch ms (Riyadh = UTC+3, no DST).
function startOfDayMs(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00+03:00`).getTime();
}
function endOfDayMs(dateIso: string): number {
  return startOfDayMs(dateIso) + 86_400_000;
}
function ms(iso: string | null | undefined): number | null {
  return iso ? new Date(iso).getTime() : null;
}

// ── Task facts (lean projection, paginated to beat the 1000-row cap) ────────
interface TaskFact {
  projectId: string;
  clientId: string | null;
  projectActive: boolean;
  serviceId: string | null;
  deadline: string | null; // YYYY-MM-DD (due_date ?? planned_date)
  doneMs: number | null; // completed_at ?? actual_done_date
  archivedMs: number | null;
  createdMs: number | null;
}

type ProjEmbed = { client_id: string | null; status: string } | { client_id: string | null; status: string }[] | null;

function toFact(r: {
  project_id: string;
  due_date: string | null;
  planned_date: string | null;
  completed_at: string | null;
  actual_done_date: string | null;
  archived_at: string | null;
  created_at: string;
  source_created_at: string | null;
  service_id: string | null;
  project: ProjEmbed;
}): TaskFact {
  const proj = Array.isArray(r.project) ? r.project[0] : r.project;
  const done = r.completed_at ?? (r.actual_done_date ? `${r.actual_done_date}T00:00:00+03:00` : null);
  return {
    projectId: r.project_id,
    clientId: proj?.client_id ?? null,
    projectActive: proj?.status === "active",
    serviceId: r.service_id,
    deadline: r.due_date ?? r.planned_date,
    doneMs: ms(done),
    archivedMs: ms(r.archived_at),
    // Real Odoo create_date (0239) so historical existence isn't pinned to the
    // sync date; matches the get_overdue_during_period RPC. Falls back to created_at.
    createdMs: ms(r.source_created_at ?? r.created_at),
  };
}

// Tasks that are still open OR were completed on/after `sinceIso` — the only
// tasks that can be open at any point in [since, now]. Everything completed
// before `since` is irrelevant to the snapshot/interval math, so this keeps the
// set to ~1-2k rows instead of the full ~13k.
async function loadOpenOrRecent(orgId: string, sinceIso: string): Promise<TaskFact[]> {
  const out: TaskFact[] = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select(
        "project_id, due_date, planned_date, completed_at, actual_done_date, archived_at, created_at, source_created_at, service_id, project:projects!inner(client_id, status)",
      )
      .eq("organization_id", orgId)
      .is("completed_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Parameters<typeof toFact>[0][];
    out.push(...rows.map(toFact));
    if (rows.length < PAGE) break;
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select(
        "project_id, due_date, planned_date, completed_at, actual_done_date, archived_at, created_at, source_created_at, service_id, project:projects!inner(client_id, status)",
      )
      .eq("organization_id", orgId)
      .not("completed_at", "is", null)
      .gte("completed_at", sinceIso)
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Parameters<typeof toFact>[0][];
    out.push(...rows.map(toFact));
    if (rows.length < PAGE) break;
  }

  return out;
}

// ── Contract state (HOLD/LOST exclusion) ───────────────────────────────────
async function excludedClientIds(orgId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("contracts")
    .select("client_id, status")
    .eq("organization_id", orgId);
  const byClient = new Map<string, Set<string>>();
  for (const r of (data ?? []) as Array<{ client_id: string | null; status: string | null }>) {
    if (!r.client_id) continue;
    const s = byClient.get(r.client_id) ?? new Set<string>();
    if (r.status) s.add(r.status);
    byClient.set(r.client_id, s);
  }
  const excluded = new Set<string>();
  for (const [clientId, statuses] of byClient) {
    if (statuses.has("active") || statuses.has("renewed")) continue;
    if (statuses.has("hold") || statuses.has("lost") || statuses.has("closed")) excluded.add(clientId);
  }
  return excluded;
}

// Project ids carrying a HOLD or LOST project-level tag. This is Sky Light's
// authoritative "wound-down" signal for the Projects-At-Risk card: at-risk =
// active project with ≥1 late task, MINUS HOLD/LOST-tagged projects (= 37,
// verified 2026-07-09). Contract status (excludedClientIds) is a separate,
// laggier signal and is NOT used for this card — the project tag is.
async function excludedProjectIdsByTag(orgId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await supabaseAdmin
    .from("project_tag_assignments")
    .select("project_id, tag:project_tags!inner(name)")
    .eq("organization_id", orgId)
    .in("tag.name", ["HOLD", "LOST"]);
  if (error) return out;
  for (const r of (data ?? []) as Array<{ project_id: string | null }>) {
    if (r.project_id) out.add(r.project_id);
  }
  return out;
}

// ── Snapshot & interval predicates ─────────────────────────────────────────
// Open + overdue as of end-of-day D (Riyadh).
function openOverdueAsOf(f: TaskFact, dateIso: string): boolean {
  // Archived tasks that never completed are excluded from historical calcs (spec §4).
  if (f.archivedMs != null && f.doneMs == null) return false;
  if (!f.deadline || !(f.deadline < dateIso)) return false; // deadline must have passed by D
  const cutoff = endOfDayMs(dateIso);
  if (f.doneMs != null && f.doneMs < cutoff) return false; // already done by D
  if (f.archivedMs != null && f.archivedMs < cutoff) return false; // archived by D
  if (f.createdMs != null && f.createdMs >= cutoff) return false; // didn't exist yet
  return true;
}

// Was the task open AND overdue at any time during [s, e] (spec KPI 3)?
function overdueDuringPeriod(f: TaskFact, s: string, e: string, nowMs: number): boolean {
  // Archived tasks that never completed are excluded from historical calcs (spec §4).
  if (f.archivedMs != null && f.doneMs == null) return false;
  if (!f.deadline || !(f.deadline < e)) return false;
  const startOverdue = endOfDayMs(f.deadline); // becomes overdue the day after the deadline
  const openUntil = Math.min(f.doneMs ?? Infinity, nowMs); // overdue window ends when done (or now)
  const pStart = startOfDayMs(s);
  const pEnd = endOfDayMs(e);
  if (f.createdMs != null && f.createdMs >= pEnd) return false;
  return startOverdue < pEnd && openUntil > pStart; // intervals overlap
}

// ── KPI 1 — Projects At Risk ───────────────────────────────────────────────
// The exact project ids behind the card: projects with ≥ threshold open tasks
// past their deadline (any stage, incl. not-started — Sky Light counts those),
// active project only, HOLD/LOST/closed clients excluded.
interface AtRiskOpts {
  activeOnly?: boolean;
  /** Exclude these CLIENT ids (contract HOLD/LOST/closed). */
  excluded?: Set<string>;
  /** Exclude these PROJECT ids (project-level HOLD/LOST tag — the team's
   *  authoritative wound-down signal for the Projects-At-Risk card). */
  excludedProjectIds?: Set<string>;
}
function atRiskProjectIds(
  facts: TaskFact[],
  dateIso: string,
  threshold: number,
  opts: AtRiskOpts,
): string[] {
  const perProject = new Map<string, { count: number; clientId: string | null; active: boolean }>();
  for (const f of facts) {
    if (!openOverdueAsOf(f, dateIso)) continue;
    const cur = perProject.get(f.projectId) ?? { count: 0, clientId: f.clientId, active: f.projectActive };
    cur.count += 1;
    perProject.set(f.projectId, cur);
  }
  const ids: string[] = [];
  for (const [projectId, p] of perProject) {
    if (p.count < threshold) continue;
    if (opts.activeOnly && !p.active) continue;
    if (opts.excluded && p.clientId && opts.excluded.has(p.clientId)) continue;
    if (opts.excludedProjectIds && opts.excludedProjectIds.has(projectId)) continue;
    ids.push(projectId);
  }
  return ids;
}
function atRiskCount(
  facts: TaskFact[],
  dateIso: string,
  threshold: number,
  opts: AtRiskOpts,
): number {
  return atRiskProjectIds(facts, dateIso, threshold, opts).length;
}

// Exact historical endpoints via SQL (migration 0234). They use
// task_stage_history for existence, so pre-sync dates are correct — the TS
// paths above are the fallback if an RPC is unavailable.
async function atRiskAsOfRpc(orgId: string, dateIso: string, threshold: number): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc("get_projects_at_risk_asof", {
    p_org: orgId,
    p_asof: dateIso,
    p_threshold: threshold,
  });
  return error || data == null ? null : Number(data);
}
async function overdueDuringPeriodRpc(orgId: string, from: string, to: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc("get_overdue_during_period", {
    p_org: orgId,
    p_from: from,
    p_to: to,
  });
  return error || data == null ? null : Number(data);
}

// ── Public entry ───────────────────────────────────────────────────────────
async function _getExecutiveIndicatorsForWindow(
  orgId: string,
  from: string,
  to: string,
  preset: DashboardRange["preset"],
  days: number,
): Promise<ExecutiveIndicators> {
  const range: DashboardRange = { from, to, preset, days };
  // High-risk threshold (configurable, default 5). "Projects At Risk" itself
  // is now the ≥1-overdue-task set per Sky Light feedback; the configured
  // threshold governs the separate High-Risk card.
  const threshold = await getRiskThreshold(orgId);
  const AT_RISK_MIN = 1;
  const today = riyadhTodayIso();
  const previous = previousEquivalent(range);
  const periods = { selected: { from: range.from, to: range.to }, previous };
  const nowMs = Date.now();

  // Load once, reuse for the snapshot/interval KPIs. `since` = the earliest
  // period start we evaluate, so we keep every task that could be open in-window.
  const since = startOfDayMs(previous.from);
  const [facts, excluded, excludedProjectIds, completedRows, ccEntries] = await Promise.all([
    loadOpenOrRecent(orgId, new Date(since).toISOString()),
    excludedClientIds(orgId),
    excludedProjectIdsByTag(orgId),
    loadCompleted(orgId, previous.from, range.to),
    loadClientChanges(orgId, previous.from, range.to),
  ]);

  // KPI 1 — Projects At Risk (≥1 overdue open task) and the High-Risk tier
  // (≥ configured threshold). Trends come from the exact SQL RPC, with the TS
  // snapshot as fallback. Both tiers share the same overdue-open-task basis.
  const [riskCur, riskPrev, highCur, highPrev] = await Promise.all([
    atRiskAsOfRpc(orgId, range.to, AT_RISK_MIN),
    atRiskAsOfRpc(orgId, previous.to, AT_RISK_MIN),
    atRiskAsOfRpc(orgId, range.to, threshold),
    atRiskAsOfRpc(orgId, previous.to, threshold),
  ]);
  const projectsAtRisk: ProjectsAtRiskKpi = {
    mainValue: atRiskCount(facts, today, AT_RISK_MIN, { activeOnly: true, excludedProjectIds }),
    threshold: AT_RISK_MIN,
    trend: trendOf(
      riskCur ?? atRiskCount(facts, range.to, AT_RISK_MIN, {}),
      riskPrev ?? atRiskCount(facts, previous.to, AT_RISK_MIN, {}),
    ),
    periods,
    validation: { ok: true, missing: [] },
  };
  const highRisk: ProjectsAtRiskKpi = {
    mainValue: atRiskCount(facts, today, threshold, { activeOnly: true, excludedProjectIds }),
    threshold,
    trend: trendOf(
      highCur ?? atRiskCount(facts, range.to, threshold, {}),
      highPrev ?? atRiskCount(facts, previous.to, threshold, {}),
    ),
    periods,
    validation: { ok: true, missing: [] },
  };

  // KPI 3 — Overdue Tasks (exclusion applies throughout — spec KPI 3)
  const liveOverdue = facts.filter(
    (f) => openOverdueAsOf(f, today) && !(f.clientId && excluded.has(f.clientId)),
  ).length;
  const overduePeriod = (s: string, e: string) =>
    facts.filter(
      (f) => overdueDuringPeriod(f, s, e, nowMs) && !(f.clientId && excluded.has(f.clientId)),
    ).length;
  const [odCur, odPrev] = await Promise.all([
    overdueDuringPeriodRpc(orgId, range.from, range.to),
    overdueDuringPeriodRpc(orgId, previous.from, previous.to),
  ]);
  const overdue: OverdueKpi = {
    mainValue: liveOverdue,
    trend: trendOf(
      odCur ?? overduePeriod(range.from, range.to),
      odPrev ?? overduePeriod(previous.from, previous.to),
    ),
    periods,
    validation: { ok: true, missing: [] },
  };

  // KPI 2 — On-Time Task Delivery
  const onTimeSel = onTimeStats(completedRows, range.from, range.to);
  const onTimePrev = onTimeStats(completedRows, previous.from, previous.to);
  const deliveredTodayOnTime = completedRows.filter(
    // spec §C: not archived, delivered today, on time
    (r) => !r.archived && r.completedDate === today && r.deadline != null && r.completedDate <= r.deadline,
  ).length;
  // Sky Light feedback: also surface ALL tasks completed today (not just on-time).
  const completedToday = completedRows.filter(
    (r) => !r.archived && r.completedDate === today,
  ).length;
  const onTime: OnTimeKpi = {
    mainValue: deliveredTodayOnTime,
    completedToday,
    onTimePct: onTimeSel.pct,
    completedCount: onTimeSel.completed,
    trend: trendOf(onTimeSel.pct ?? 0, onTimePrev.pct ?? 0, onTimeSel.pct !== null && onTimePrev.pct !== null),
    periods,
    validation: { ok: true, missing: [] },
  };

  // KPI 5 — Client Changes Comparison (org-wide distinct tasks entering the stage)
  const ccSel = distinctTasks(ccEntries, range.from, range.to);
  const ccPrev = distinctTasks(ccEntries, previous.from, previous.to);
  const clientChanges: ClientChangesKpi = {
    mainValue: ccSel,
    trend: trendOf(ccSel, ccPrev),
    periods,
    validation: { ok: true, missing: [] },
  };

  // KPI 4 — Service Delivery Performance (per base service, renewal merged)
  const serviceDelivery = await buildServiceDelivery(
    orgId,
    completedRows,
    ccEntries,
    range,
    previous,
  );

  return { projectsAtRisk, highRisk, onTime, overdue, clientChanges, serviceDelivery, periods };
}

const getExecutiveIndicatorsForWindow = cache(_getExecutiveIndicatorsForWindow);

export function getExecutiveIndicators(
  orgId: string,
  range: DashboardRange,
): Promise<ExecutiveIndicators> {
  return getExecutiveIndicatorsForWindow(orgId, range.from, range.to, range.preset, range.days);
}

// Exact project-id set behind the "Projects At Risk" (threshold 1) and
// "High-Risk" (configured threshold) cards, so the /projects?atRisk=1 drill-down
// lands on the SAME projects the card counts — identical definition and Riyadh
// "today". This is the single source of truth shared by the card and the list
// filter (see resolveOverdueProjectIds in data/projects.ts).
async function _getProjectsAtRiskIds(orgId: string, threshold: number): Promise<string[]> {
  const today = riyadhTodayIso();
  const [facts, excludedProjectIds] = await Promise.all([
    // sinceIso = now → the second (recently-completed) page is ~empty; we only
    // need the open-task set for a point-in-time "today" snapshot.
    loadOpenOrRecent(orgId, new Date().toISOString()),
    excludedProjectIdsByTag(orgId),
  ]);
  return atRiskProjectIds(facts, today, Math.max(1, threshold), { activeOnly: true, excludedProjectIds });
}
export const getProjectsAtRiskIds = cache(_getProjectsAtRiskIds);

// ── KPI 2 / 4 helpers — completed tasks in a window ────────────────────────
interface CompletedRow {
  completedAtMs: number;
  completedDate: string; // Riyadh date
  deadline: string | null;
  serviceId: string | null;
  archived: boolean;
}
async function loadCompleted(orgId: string, fromIso: string, toIso: string): Promise<CompletedRow[]> {
  const start = new Date(startOfDayMs(fromIso)).toISOString();
  const end = new Date(endOfDayMs(toIso)).toISOString();
  const out: CompletedRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("completed_at, due_date, planned_date, service_id, archived_at")
      .eq("organization_id", orgId)
      .eq("stage", "done")
      .not("completed_at", "is", null)
      .gte("completed_at", start)
      .lt("completed_at", end)
      .order("completed_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ completed_at: string; due_date: string | null; planned_date: string | null; service_id: string | null; archived_at: string | null }>;
    for (const r of rows) {
      out.push({
        completedAtMs: new Date(r.completed_at).getTime(),
        completedDate: riyadhDateOf(r.completed_at),
        deadline: r.due_date ?? r.planned_date,
        serviceId: r.service_id,
        archived: r.archived_at != null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
function onTimeStats(rows: CompletedRow[], from: string, to: string): { pct: number | null; completed: number } {
  let completed = 0;
  let onTime = 0;
  for (const r of rows) {
    if (r.completedDate < from || r.completedDate > to) continue;
    completed += 1;
    if (r.deadline != null && r.completedDate <= r.deadline) onTime += 1;
  }
  return { pct: completed > 0 ? Math.round((onTime / completed) * 100) : null, completed };
}

// ── KPI 4 / 5 helpers — CLIENT CHANGES stage entries ───────────────────────
interface CcEntry {
  taskId: string;
  enteredDate: string; // Riyadh date
}
async function loadClientChanges(orgId: string, fromIso: string, toIso: string): Promise<CcEntry[]> {
  const start = new Date(startOfDayMs(fromIso)).toISOString();
  const end = new Date(endOfDayMs(toIso)).toISOString();
  const out: CcEntry[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("task_stage_history")
      .select("task_id, entered_at, task:tasks!inner(archived_at)")
      .eq("organization_id", orgId)
      .eq("to_stage", "client_changes")
      // Exclude archived (wound-down / lost-client) tasks so the period count
      // and its trend are scoped like the live count. See getTopRevisedTasks.
      .is("task.archived_at", null)
      .gte("entered_at", start)
      .lt("entered_at", end)
      .order("entered_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ task_id: string; entered_at: string }>;
    for (const r of rows) out.push({ taskId: r.task_id, enteredDate: riyadhDateOf(r.entered_at) });
    if (rows.length < PAGE) break;
  }
  return out;
}
function distinctTasks(entries: CcEntry[], from: string, to: string): number {
  const set = new Set<string>();
  for (const e of entries) if (e.enteredDate >= from && e.enteredDate <= to) set.add(e.taskId);
  return set.size;
}

async function buildServiceDelivery(
  orgId: string,
  completed: CompletedRow[],
  ccEntries: CcEntry[],
  range: DashboardRange,
  previous: Period,
): Promise<ServiceDeliveryRow[]> {
  // service_id → name
  const { data: svc } = await supabaseAdmin
    .from("services")
    .select("id, name")
    .eq("organization_id", orgId);
  const nameById = new Map<string, string>();
  for (const s of (svc ?? []) as Array<{ id: string; name: string }>) nameById.set(s.id, s.name);

  // service_id for the CLIENT CHANGES task ids (they may be open, not in `completed`)
  const ccTaskIds = [...new Set(ccEntries.map((e) => e.taskId))];
  const svcByTask = new Map<string, string | null>();
  for (let i = 0; i < ccTaskIds.length; i += 500) {
    const chunk = ccTaskIds.slice(i, i + 500);
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("id, service_id")
      .in("id", chunk);
    for (const r of (data ?? []) as Array<{ id: string; service_id: string | null }>) svcByTask.set(r.id, r.service_id);
  }

  type Agg = { key: string; display: string; includesRenewals: boolean };
  const groups = new Map<string, Agg>();
  const keyFor = (serviceId: string | null): string | null => {
    if (!serviceId) return null;
    const name = nameById.get(serviceId);
    if (!name) return null;
    const key = serviceGroupKey(name);
    const g = groups.get(key) ?? { key, display: displayServiceName(name), includesRenewals: false };
    if (isRenewalName(name)) g.includesRenewals = true;
    if (!isRenewalName(name)) g.display = displayServiceName(name);
    groups.set(key, g);
    return key;
  };

  // completed on-time per key per period
  const perKey = new Map<string, { selCompleted: number; selOnTime: number; prevCompleted: number; prevOnTime: number; selCc: Set<string>; prevCc: Set<string> }>();
  const ensure = (k: string) =>
    perKey.get(k) ?? perKey.set(k, { selCompleted: 0, selOnTime: 0, prevCompleted: 0, prevOnTime: 0, selCc: new Set(), prevCc: new Set() }).get(k)!;

  for (const r of completed) {
    const k = keyFor(r.serviceId);
    if (!k) continue;
    const a = ensure(k);
    const inSel = r.completedDate >= range.from && r.completedDate <= range.to;
    const inPrev = r.completedDate >= previous.from && r.completedDate <= previous.to;
    if (inSel) {
      a.selCompleted += 1;
      if (r.deadline != null && r.completedDate <= r.deadline) a.selOnTime += 1;
    }
    if (inPrev) {
      a.prevCompleted += 1;
      if (r.deadline != null && r.completedDate <= r.deadline) a.prevOnTime += 1;
    }
  }
  for (const e of ccEntries) {
    const k = keyFor(svcByTask.get(e.taskId) ?? null);
    if (!k) continue;
    const a = ensure(k);
    if (e.enteredDate >= range.from && e.enteredDate <= range.to) a.selCc.add(e.taskId);
    if (e.enteredDate >= previous.from && e.enteredDate <= previous.to) a.prevCc.add(e.taskId);
  }

  const rows: ServiceDeliveryRow[] = [];
  for (const [k, a] of perKey) {
    const g = groups.get(k)!;
    const selPct = a.selCompleted > 0 ? Math.round((a.selOnTime / a.selCompleted) * 100) : null;
    const prevPct = a.prevCompleted > 0 ? Math.round((a.prevOnTime / a.prevCompleted) * 100) : null;
    rows.push({
      service: g.display,
      onTimePct: selPct,
      onTimeTrend: trendOf(selPct ?? 0, prevPct ?? 0, selPct !== null && prevPct !== null),
      completedCount: a.selCompleted,
      clientChanges: a.selCc.size,
      clientChangesTrend: trendOf(a.selCc.size, a.prevCc.size),
      includesRenewals: g.includesRenewals,
    });
  }
  // busiest first, then those with any activity
  rows.sort((x, y) => y.completedCount - x.completedCount || y.clientChanges - x.clientChanges);
  return rows.filter((r) => r.completedCount > 0 || r.clientChanges > 0);
}
