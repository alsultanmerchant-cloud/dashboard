import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { riyadhTodayIso } from "@/lib/tz";
import { getKnowledgeStamp, isStaleAgainstKnowledge } from "@/lib/data/ai-knowledge";
import {
  getAccountabilityCases,
  type AccountabilityCase,
} from "@/lib/data/accountability-cases";
import type { CaseAdvice } from "@/lib/accountability/advice-schema";
import {
  CASE_STATUSES,
  CASE_STATUS_LABEL,
  type CaseStatus,
  type PersistedCaseMeta,
} from "@/lib/accountability/case-status";

export { CASE_STATUSES, CASE_STATUS_LABEL };
export type { CaseStatus, PersistedCaseMeta };

// =========================================================================
// Accountability Cases — persistence (migration 0240). The feed is computed
// LIVE; this layer freezes each person's case so status + history survive
// re-detection:
//   • first_seen_at / times_seen — how long, how often (repeat-offense).
//   • status + decision — the manager's call, kept across re-detections.
//   • is_current — mirrors the newest live set; false = no longer detected.
// Materialization is idempotent and daily-guarded so calling it on page load
// (once per Riyadh day) is cheap. Writes go through the service role only.
// =========================================================================

interface CaseRow {
  id: string;
  employee_id: string;
  status: CaseStatus;
  severity: string;
  is_current: boolean;
  first_seen_at: string;
  last_seen_at: string;
  last_seen_date: string;
  times_seen: number;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

// True once per Riyadh day: has today's materialization already run?
async function materializedToday(orgId: string): Promise<boolean> {
  const today = riyadhTodayIso();
  const { data } = await supabaseAdmin
    .from("accountability_cases")
    .select("last_seen_date")
    .eq("organization_id", orgId)
    .order("last_seen_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data && (data as { last_seen_date: string }).last_seen_date >= today);
}

async function logEvent(
  orgId: string,
  caseId: string,
  kind: string,
  fields: { status?: string; severity?: string; note?: string; actorId?: string | null },
): Promise<void> {
  await supabaseAdmin.from("accountability_case_events").insert({
    case_id: caseId,
    organization_id: orgId,
    kind,
    status: fields.status ?? null,
    severity: fields.severity ?? null,
    note: fields.note ?? null,
    actor_employee_id: fields.actorId ?? null,
  });
}

// Upsert the live case set into the store; keep manager decisions, bump the
// repeat counter once per day, reopen resolved cases that reappear, and retire
// (is_current=false) cases no longer detected. Returns the fresh meta map.
export async function materializeAccountabilityCases(
  orgId: string,
): Promise<Record<string, PersistedCaseMeta>> {
  const live = await getAccountabilityCases(orgId);
  const today = riyadhTodayIso();
  const now = new Date().toISOString();

  const liveByEmp = new Map<string, AccountabilityCase>();
  for (const c of live.cases) if (c.employeeId) liveByEmp.set(c.employeeId, c);

  const { data: existingRaw } = await supabaseAdmin
    .from("accountability_cases")
    .select(
      "id, employee_id, status, severity, is_current, first_seen_at, last_seen_at, last_seen_date, times_seen, decided_by, decided_at, decision_note",
    )
    .eq("organization_id", orgId);
  const existing = (existingRaw ?? []) as CaseRow[];
  const existingByEmp = new Map(existing.map((r) => [r.employee_id, r]));

  // Detected / reopened / refreshed.
  for (const [employeeId, c] of liveByEmp) {
    const prev = existingByEmp.get(employeeId);
    const snapshot = {
      severity: c.severity,
      streams: c.streams,
      problem_tags: c.problemTags,
      proof: c.proof,
      ledger: c.ledger,
      client_names: c.clientNames,
      is_current: true,
      last_seen_at: now,
      last_seen_date: today,
    };

    if (!prev) {
      const { data: ins } = await supabaseAdmin
        .from("accountability_cases")
        .insert({
          organization_id: orgId,
          employee_id: employeeId,
          status: "open",
          ...snapshot,
          first_seen_at: now,
          times_seen: 1,
        })
        .select("id")
        .single();
      if (ins) await logEvent(orgId, (ins as { id: string }).id, "detected", { severity: c.severity });
      continue;
    }

    const bumpDay = prev.last_seen_date < today;
    const reopen = prev.status === "resolved";
    await supabaseAdmin
      .from("accountability_cases")
      .update({
        ...snapshot,
        times_seen: prev.times_seen + (bumpDay ? 1 : 0),
        status: reopen ? "open" : prev.status,
      })
      .eq("id", prev.id);
    if (reopen) await logEvent(orgId, prev.id, "reopened", { severity: c.severity });
  }

  // Retire cases no longer detected. Open/under_review auto-resolve; a manager's
  // terminal decision (excused/warned) is kept, only marked not-current.
  for (const prev of existing) {
    if (liveByEmp.has(prev.employee_id) || !prev.is_current) continue;
    const autoResolve = prev.status === "open" || prev.status === "under_review";
    await supabaseAdmin
      .from("accountability_cases")
      .update({ is_current: false, status: autoResolve ? "resolved" : prev.status })
      .eq("id", prev.id);
    if (autoResolve)
      await logEvent(orgId, prev.id, "resolved", { note: "لم تعد القضية مرصودة" });
  }

  return getPersistedCaseMeta(orgId);
}

// Materialize at most once per Riyadh day, then return the meta map. Safe to
// call on every page load; failures degrade to an empty map (page still shows
// live cases, just without persisted status/history).
export async function syncAndGetCaseMeta(
  orgId: string,
): Promise<Record<string, PersistedCaseMeta>> {
  try {
    if (await materializedToday(orgId)) return getPersistedCaseMeta(orgId);
    return await materializeAccountabilityCases(orgId);
  } catch (e) {
    console.error("[cases-store] sync failed, degrading:", e);
    try {
      return await getPersistedCaseMeta(orgId);
    } catch {
      return {};
    }
  }
}

export async function getPersistedCaseMeta(
  orgId: string,
): Promise<Record<string, PersistedCaseMeta>> {
  const { data, error } = await supabaseAdmin
    .from("accountability_cases")
    .select(
      "employee_id, status, times_seen, first_seen_at, last_seen_at, is_current, decided_by, decided_at, decision_note, decider:employee_profiles!accountability_cases_decided_by_fkey(full_name)",
    )
    .eq("organization_id", orgId);
  if (error) throw error;
  const map: Record<string, PersistedCaseMeta> = {};
  for (const r of (data ?? []) as unknown as Array<
    CaseRow & { decider: { full_name: string | null } | { full_name: string | null }[] | null }
  >) {
    const decider = Array.isArray(r.decider) ? r.decider[0] : r.decider;
    map[r.employee_id] = {
      status: r.status,
      timesSeen: r.times_seen,
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

// Manager decision. Ensures a row exists (a live case may not be materialized
// yet), writes the status + note + decider, and logs the change.
export async function setCaseStatus(
  orgId: string,
  employeeId: string,
  status: CaseStatus,
  note: string | null,
  actorId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const today = riyadhTodayIso();
  const { data: existing } = await supabaseAdmin
    .from("accountability_cases")
    .select("id")
    .eq("organization_id", orgId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  let caseId: string;
  if (existing) {
    caseId = (existing as { id: string }).id;
    await supabaseAdmin
      .from("accountability_cases")
      .update({
        status,
        decided_by: actorId,
        decided_at: now,
        decision_note: note,
      })
      .eq("id", caseId);
  } else {
    // Materialize the single live case so the decision has something to attach
    // to (rare — only when a decision is made before the daily sync).
    const live = await getAccountabilityCases(orgId);
    const c = live.cases.find((x) => x.employeeId === employeeId);
    const { data: ins } = await supabaseAdmin
      .from("accountability_cases")
      .insert({
        organization_id: orgId,
        employee_id: employeeId,
        status,
        severity: c?.severity ?? "signal",
        streams: c?.streams ?? [],
        problem_tags: c?.problemTags ?? [],
        proof: c?.proof ?? [],
        ledger: c?.ledger ?? null,
        client_names: c?.clientNames ?? [],
        is_current: Boolean(c),
        first_seen_at: now,
        last_seen_at: now,
        last_seen_date: today,
        times_seen: 1,
        decided_by: actorId,
        decided_at: now,
        decision_note: note,
      })
      .select("id")
      .single();
    caseId = (ins as { id: string }).id;
  }
  await logEvent(orgId, caseId, "status_change", { status, note: note ?? undefined, actorId });
}

// ---- Advice cache (Phase 3) -------------------------------------------------
// One advice per (org, employee), invalidated by the case-fact signature and
// the org's taught-knowledge stamp (same rule as the lesson/insight caches).
export async function getCachedAdvice(
  orgId: string,
  employeeId: string,
  signature: string,
): Promise<{ advice: CaseAdvice; generatedAt: string } | null> {
  const { data } = await supabaseAdmin
    .from("accountability_advice_cache")
    .select("signature, result_json, generated_at")
    .eq("organization_id", orgId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { signature: string; result_json: CaseAdvice; generated_at: string };
  if (row.signature !== signature) return null;
  const stamp = await getKnowledgeStamp(orgId);
  if (isStaleAgainstKnowledge(row.generated_at, stamp)) return null;
  return { advice: row.result_json, generatedAt: row.generated_at };
}

export async function putCachedAdvice(
  orgId: string,
  employeeId: string,
  signature: string,
  advice: CaseAdvice,
  model: string,
): Promise<void> {
  await supabaseAdmin.from("accountability_advice_cache").upsert({
    organization_id: orgId,
    employee_id: employeeId,
    signature,
    result_json: advice,
    model,
    generated_at: new Date().toISOString(),
  });
}
