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
      "id, stage, entered_at, exited_at, duration_seconds, changed_by",
    )
    .eq("organization_id", orgId)
    .eq("task_id", taskId)
    .order("entered_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = Array.from(
    new Set(
      data
        .map((r) => r.changed_by)
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
    stage: r.stage,
    entered_at: r.entered_at,
    exited_at: r.exited_at,
    duration_seconds: r.duration_seconds,
    changed_by_user_id: r.changed_by,
    changed_by_name: r.changed_by
      ? (nameByUserId.get(r.changed_by) ?? "موظف")
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
};

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
