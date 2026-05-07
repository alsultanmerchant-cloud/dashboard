"use server";

// Bulk reassign action for project tasks. Mirrors the Odoo
// task.bulk.update.wizard: pick a project, optionally narrow to a service
// category (or list of categories), then add/replace/clear an assignee role
// or follower set across every matching task in one shot.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

type ActionResult =
  | { ok: true; tasks_affected: number; rows_changed: number }
  | { error: string };

const ROLES = ["specialist", "manager", "agent", "account_manager"] as const;

const BulkSchema = z
  .object({
    project_id: z.string().uuid(),
    // Optional filter: only act on tasks in these service categories.
    category_ids: z.array(z.string().uuid()).default([]),
    // What to mutate.
    target: z.enum(["assignees", "followers"]),
    // Assignees: which slot. Required when target = "assignees".
    role: z.enum(ROLES).optional(),
    mode: z.enum(["add", "replace", "clear"]),
    // Assignee employee_profiles ids OR follower auth.users ids.
    actor_ids: z.array(z.string().uuid()).default([]),
  })
  .refine((d) => d.target !== "assignees" || !!d.role, {
    message: "اختر الدور (specialist/manager/agent/account_manager)",
    path: ["role"],
  })
  .refine((d) => d.mode === "clear" || d.actor_ids.length > 0, {
    message: "اختر مستخدمًا واحدًا على الأقل",
    path: ["actor_ids"],
  });

export async function bulkReassignAction(input: {
  projectId: string;
  categoryIds?: string[];
  target: "assignees" | "followers";
  role?: (typeof ROLES)[number];
  mode: "add" | "replace" | "clear";
  actorIds?: string[];
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = BulkSchema.safeParse({
    project_id: input.projectId,
    category_ids: input.categoryIds ?? [],
    target: input.target,
    role: input.role,
    mode: input.mode,
    actor_ids: input.actorIds ?? [],
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Resolve the candidate task IDs. Categories link via the task template
  // path: task.created_from_template_item_id → task_template_items → task_templates.category_id.
  let templateItemIds: string[] | null = null;
  if (parsed.data.category_ids.length > 0) {
    const { data: tmpls } = await supabaseAdmin
      .from("task_templates")
      .select("id, category_id")
      .eq("organization_id", session.orgId)
      .in("category_id", parsed.data.category_ids);
    const templateIds = (tmpls ?? []).map((t) => t.id);
    if (templateIds.length === 0) {
      return { ok: true, tasks_affected: 0, rows_changed: 0 };
    }
    const { data: items } = await supabaseAdmin
      .from("task_template_items")
      .select("id")
      .in("template_id", templateIds);
    templateItemIds = (items ?? []).map((i) => i.id);
    if (templateItemIds.length === 0) {
      return { ok: true, tasks_affected: 0, rows_changed: 0 };
    }
  }

  let taskQuery = supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("project_id", parsed.data.project_id);
  if (templateItemIds) {
    taskQuery = taskQuery.in("created_from_template_item_id", templateItemIds);
  }
  const { data: taskRows, error: taskErr } = await taskQuery;
  if (taskErr) return { error: taskErr.message };
  const taskIds = (taskRows ?? []).map((r) => r.id);
  if (taskIds.length === 0) {
    return { ok: true, tasks_affected: 0, rows_changed: 0 };
  }

  let rowsChanged = 0;

  if (parsed.data.target === "assignees") {
    const role = parsed.data.role!;

    if (parsed.data.mode === "clear" || parsed.data.mode === "replace") {
      const del = await supabaseAdmin
        .from("task_assignees")
        .delete()
        .in("task_id", taskIds)
        .eq("role_type", role);
      if (del.error) return { error: del.error.message };
      rowsChanged += del.count ?? 0;
    }

    if (parsed.data.mode === "add" || parsed.data.mode === "replace") {
      const inserts = taskIds.flatMap((tid) =>
        parsed.data.actor_ids.map((eid) => ({
          organization_id: session!.orgId,
          task_id: tid,
          employee_id: eid,
          role_type: role,
          assigned_by: session!.userId,
        })),
      );
      // Upsert by (task_id, role_type, employee_id) so re-running is safe.
      const ins = await supabaseAdmin
        .from("task_assignees")
        .upsert(inserts, { onConflict: "task_id,employee_id,role_type", ignoreDuplicates: true });
      if (ins.error) return { error: ins.error.message };
      rowsChanged += ins.count ?? inserts.length;
    }
  } else {
    // followers — table is keyed on (task_id, user_id)
    if (parsed.data.mode === "clear" || parsed.data.mode === "replace") {
      const del = await supabaseAdmin
        .from("task_followers")
        .delete()
        .in("task_id", taskIds);
      if (del.error) return { error: del.error.message };
      rowsChanged += del.count ?? 0;
    }
    if (parsed.data.mode === "add" || parsed.data.mode === "replace") {
      const inserts = taskIds.flatMap((tid) =>
        parsed.data.actor_ids.map((uid) => ({
          task_id: tid,
          user_id: uid,
          added_by: session!.userId,
        })),
      );
      const ins = await supabaseAdmin
        .from("task_followers")
        .upsert(inserts, { onConflict: "task_id,user_id", ignoreDuplicates: true });
      if (ins.error) return { error: ins.error.message };
      rowsChanged += ins.count ?? inserts.length;
    }
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.bulk_reassign",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: {
      target: parsed.data.target,
      role: parsed.data.role ?? null,
      mode: parsed.data.mode,
      category_ids: parsed.data.category_ids,
      actor_ids: parsed.data.actor_ids,
      tasks_affected: taskIds.length,
      rows_changed: rowsChanged,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_BULK_REASSIGN",
    entityType: "project",
    entityId: parsed.data.project_id,
    payload: {
      target: parsed.data.target,
      role: parsed.data.role ?? null,
      mode: parsed.data.mode,
      tasks_affected: taskIds.length,
    },
    importance: "normal",
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true, tasks_affected: taskIds.length, rows_changed: rowsChanged };
}
