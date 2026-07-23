import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { riyadhDateOf, riyadhDateRangeUtcBounds, riyadhTodayIso } from "@/lib/tz";
import type { DashboardRange } from "@/lib/dashboard-range";
import {
  getAccountabilityCases,
  type AccountabilityCase,
  type CaseProof,
} from "@/lib/data/accountability-cases";
import {
  CASE_STATUSES,
  CASE_STATUS_LABEL,
  type CaseStatus,
} from "@/lib/accountability/case-status";

export { CASE_STATUSES, CASE_STATUS_LABEL };
export type { CaseStatus };

// =========================================================================
// Accountability Problems — per-problem persistence (migration 0262).
//
// 0240 froze status + reopen at the per-EMPLOYEE case grain. The team wanted a
// manager decision (جديدة / مبرَّرة / أُنذِر …) and the "عادت بعد إغلاقها" badge to
// sit on the INDIVIDUAL problem, not the whole person. This layer is the same
// idempotent, daily-guarded materialization as the case store, but keyed by
// `problem_key` (assigned in accountability-cases.ts, stable across
// re-detections). The live feed still computes the problems; this only freezes
// their status + history. Writes go through the service role only.
// =========================================================================

// One decided/tracked problem's frozen state, as the UI reads it.
export interface PersistedProblemMeta {
  status: CaseStatus;
  timesSeen: number; // daily-poll counter, NOT recurrence — see reopenCount
  reopenCount: number; // resolved then detected again — the honest "it's back" signal
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface ProblemRow {
  id: string;
  problem_key: string;
  employee_id: string;
  status: CaseStatus;
  is_current: boolean;
  first_seen_at: string;
  last_seen_at: string;
  last_seen_date: string;
  times_seen: number;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

// Flatten the live case feed into individual problems. A proof with no
// problemKey (should not happen post-assembly) is skipped defensively.
interface LiveProblem {
  problemKey: string;
  employeeId: string;
  kind: CaseProof["kind"];
  stream: CaseProof["stream"];
  severity: string;
  summary: string;
  taskCode: string | null;
  clientId: string | null;
  href: string | null;
}

function flattenProblems(cases: AccountabilityCase[]): LiveProblem[] {
  const out: LiveProblem[] = [];
  for (const c of cases) {
    if (!c.employeeId) continue;
    for (const p of c.proof) {
      if (!p.problemKey) continue;
      out.push({
        problemKey: p.problemKey,
        employeeId: c.employeeId,
        kind: p.kind,
        stream: p.stream,
        severity: c.severity,
        summary: p.text,
        taskCode: p.taskCode,
        clientId: p.clientId,
        href: p.href,
      });
    }
  }
  return out;
}

// True once per Riyadh day: has today's materialization already run?
async function materializedToday(orgId: string): Promise<boolean> {
  const today = riyadhTodayIso();
  const { data } = await supabaseAdmin
    .from("accountability_problems")
    .select("last_seen_date")
    .eq("organization_id", orgId)
    .order("last_seen_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data && (data as { last_seen_date: string }).last_seen_date >= today);
}

async function logEvent(
  orgId: string,
  problemId: string,
  kind: string,
  fields: { status?: string; severity?: string; note?: string; actorId?: string | null },
): Promise<void> {
  await supabaseAdmin.from("accountability_problem_events").insert({
    problem_id: problemId,
    organization_id: orgId,
    kind,
    status: fields.status ?? null,
    severity: fields.severity ?? null,
    note: fields.note ?? null,
    actor_employee_id: fields.actorId ?? null,
  });
}

// Upsert the live problem set: keep manager decisions, bump the daily counter,
// reopen resolved problems that reappear, retire problems no longer detected.
// Accepts pre-computed cases so the page's single getAccountabilityCases() feeds
// both the feed and this materialization.
export async function materializeAccountabilityProblems(
  orgId: string,
  cases?: AccountabilityCase[],
): Promise<Record<string, PersistedProblemMeta>> {
  const liveCases = cases ?? (await getAccountabilityCases(orgId)).cases;
  const today = riyadhTodayIso();
  const now = new Date().toISOString();

  const live = flattenProblems(liveCases);
  const liveByKey = new Map<string, LiveProblem>();
  for (const p of live) liveByKey.set(p.problemKey, p);

  const { data: existingRaw } = await supabaseAdmin
    .from("accountability_problems")
    .select(
      "id, problem_key, employee_id, status, is_current, first_seen_at, last_seen_at, last_seen_date, times_seen, decided_by, decided_at, decision_note",
    )
    .eq("organization_id", orgId);
  const existing = (existingRaw ?? []) as ProblemRow[];
  const existingByKey = new Map(existing.map((r) => [r.problem_key, r]));

  // Detected / reopened / refreshed.
  for (const [key, p] of liveByKey) {
    const prev = existingByKey.get(key);
    const snapshot = {
      employee_id: p.employeeId,
      kind: p.kind,
      stream: p.stream,
      severity: p.severity,
      summary: p.summary,
      task_code: p.taskCode,
      client_id: p.clientId,
      href: p.href,
      is_current: true,
      last_seen_at: now,
      last_seen_date: today,
    };

    if (!prev) {
      const { data: ins } = await supabaseAdmin
        .from("accountability_problems")
        .insert({
          organization_id: orgId,
          problem_key: key,
          status: "open",
          ...snapshot,
          first_seen_at: now,
          times_seen: 1,
        })
        .select("id")
        .single();
      if (ins) await logEvent(orgId, (ins as { id: string }).id, "detected", { severity: p.severity });
      continue;
    }

    const bumpDay = prev.last_seen_date < today;
    const reopen = prev.status === "resolved";
    await supabaseAdmin
      .from("accountability_problems")
      .update({
        ...snapshot,
        times_seen: prev.times_seen + (bumpDay ? 1 : 0),
        status: reopen ? "open" : prev.status,
      })
      .eq("id", prev.id);
    if (reopen) await logEvent(orgId, prev.id, "reopened", { severity: p.severity });
  }

  // Retire problems no longer detected. open/under_review auto-resolve; a
  // manager's terminal decision (excused/warned) is kept, only marked not-current.
  for (const prev of existing) {
    if (liveByKey.has(prev.problem_key) || !prev.is_current) continue;
    const autoResolve = prev.status === "open" || prev.status === "under_review";
    await supabaseAdmin
      .from("accountability_problems")
      .update({ is_current: false, status: autoResolve ? "resolved" : prev.status })
      .eq("id", prev.id);
    if (autoResolve)
      await logEvent(orgId, prev.id, "resolved", { note: "لم تعد المشكلة مرصودة" });
  }

  return getPersistedProblemMeta(orgId);
}

// Materialize at most once per Riyadh day, then return the meta map. Safe to
// call on every page load; failures degrade to an empty map (page still shows
// live problems, just without persisted status/history).
export async function syncAndGetProblemMeta(
  orgId: string,
  cases?: AccountabilityCase[],
): Promise<Record<string, PersistedProblemMeta>> {
  try {
    if (await materializedToday(orgId)) return getPersistedProblemMeta(orgId);
    return await materializeAccountabilityProblems(orgId, cases);
  } catch (e) {
    console.error("[problems-store] sync failed, degrading:", e);
    try {
      return await getPersistedProblemMeta(orgId);
    } catch {
      return {};
    }
  }
}

export async function getPersistedProblemMeta(
  orgId: string,
): Promise<Record<string, PersistedProblemMeta>> {
  const [problemsRes, reopenRes] = await Promise.all([
    supabaseAdmin
      .from("accountability_problems")
      .select(
        "id, problem_key, employee_id, status, times_seen, first_seen_at, last_seen_at, is_current, decided_by, decided_at, decision_note, decider:employee_profiles!accountability_problems_decided_by_fkey(full_name)",
      )
      .eq("organization_id", orgId),
    // Real recurrence: a problem that was resolved and came back.
    supabaseAdmin
      .from("accountability_problem_events")
      .select("problem_id")
      .eq("organization_id", orgId)
      .eq("kind", "reopened"),
  ]);
  const { data, error } = problemsRes;
  if (error) throw error;
  const reopensByProblem = new Map<string, number>();
  for (const e of (reopenRes.data ?? []) as Array<{ problem_id: string }>) {
    reopensByProblem.set(e.problem_id, (reopensByProblem.get(e.problem_id) ?? 0) + 1);
  }
  const map: Record<string, PersistedProblemMeta> = {};
  for (const r of (data ?? []) as unknown as Array<
    ProblemRow & { decider: { full_name: string | null } | { full_name: string | null }[] | null }
  >) {
    const decider = Array.isArray(r.decider) ? r.decider[0] : r.decider;
    map[r.problem_key] = {
      status: r.status,
      timesSeen: r.times_seen,
      reopenCount: reopensByProblem.get(r.id) ?? 0,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      isCurrent: r.is_current,
      decidedBy: r.decided_by,
      decidedByName: decider?.full_name ?? null,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
    };
  }
  return map;
}

// Manager decision on a single problem. Ensures a row exists (the problem may
// not be materialized yet), writes status + note + decider, logs the change.
// `employeeId` + the snapshot fields let us materialize on the fly when a
// decision is made before the daily sync.
export async function setProblemStatus(
  orgId: string,
  problemKey: string,
  employeeId: string,
  status: CaseStatus,
  note: string | null,
  actorId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const today = riyadhTodayIso();
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("accountability_problems")
    .select("id")
    .eq("organization_id", orgId)
    .eq("problem_key", problemKey)
    .maybeSingle();
  if (selErr) throw new Error(`accountability_problems lookup failed: ${selErr.message}`);

  let problemId: string;
  if (existing) {
    problemId = (existing as { id: string }).id;
    const { error: updErr } = await supabaseAdmin
      .from("accountability_problems")
      .update({ status, decided_by: actorId, decided_at: now, decision_note: note })
      .eq("id", problemId);
    if (updErr) throw new Error(`accountability_problems update failed: ${updErr.message}`);
  } else {
    // Materialize the single live problem so the decision has something to
    // attach to (rare — only when a decision precedes the daily sync).
    const live = flattenProblems((await getAccountabilityCases(orgId)).cases);
    const p = live.find((x) => x.problemKey === problemKey);
    const { data: ins, error: insErr } = await supabaseAdmin
      .from("accountability_problems")
      .insert({
        organization_id: orgId,
        problem_key: problemKey,
        employee_id: p?.employeeId ?? employeeId,
        kind: p?.kind ?? "overdue_task",
        stream: p?.stream ?? "execution",
        severity: p?.severity ?? "signal",
        summary: p?.summary ?? null,
        task_code: p?.taskCode ?? null,
        client_id: p?.clientId ?? null,
        href: p?.href ?? null,
        is_current: Boolean(p),
        first_seen_at: now,
        last_seen_at: now,
        last_seen_date: today,
        times_seen: 1,
        status,
        decided_by: actorId,
        decided_at: now,
        decision_note: note,
      })
      .select("id")
      .single();
    if (insErr || !ins) {
      throw new Error(`accountability_problems insert failed: ${insErr?.message ?? "no row returned"}`);
    }
    problemId = (ins as { id: string }).id;
  }
  await logEvent(orgId, problemId, "status_change", { status, note: note ?? undefined, actorId });
}

// Problem-grain history for the CEO band (replaces the per-employee summary so
// "decided / reopened / new" stay consistent with the per-problem badges).
//
// HONESTY GATE: `first_seen_at` is bounded below by the day this store started
// tracking, NOT by when the problem actually began. So a problem only counts as
// NEW if first detected strictly AFTER day zero; the day-zero cohort is reported
// via `trackingSince` + `partial` instead (same rule as the 0240 case summary).
export interface ProblemHistorySummary {
  windowDays: number;
  trackingSince: string;
  partial: boolean;
  newProblems: number;
  reopened: number;
  resolvedInWindow: number;
  longRunning: number; // seen on 5+ distinct days and still current
  decided: number;
  openProblems: number;
}

export async function getProblemHistorySummary(
  orgId: string,
  range: Pick<DashboardRange, "from" | "to" | "days">,
): Promise<ProblemHistorySummary | null> {
  const { start, endExclusive } = riyadhDateRangeUtcBounds(range.from, range.to);

  const [problemsRes, eventsRes] = await Promise.all([
    supabaseAdmin
      .from("accountability_problems")
      .select("first_seen_at, times_seen, is_current, status")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("accountability_problem_events")
      .select("kind, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", start)
      .lt("created_at", endExclusive),
  ]);
  if (problemsRes.error) {
    console.error("[problems-store] history summary failed:", problemsRes.error.message);
    return null;
  }
  const rows = (problemsRes.data ?? []) as Array<{
    first_seen_at: string;
    times_seen: number;
    is_current: boolean;
    status: CaseStatus;
  }>;
  if (rows.length === 0) return null;

  const firstSeenDate = (r: { first_seen_at: string }) => riyadhDateOf(r.first_seen_at);
  const dayZero = rows
    .map(firstSeenDate)
    .reduce((min, d) => (d < min ? d : min));
  const events = (eventsRes.data ?? []) as Array<{ kind: string }>;

  return {
    windowDays: range.days,
    trackingSince: dayZero,
    partial: dayZero >= range.from,
    newProblems: rows.filter((r) => {
      const d = firstSeenDate(r);
      return d > dayZero && d >= range.from && d <= range.to;
    }).length,
    reopened: events.filter((e) => e.kind === "reopened").length,
    resolvedInWindow: events.filter((e) => e.kind === "resolved").length,
    longRunning: rows.filter((r) => r.is_current && r.times_seen >= 5).length,
    decided: rows.filter((r) => r.is_current && r.status !== "open").length,
    openProblems: rows.filter((r) => r.is_current && r.status === "open").length,
  };
}

// Per-person reopen rollup for the CEO band's ask rows: how many of a person's
// CURRENT problems have come back after being closed. 0 ⇒ no badge.
export async function getReopenByEmployee(orgId: string): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from("accountability_problem_events")
    .select("kind, problem:accountability_problems!inner(employee_id, is_current)")
    .eq("organization_id", orgId)
    .eq("kind", "reopened");
  const out: Record<string, number> = {};
  for (const e of (data ?? []) as unknown as Array<{
    problem: { employee_id: string; is_current: boolean } | { employee_id: string; is_current: boolean }[] | null;
  }>) {
    const pr = Array.isArray(e.problem) ? e.problem[0] : e.problem;
    if (!pr || !pr.is_current) continue;
    out[pr.employee_id] = (out[pr.employee_id] ?? 0) + 1;
  }
  return out;
}
