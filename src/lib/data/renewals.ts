import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type RenewalCycleSummary = {
  id: string;
  cycle_no: number;
  started_at: string;
  ended_at: string | null;
  status: string;
};

/**
 * Read renewal cycles for one project, newest cycle_no first.
 */
export async function listProjectRenewalCycles(
  orgId: string,
  projectId: string,
): Promise<RenewalCycleSummary[]> {
  // RLS restricts visibility to projects in the caller's org via
  // has_org_access(p.organization_id), but supabaseAdmin uses the service
  // role and bypasses RLS — so we keep the explicit org check by resolving
  // the project first.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return [];

  const { data, error } = await supabaseAdmin
    .from("renewal_cycles")
    .select("id, cycle_no, started_at, ended_at, status")
    .eq("project_id", projectId)
    .order("cycle_no", { ascending: false });
  if (error) {
    console.error("[listProjectRenewalCycles_failed]", error.message);
    return [];
  }
  return (data ?? []) as RenewalCycleSummary[];
}

/**
 * Days from today (UTC) to the given ISO date. Negative = past.
 * Returns null when the input is null/empty.
 */
export function daysUntilRenewal(nextRenewalDate: string | null | undefined): number | null {
  if (!nextRenewalDate) return null;
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const a = new Date(`${todayIso}T00:00:00.000Z`);
  const b = new Date(`${nextRenewalDate}T00:00:00.000Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Count of projects whose next_renewal_date falls within the current calendar month (Asia/Riyadh-friendly UTC date). */
export async function countRenewalsThisMonth(orgId: string): Promise<number> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const { count, error } = await supabaseAdmin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("next_renewal_date", first)
    .lte("next_renewal_date", last);
  if (error) {
    console.error("[countRenewalsThisMonth_failed]", error.message);
    return 0;
  }
  return count ?? 0;
}
