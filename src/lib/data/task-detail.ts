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

// ============================================================================
// Task activity timeline — structured (not HTML) for the AI agent.
//
// Combines:
//   • task_stage_history (local stage moves with durations)
//   • task_comments tracking events (Odoo Stage/Priority/Assignees/Title/...
//     changes that the chatter sync mirrored from mail.tracking.value)
//   • task_comments user notes (from chatter sync OR locally typed)
// ============================================================================

export type TaskTimelineEvent =
  | {
      kind: "stage_change";
      at: string;
      from_stage: string | null;
      to_stage: string;
      by_name: string | null;
      duration_seconds: number | null;
      source: "local";
    }
  | {
      kind: "tracking";
      at: string;
      field: string;
      old_value: string;
      new_value: string;
      by_name: string | null;
      source: "odoo";
    }
  | {
      kind: "note";
      at: string;
      author_name: string | null;
      body_text: string;
      is_internal: boolean;
      source: "local" | "odoo";
    };

// Pulls all activity for one task from Supabase tables (no Odoo round-trip).
// Used by the agent's getTaskTimeline tool so it can surface stage/priority/
// assignee transitions with dates instead of just user notes.
export async function getTaskTimeline(
  orgId: string,
  taskId: string,
): Promise<TaskTimelineEvent[]> {
  const [historyRes, commentsRes] = await Promise.all([
    supabaseAdmin
      .from("task_stage_history")
      .select("from_stage, to_stage, entered_at, duration_seconds, moved_by")
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
    supabaseAdmin
      .from("task_comments")
      .select(
        "body, is_internal, created_at, author_user_id, external_source, external_author_name",
      )
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
  ]);

  // Resolve local moved_by user_ids → display names.
  const movedByIds = Array.from(
    new Set(
      (historyRes.data ?? [])
        .map((r) => r.moved_by)
        .filter((u): u is string => typeof u === "string"),
    ),
  );
  const localAuthorIds = Array.from(
    new Set(
      (commentsRes.data ?? [])
        .map((c) => c.author_user_id)
        .filter((u): u is string => typeof u === "string"),
    ),
  );
  const allUserIds = Array.from(new Set([...movedByIds, ...localAuthorIds]));
  const nameByUserId = new Map<string, string>();
  if (allUserIds.length > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name")
      .eq("organization_id", orgId)
      .in("user_id", allUserIds);
    for (const e of emps ?? []) {
      if (e.user_id) nameByUserId.set(e.user_id, e.full_name);
    }
  }

  const events: TaskTimelineEvent[] = [];

  for (const r of historyRes.data ?? []) {
    events.push({
      kind: "stage_change",
      at: r.entered_at,
      from_stage: (r.from_stage as string | null) ?? null,
      to_stage: r.to_stage as string,
      by_name: r.moved_by ? (nameByUserId.get(r.moved_by) ?? null) : null,
      duration_seconds: r.duration_seconds,
      source: "local",
    });
  }

  // Tracking events have a known body shape:
  //   <p><strong>{field}:</strong> <span class="text-muted-foreground">{old}</span> → <span class="text-cyan font-medium">{new}</span></p>
  // Each <p> = one transition. One mail.message can carry several.
  const TRACKING_LINE_RE =
    /<p><strong>([^<:]+):<\/strong>\s*<span[^>]*>([^<]*)<\/span>\s*→\s*<span[^>]*>([^<]*)<\/span><\/p>/g;
  const HTML_TAG_RE = /<[^>]+>/g;
  for (const c of commentsRes.data ?? []) {
    const body = (c.body ?? "") as string;
    const isTracking = body.startsWith("<p><strong>");
    if (isTracking) {
      const matches = Array.from(body.matchAll(TRACKING_LINE_RE));
      for (const m of matches) {
        events.push({
          kind: "tracking",
          at: c.created_at as string,
          field: m[1].trim(),
          old_value: m[2].trim(),
          new_value: m[3].trim(),
          by_name:
            c.author_user_id != null
              ? (nameByUserId.get(c.author_user_id as string) ?? null)
              : ((c.external_author_name as string | null) ?? null),
          source: "odoo",
        });
      }
    } else {
      // Strip HTML to plain text for the AI.
      const text = body.replace(HTML_TAG_RE, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      events.push({
        kind: "note",
        at: c.created_at as string,
        author_name:
          c.author_user_id != null
            ? (nameByUserId.get(c.author_user_id as string) ?? null)
            : ((c.external_author_name as string | null) ?? null),
        body_text: text,
        is_internal: Boolean(c.is_internal),
        source: c.external_source === "odoo" ? "odoo" : "local",
      });
    }
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return events;
}

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
