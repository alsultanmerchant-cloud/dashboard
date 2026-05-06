import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Phase T3 — Task-detail read helpers (stage history, followers).
// Kept thin: no business logic, just formatted reads of the new tables.
// =========================================================================

export type TaskStageHistoryEntry = {
  id: string;
  stage: string;
  entered_at: string;
  exited_at: string | null;
  duration_seconds: number | null;
  changed_by_user_id: string | null;
  changed_by_name: string | null;
};

export async function listTaskStageHistory(
  orgId: string,
  taskId: string,
): Promise<TaskStageHistoryEntry[]> {
  // task_stage_history rows are inserted/closed by the DB trigger
  // tg_task_stage_history (migration 0007). We surface them as a
  // chronological timeline for the "تاريخ المراحل" tab.
  const { data, error } = await supabaseAdmin
    .from("task_stage_history")
    .select(
      "id, to_stage, entered_at, exited_at, duration_seconds, moved_by",
    )
    .eq("organization_id", orgId)
    .eq("task_id", taskId)
    .order("entered_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = Array.from(
    new Set(
      data
        .map((r) => r.moved_by)
        .filter((u): u is string => typeof u === "string"),
    ),
  );
  const nameByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name")
      .eq("organization_id", orgId)
      .in("user_id", userIds);
    for (const e of emps ?? []) {
      if (e.user_id) nameByUserId.set(e.user_id, e.full_name);
    }
  }

  return data.map((r) => ({
    id: r.id,
    stage: r.to_stage,
    entered_at: r.entered_at,
    exited_at: r.exited_at,
    duration_seconds: r.duration_seconds,
    changed_by_user_id: r.moved_by,
    changed_by_name: r.moved_by
      ? (nameByUserId.get(r.moved_by) ?? "موظف")
      : null,
  }));
}

export type TaskFollower = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  added_at: string;
  added_by_user_id: string | null;
  /** True when this follower is inherited from the project (project_members)
   *  rather than added explicitly to the task. Inherited rows can't be
   *  removed from the task — they're shown read-only.
   */
  inherited?: boolean;
};

/** Inherited followers — anyone listed as a member of the project the task
 *  belongs to. We surface these in the followers UI so Sky Light's
 *  Odoo-imported tasks aren't visually empty: the project's
 *  favorite_user_ids (sync target = project_members) become the task's
 *  default follower set.
 */
export async function listInheritedProjectFollowers(
  orgId: string,
  projectId: string,
): Promise<TaskFollower[]> {
  const { data, error } = await supabaseAdmin
    .from("project_members")
    .select(
      `created_at,
       employee:employee_profiles ( id, user_id, full_name, avatar_url, job_title )`,
    )
    .eq("organization_id", orgId)
    .eq("project_id", projectId);
  if (error) throw error;

  const rows: TaskFollower[] = [];
  for (const r of (data ?? []) as unknown as Array<{
    created_at: string;
    employee:
      | {
          id: string;
          user_id: string | null;
          full_name: string;
          avatar_url: string | null;
          job_title: string | null;
        }
      | { id: string; user_id: string | null; full_name: string; avatar_url: string | null; job_title: string | null }[]
      | null;
  }>) {
    const emp = Array.isArray(r.employee) ? r.employee[0] : r.employee;
    if (!emp) continue;
    rows.push({
      // Use auth user_id when available, else fall back to employee_profile id
      // so the UI key is stable even for Odoo employees without auth records.
      user_id: emp.user_id ?? emp.id,
      full_name: emp.full_name,
      avatar_url: emp.avatar_url ?? null,
      job_title: emp.job_title ?? null,
      added_at: r.created_at,
      added_by_user_id: null,
      inherited: true,
    });
  }
  return rows;
}

export async function listTaskFollowers(
  orgId: string,
  taskId: string,
): Promise<TaskFollower[]> {
  const { data, error } = await supabaseAdmin
    .from("task_followers")
    .select("user_id, added_by, added_at")
    .eq("task_id", taskId)
    .order("added_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = Array.from(new Set(data.map((r) => r.user_id)));
  const { data: emps } = await supabaseAdmin
    .from("employee_profiles")
    .select("user_id, full_name, avatar_url, job_title")
    .eq("organization_id", orgId)
    .in("user_id", userIds);
  const empByUserId = new Map<
    string,
    { full_name: string; avatar_url: string | null; job_title: string | null }
  >();
  for (const e of emps ?? []) {
    if (e.user_id) {
      empByUserId.set(e.user_id, {
        full_name: e.full_name,
        avatar_url: e.avatar_url,
        job_title: e.job_title,
      });
    }
  }

  return data.map((r) => {
    const emp = empByUserId.get(r.user_id);
    return {
      user_id: r.user_id,
      full_name: emp?.full_name ?? "موظف غير معروف",
      avatar_url: emp?.avatar_url ?? null,
      job_title: emp?.job_title ?? null,
      added_at: r.added_at,
      added_by_user_id: r.added_by,
    };
  });
}

// Compact list of followable employees (active employees with a user_id),
// for the "add follower" picker. Excludes anyone already on the followers
// list.
export async function listFollowerCandidates(
  orgId: string,
  excludeUserIds: string[] = [],
) {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("user_id, full_name, job_title, avatar_url, employment_status")
    .eq("organization_id", orgId)
    .eq("employment_status", "active")
    .not("user_id", "is", null)
    .order("full_name", { ascending: true });
  if (error) throw error;
  const exclude = new Set(excludeUserIds);
  return (data ?? [])
    .filter((e): e is typeof e & { user_id: string } =>
      typeof e.user_id === "string" && !exclude.has(e.user_id),
    )
    .map((e) => ({
      user_id: e.user_id,
      full_name: e.full_name,
      job_title: e.job_title ?? null,
      avatar_url: e.avatar_url ?? null,
    }));
}
