"use server";

import { revalidatePath } from "next/cache";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getClientEditsDetail,
  getEmployeeAccountabilityEvidence,
  getEmployeeMetricDrill,
  getReviewerRigorDetail,
  type AccountabilityEvidence,
  type DrillTask,
  type EmployeeMetric,
} from "@/lib/data/accountability";
import {
  setCaseStatus,
  CASE_STATUSES,
  type CaseStatus,
} from "@/lib/data/accountability-cases-store";
import { setProblemStatus } from "@/lib/data/accountability-problems-store";

// On-demand refresh of both caches behind the accountability page (otherwise
// pg_cron every 10 min). The live desk counters intentionally come from the
// same team_activity_cache as Team Pulse, so refresh both to keep them aligned.
export async function refreshAccountabilityScorecardAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  const [scorecardResult, teamActivityResult] = await Promise.all([
    supabaseAdmin.rpc("refresh_accountability_scorecard"),
    supabaseAdmin.rpc("refresh_team_activity"),
  ]);
  const error = scorecardResult.error ?? teamActivityResult.error;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accountability");
  return { ok: true };
}

// Fetch one employee's evidence list on demand, so the master–detail UI can
// swap the detail pane WITHOUT a full-page navigation (which would re-render
// the whole server component and scroll-jump the reader). Same permission gate
// as the page.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getAccountabilityEvidenceAction(
  employeeId: string,
  from?: string,
  to?: string,
): Promise<{ ok: true; evidence: AccountabilityEvidence | null } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  // Both bounds valid → the «الفترة المحددة» tab (period window). Otherwise the
  // loader falls back to its default last-30-days live view.
  const range = from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to
    ? { from, to }
    : { from: undefined, to: undefined };
  try {
    const evidence = await getEmployeeAccountabilityEvidence(
      session.orgId,
      employeeId,
      range.from,
      range.to,
    );
    return { ok: true, evidence };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// Drill-down: the exact tasks behind a صرامة المراجعة number (one reviewer, one
// review stage, the selected window). Same permission gate as the page.
export async function getReviewerRigorDetailAction(
  employeeId: string,
  stage: "manager_review" | "specialist_review",
  from?: string,
  to?: string,
): Promise<{ ok: true; tasks: DrillTask[] } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  const range = from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to ? { from, to } : {};
  try {
    const tasks = await getReviewerRigorDetail(session.orgId, employeeId, stage, range.from, range.to);
    return { ok: true, tasks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// Drill-down: the exact tasks behind a تعديلات العميل number (one owner, window).
export async function getClientEditsDetailAction(
  employeeId: string,
  from?: string,
  to?: string,
): Promise<{ ok: true; tasks: DrillTask[] } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  const range = from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to ? { from, to } : {};
  try {
    const tasks = await getClientEditsDetail(session.orgId, employeeId, range.from, range.to);
    return { ok: true, tasks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// Drill-down for the team-table numbers (مفتوحة / متأخرة live, إجمالي المراحل /
// مراحل متأخرة period) — the exact tasks behind the figure.
const EMPLOYEE_METRICS: EmployeeMetric[] = ["open", "overdue", "totalStages", "lateStages"];

export async function getEmployeeMetricDrillAction(
  employeeId: string,
  metric: string,
  from?: string,
  to?: string,
): Promise<{ ok: true; tasks: DrillTask[] } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  if (!EMPLOYEE_METRICS.includes(metric as EmployeeMetric)) {
    return { ok: false, error: "Bad metric" };
  }
  const range = from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to ? { from, to } : {};
  try {
    const tasks = await getEmployeeMetricDrill(
      session.orgId,
      employeeId,
      metric as EmployeeMetric,
      range.from,
      range.to,
    );
    return { ok: true, tasks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A manager's decision on a case (open / under_review / excused / warned /
// resolved) with an optional note. Gated to the same permission as the page.
export async function setCaseStatusAction(input: {
  employeeId: string;
  status: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  if (!UUID.test(input.employeeId)) return { ok: false, error: "Bad employee id" };
  if (!CASE_STATUSES.includes(input.status as CaseStatus)) {
    return { ok: false, error: "Bad status" };
  }
  const note = (input.note ?? "").trim().slice(0, 500) || null;
  try {
    await setCaseStatus(
      session.orgId,
      input.employeeId,
      input.status as CaseStatus,
      note,
      session.employeeId,
    );
    revalidatePath("/accountability");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// A manager's decision on a single PROBLEM (per-problem grain, migration 0262).
// problemKey is the stable identity assigned in accountability-cases.ts; the
// employeeId lets the store materialize the row if a decision precedes the daily
// sync. Same permission gate as the page.
export async function setProblemStatusAction(input: {
  problemKey: string;
  employeeId: string;
  status: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  const problemKey = (input.problemKey ?? "").trim();
  if (!problemKey || problemKey.length > 300) return { ok: false, error: "Bad problem key" };
  if (!UUID.test(input.employeeId)) return { ok: false, error: "Bad employee id" };
  if (!CASE_STATUSES.includes(input.status as CaseStatus)) {
    return { ok: false, error: "Bad status" };
  }
  const note = (input.note ?? "").trim().slice(0, 500) || null;
  try {
    await setProblemStatus(
      session.orgId,
      problemKey,
      input.employeeId,
      input.status as CaseStatus,
      note,
      session.employeeId,
    );
    revalidatePath("/accountability");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
