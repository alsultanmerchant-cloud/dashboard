"use server";

// Project status banner — Rwasem mirrors Odoo's "Update Project" header where
// a project lead posts on/off-track + a short note. Each post lives in
// audit_logs (action='project.status_update') so the Updates tab can render
// a chronological feed and AI eventing has a stable handle.

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

export type StatusValue = "on_track" | "at_risk" | "off_track" | "done";

const ALLOWED: StatusValue[] = ["on_track", "at_risk", "off_track", "done"];

export async function postProjectStatusUpdateAction(input: {
  projectId: string;
  status: StatusValue;
  note: string;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  if (!ALLOWED.includes(input.status)) return { error: "حالة غير صالحة" };
  const note = input.note.trim();
  if (note.length > 1000) return { error: "النص طويل" };

  // Org guard — ensure caller actually owns this project.
  const { data: proj } = await supabaseAdmin
    .from("projects")
    .select("id, name, last_update_status")
    .eq("organization_id", session.orgId)
    .eq("id", input.projectId)
    .maybeSingle();
  if (!proj) return { error: "المشروع غير موجود" };

  // Persist the new status on the project row so cards/banner reflect it
  // without joining audit_logs.
  const { error: upErr } = await supabaseAdmin
    .from("projects")
    .update({ last_update_status: input.status })
    .eq("id", input.projectId)
    .eq("organization_id", session.orgId);
  if (upErr) return { error: upErr.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.status_update",
    entityType: "project",
    entityId: input.projectId,
    metadata: {
      status: input.status,
      previous_status: proj.last_update_status ?? null,
      note,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_STATUS_UPDATED",
    entityType: "project",
    entityId: input.projectId,
    payload: { status: input.status, project_name: proj.name, note },
    importance: input.status === "off_track" ? "high" : "normal",
  });

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}

export type ProjectUpdateKind =
  | "status_update"  // project.status_update — manual note from the banner
  | "task_stage";    // task.stage_change — task moved between stages

export interface ProjectUpdateRow {
  id: string;
  kind: ProjectUpdateKind;
  status: StatusValue | null;
  previousStatus: StatusValue | null;
  note: string;
  createdAt: string;
  actorName: string | null;
  actorAvatar: string | null;
  // Task-specific (kind === "task_stage")
  taskTitle?: string | null;
  taskFromStage?: string | null;
  taskToStage?: string | null;
}

export async function listProjectStatusUpdates(
  organizationId: string,
  projectId: string,
): Promise<ProjectUpdateRow[]> {
  // 1) Manual status notes posted via the project banner.
  const statusRowsResult = await supabaseAdmin
    .from("audit_logs")
    .select("id, action, metadata, created_at, actor_user_id")
    .eq("organization_id", organizationId)
    .eq("entity_type", "project")
    .eq("entity_id", projectId)
    .eq("action", "project.status_update")
    .order("created_at", { ascending: false })
    .limit(100);
  if (statusRowsResult.error) throw statusRowsResult.error;
  const statusRows = statusRowsResult.data ?? [];

  // 2) Task stage transitions for tasks within this project. The audit row
  //    is keyed on entity_type='task' / entity_id=<task uuid>, so we
  //    pre-fetch the project's task IDs and IN-filter on those.
  const { data: taskIdsRows, error: taskIdsErr } = await supabaseAdmin
    .from("tasks")
    .select("id, title")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId);
  if (taskIdsErr) throw taskIdsErr;
  const taskTitleById = new Map<string, string>();
  for (const t of taskIdsRows ?? []) taskTitleById.set(t.id as string, String(t.title));

  let stageRows: Array<{
    id: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
    actor_user_id: string | null;
    entity_id: string;
  }> = [];
  if (taskIdsRows && taskIdsRows.length > 0) {
    const ids = taskIdsRows.map((t) => t.id as string);
    const { data: rows, error } = await supabaseAdmin
      .from("audit_logs")
      .select("id, metadata, created_at, actor_user_id, entity_id")
      .eq("organization_id", organizationId)
      .eq("entity_type", "task")
      .eq("action", "task.stage_change")
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    stageRows = (rows ?? []) as typeof stageRows;
  }

  // 3) Resolve actor names in one batched lookup (across both event types).
  const actorIds = new Set<string>();
  for (const r of statusRows) if (r.actor_user_id) actorIds.add(r.actor_user_id as string);
  for (const r of stageRows) if (r.actor_user_id) actorIds.add(r.actor_user_id);
  const actorById = new Map<string, { name: string; avatar: string | null }>();
  if (actorIds.size > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name, avatar_url")
      .eq("organization_id", organizationId)
      .in("user_id", [...actorIds]);
    for (const e of emps ?? []) {
      if (e.user_id) {
        actorById.set(e.user_id as string, {
          name: String(e.full_name),
          avatar: (e.avatar_url as string | null) ?? null,
        });
      }
    }
  }

  // 4) Build unified rows.
  const merged: ProjectUpdateRow[] = [];
  for (const r of statusRows) {
    const meta = (r.metadata ?? {}) as {
      status?: StatusValue;
      previous_status?: StatusValue;
      note?: string;
    };
    const actor = r.actor_user_id ? actorById.get(r.actor_user_id as string) : undefined;
    merged.push({
      id: r.id as string,
      kind: "status_update",
      status: meta.status ?? null,
      previousStatus: meta.previous_status ?? null,
      note: meta.note ?? "",
      createdAt: r.created_at as string,
      actorName: actor?.name ?? null,
      actorAvatar: actor?.avatar ?? null,
    });
  }
  for (const r of stageRows) {
    // moveTaskStageAction writes metadata `{ from, to }`. Older entries may
    // also use `{ from_stage, to_stage }` or `{ stage, previous_stage }`.
    const meta = (r.metadata ?? {}) as {
      from?: string;
      to?: string;
      from_stage?: string;
      to_stage?: string;
      stage?: string;
      previous_stage?: string;
    };
    const fromStage = meta.from ?? meta.from_stage ?? meta.previous_stage ?? null;
    const toStage = meta.to ?? meta.to_stage ?? meta.stage ?? null;
    const actor = r.actor_user_id ? actorById.get(r.actor_user_id) : undefined;
    merged.push({
      id: r.id,
      kind: "task_stage",
      status: null,
      previousStatus: null,
      note: "",
      createdAt: r.created_at,
      actorName: actor?.name ?? null,
      actorAvatar: actor?.avatar ?? null,
      taskTitle: taskTitleById.get(r.entity_id) ?? null,
      taskFromStage: fromStage,
      taskToStage: toStage,
    });
  }

  // 5) Newest first, capped at 100.
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return merged.slice(0, 100);
}
