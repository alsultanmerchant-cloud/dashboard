"use server";

import { revalidatePath } from "next/cache";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getEmployeeAccountabilityEvidence,
  type AccountabilityEvidence,
} from "@/lib/data/accountability";
import {
  setCaseStatus,
  CASE_STATUSES,
  type CaseStatus,
} from "@/lib/data/accountability-cases-store";

// On-demand refresh of the accountability_scorecard cache (otherwise pg_cron
// every 10 min). Lets a manager pull the latest numbers immediately after work
// moves in Rwasem instead of waiting for the next scheduled refresh.
export async function refreshAccountabilityScorecardAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  const { error } = await supabaseAdmin.rpc("refresh_accountability_scorecard");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accountability");
  return { ok: true };
}

// Fetch one employee's evidence list on demand, so the master–detail UI can
// swap the detail pane WITHOUT a full-page navigation (which would re-render
// the whole server component and scroll-jump the reader). Same permission gate
// as the page.
export async function getAccountabilityEvidenceAction(
  employeeId: string,
): Promise<{ ok: true; evidence: AccountabilityEvidence | null } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  try {
    const evidence = await getEmployeeAccountabilityEvidence(session.orgId, employeeId);
    return { ok: true, evidence };
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
