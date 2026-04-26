import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type Stage = Database["public"]["Enums"]["task_stage"];
type RoleType = Database["public"]["Enums"]["task_role_type"];

// Sky Light task activity feed.
// Unified read-side projection over three sources:
//   - task_comments         (kind = "note")
//   - task_stage_history    (kind = "stage_change")
//   - audit_logs            (kind = "assignee_change") for task.assignee_change
//
// Returns chronologically ordered items, oldest → newest.
// (PDF screenshots show oldest at top with newest at bottom.)

export type TaskActivity =
  | {
      kind: "note";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      body: string;
      mentions: { employee_id: string; full_name: string }[];
      is_internal: boolean;
    }
  | {
      kind: "stage_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      from_stage: Stage | null;
      to_stage: Stage;
      duration_seconds: number | null;
    }
  | {
      kind: "assignee_change";
      id: string;
      created_at: string;
      actor: { name: string; avatar: string | null } | null;
      role_type: RoleType;
      from_employee: { id: string; full_name: string } | null;
      to_employee: { id: string; full_name: string } | null;
    };

export async function getTaskActivityFeed(
  orgId: string,
  taskId: string,
): Promise<TaskActivity[]> {
  // Fan out three reads in parallel.
  const [commentsRes, stageHistoryRes, auditRes] = await Promise.all([
    supabaseAdmin
      .from("task_comments")
      .select("id, body, is_internal, created_at, author_user_id")
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
    supabaseAdmin
      .from("task_stage_history")
      .select("id, from_stage, to_stage, entered_at, duration_seconds, moved_by")
      .eq("organization_id", orgId)
      .eq("task_id", taskId),
    supabaseAdmin
      .from("audit_logs")
      .select("id, action, metadata, actor_user_id, created_at")
      .eq("organization_id", orgId)
      .eq("entity_type", "task")
      .eq("entity_id", taskId)
      .eq("action", "task.assignee_change"),
  ]);

  const comments = commentsRes.data ?? [];
  const stageHistory = stageHistoryRes.data ?? [];
  const audits = auditRes.data ?? [];

  // Resolve actor names + employee labels we'll need across all sources.
  const userIds = new Set<string>();
  const employeeIds = new Set<string>();
  const mentionCommentIds: string[] = [];

  for (const c of comments) {
    if (c.author_user_id) userIds.add(c.author_user_id);
    mentionCommentIds.push(c.id);
  }
  for (const h of stageHistory) {
    if (h.moved_by) userIds.add(h.moved_by);
  }
  for (const a of audits) {
    if (a.actor_user_id) userIds.add(a.actor_user_id);
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.from_employee_id === "string")
      employeeIds.add(meta.from_employee_id);
    if (typeof meta.to_employee_id === "string")
      employeeIds.add(meta.to_employee_id);
  }

  const [profilesRes, employeesRes, mentionsRes] = await Promise.all([
    userIds.size
      ? supabaseAdmin
          .from("employee_profiles")
          .select("user_id, full_name, avatar_url")
          .eq("organization_id", orgId)
          .in("user_id", Array.from(userIds))
      : Promise.resolve({ data: [] as { user_id: string | null; full_name: string; avatar_url: string | null }[] }),
    employeeIds.size
      ? supabaseAdmin
          .from("employee_profiles")
          .select("id, full_name")
          .eq("organization_id", orgId)
          .in("id", Array.from(employeeIds))
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    mentionCommentIds.length
      ? supabaseAdmin
          .from("task_mentions")
          .select(
            "task_comment_id, mentioned_employee_id, employee:employee_profiles!task_mentions_mentioned_employee_id_fkey ( full_name )",
          )
          .in("task_comment_id", mentionCommentIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profileByUser = new Map<string, { name: string; avatar: string | null }>();
  for (const p of profilesRes.data ?? []) {
    if (p.user_id)
      profileByUser.set(p.user_id, { name: p.full_name, avatar: p.avatar_url });
  }
  const employeeById = new Map<string, { id: string; full_name: string }>();
  for (const e of employeesRes.data ?? []) {
    employeeById.set(e.id, { id: e.id, full_name: e.full_name });
  }
  const mentionsByComment = new Map<
    string,
    { employee_id: string; full_name: string }[]
  >();
  for (const m of (mentionsRes.data ?? []) as Array<{
    task_comment_id: string;
    mentioned_employee_id: string;
    employee:
      | { full_name: string }
      | { full_name: string }[]
      | null;
  }>) {
    const emp = Array.isArray(m.employee) ? m.employee[0] : m.employee;
    if (!emp) continue;
    const arr = mentionsByComment.get(m.task_comment_id) ?? [];
    arr.push({ employee_id: m.mentioned_employee_id, full_name: emp.full_name });
    mentionsByComment.set(m.task_comment_id, arr);
  }

  const items: TaskActivity[] = [];

  for (const c of comments) {
    items.push({
      kind: "note",
      id: c.id,
      created_at: c.created_at,
      actor: profileByUser.get(c.author_user_id) ?? null,
      body: c.body,
      mentions: mentionsByComment.get(c.id) ?? [],
      is_internal: c.is_internal,
    });
  }

  for (const h of stageHistory) {
    // Skip the synthetic "creation" row (no from_stage) — it's redundant noise
    // in the feed; the task creation itself is implicit.
    if (h.from_stage === null) continue;
    items.push({
      kind: "stage_change",
      id: h.id,
      created_at: h.entered_at,
      actor: h.moved_by ? profileByUser.get(h.moved_by) ?? null : null,
      from_stage: h.from_stage,
      to_stage: h.to_stage,
      duration_seconds: h.duration_seconds,
    });
  }

  for (const a of audits) {
    const meta = (a.metadata ?? {}) as {
      role_type?: RoleType;
      from_employee_id?: string | null;
      to_employee_id?: string | null;
    };
    if (!meta.role_type) continue;
    items.push({
      kind: "assignee_change",
      id: a.id,
      created_at: a.created_at,
      actor: a.actor_user_id ? profileByUser.get(a.actor_user_id) ?? null : null,
      role_type: meta.role_type,
      from_employee: meta.from_employee_id
        ? employeeById.get(meta.from_employee_id) ?? null
        : null,
      to_employee: meta.to_employee_id
        ? employeeById.get(meta.to_employee_id) ?? null
        : null,
    });
  }

  items.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return items;
}
