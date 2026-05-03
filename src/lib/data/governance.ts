import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type GovernanceViolationKind =
  | "missing_log_note"
  | "stage_jump"
  | "unowned_task"
  | "permission_breach";

export type GovernanceViolationRow = {
  id: string;
  organization_id: string;
  kind: GovernanceViolationKind;
  task_id: string | null;
  project_id: string | null;
  detected_at: string;
  resolver_user_id: string | null;
  resolved_at: string | null;
  note: string | null;
  task: { id: string; title: string } | { id: string; title: string }[] | null;
  project: { id: string; name: string } | { id: string; name: string }[] | null;
};

export type GovernanceViolationCounts = Record<GovernanceViolationKind, number>;

export const GOVERNANCE_KINDS: GovernanceViolationKind[] = [
  "missing_log_note",
  "stage_jump",
  "unowned_task",
  "permission_breach",
];

export const GOVERNANCE_KIND_LABELS_AR: Record<GovernanceViolationKind, string> = {
  missing_log_note: "ملاحظة مفقودة",
  stage_jump: "قفز مراحل",
  unowned_task: "مهمة بلا منفّذ",
  permission_breach: "اختراق صلاحيات",
};

/**
 * All open violations for an org with task + project joined for the list view.
 * RLS already gates this on `governance.view`; we still scope by org id.
 */
export async function getOpenViolations(
  orgId: string,
  limit = 200,
): Promise<GovernanceViolationRow[]> {
  const { data, error } = await supabaseAdmin
    .from("governance_violations")
    .select(
      "id, organization_id, kind, task_id, project_id, detected_at, resolver_user_id, resolved_at, note, task:task_id ( id, title ), project:project_id ( id, name )",
    )
    .eq("organization_id", orgId)
    .is("resolved_at", null)
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[governance] getOpenViolations failed", error.message);
    return [];
  }
  return (data ?? []) as GovernanceViolationRow[];
}

/** Counts of OPEN violations grouped by kind for the four header tiles. */
export async function getOpenViolationCounts(
  orgId: string,
): Promise<GovernanceViolationCounts> {
  const counts: GovernanceViolationCounts = {
    missing_log_note: 0,
    stage_jump: 0,
    unowned_task: 0,
    permission_breach: 0,
  };
  const { data, error } = await supabaseAdmin
    .from("governance_violations")
    .select("kind")
    .eq("organization_id", orgId)
    .is("resolved_at", null);
  if (error) {
    console.error("[governance] getOpenViolationCounts failed", error.message);
    return counts;
  }
  for (const row of data ?? []) {
    const k = row.kind as GovernanceViolationKind;
    if (k in counts) counts[k] += 1;
  }
  return counts;
}

/** Total of all OPEN violations — used by the dashboard tile. */
export async function countOpenViolations(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("governance_violations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("resolved_at", null);
  if (error) {
    console.error("[governance] countOpenViolations failed", error.message);
    return 0;
  }
  return count ?? 0;
}
