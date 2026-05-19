"use server";

// Multi-assignee management for the task detail page.
//
// task_assignees was originally one row per (task, role_type). Migration 0097
// lifts that and allows many people per role, each with an optional per-task
// team_manager_employee_id. STAGE_EXIT_ROLE gating (.some matches) is
// unaffected — any matching assignee still satisfies the gate.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent, createNotification } from "@/lib/audit";

const ROLE_TYPES = ["specialist", "manager", "agent", "account_manager"] as const;
type RoleType = (typeof ROLE_TYPES)[number];

const AddSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  employee_id: z.string().uuid({ message: "معرف الموظف غير صالح" }),
  role_type: z.enum(ROLE_TYPES, { message: "دور غير صالح" }),
  team_manager_employee_id: z.string().uuid().nullable().optional(),
  head_of_dept_employee_id: z.string().uuid().nullable().optional(),
});

const UpdateManagerSchema = z.object({
  assignee_id: z.string().uuid(),
  team_manager_employee_id: z.string().uuid().nullable(),
  apply_globally: z.boolean().optional(),
});

const UpdateHodSchema = z.object({
  assignee_id: z.string().uuid(),
  head_of_dept_employee_id: z.string().uuid().nullable(),
  apply_globally: z.boolean().optional(),
});

const RemoveSchema = z.object({
  assignee_id: z.string().uuid(),
});

async function authorizeTaskManage(taskId: string) {
  const session = await requirePermission("tasks.view");
  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, title, task_code, created_by, project_id, project:projects!tasks_project_id_fkey(name)")
    .eq("organization_id", session.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!task) throw new Error("المهمة غير موجودة");
  const canManage =
    task.created_by === session.userId ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) throw new Error("لا تملك صلاحية إدارة المشاركين");
  return { session, task };
}

export async function addTaskAssigneeAction(input: {
  taskId: string;
  employeeId: string;
  roleType: RoleType;
  teamManagerEmployeeId?: string | null;
  headOfDeptEmployeeId?: string | null;
}): Promise<{ ok: true; assigneeId: string } | { error: string }> {
  const parsed = AddSchema.safeParse({
    task_id: input.taskId,
    employee_id: input.employeeId,
    role_type: input.roleType,
    team_manager_employee_id: input.teamManagerEmployeeId ?? null,
    head_of_dept_employee_id: input.headOfDeptEmployeeId ?? null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  let auth;
  try {
    auth = await authorizeTaskManage(parsed.data.task_id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { session, task } = auth;

  // Verify the employee + (optional) manager belong to this org.
  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, user_id")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.employee_id)
    .maybeSingle();
  if (!emp) return { error: "الموظف غير موجود" };

  if (parsed.data.team_manager_employee_id) {
    const { data: mgr } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("id", parsed.data.team_manager_employee_id)
      .maybeSingle();
    if (!mgr) return { error: "قائد الفريق غير موجود في هذه المنظمة" };
  }

  if (parsed.data.head_of_dept_employee_id) {
    const { data: hod } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("id", parsed.data.head_of_dept_employee_id)
      .maybeSingle();
    if (!hod) return { error: "رئيس القسم غير موجود في هذه المنظمة" };
  }

  const conflictingRole =
    parsed.data.role_type === "agent"
      ? "account_manager"
      : parsed.data.role_type === "account_manager"
        ? "agent"
        : null;
  if (conflictingRole) {
    const { data: conflict } = await supabaseAdmin
      .from("task_assignees")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("task_id", parsed.data.task_id)
      .eq("employee_id", parsed.data.employee_id)
      .eq("role_type", conflictingRole)
      .maybeSingle();
    if (conflict) {
      return {
        error:
          conflictingRole === "account_manager"
            ? "هذا الموظف مُسنَد بالفعل كمدير حساب على هذه المهمة"
            : "هذا الموظف مُسنَد بالفعل كمنفذ على هذه المهمة",
      };
    }
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("task_assignees")
    .insert({
      organization_id: session.orgId,
      task_id: parsed.data.task_id,
      employee_id: parsed.data.employee_id,
      role_type: parsed.data.role_type,
      team_manager_employee_id: parsed.data.team_manager_employee_id ?? null,
      head_of_dept_employee_id: parsed.data.head_of_dept_employee_id ?? null,
      assigned_by: session.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { error: "هذا الموظف مُسنَد بهذا الدور بالفعل" };
    }
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.assignee_add",
    entityType: "task",
    entityId: parsed.data.task_id,
    metadata: {
      employee_id: parsed.data.employee_id,
      role_type: parsed.data.role_type,
      team_manager_employee_id: parsed.data.team_manager_employee_id ?? null,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_ASSIGNEE_ADDED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {
      task_title: task.title,
      employee_id: parsed.data.employee_id,
      role_type: parsed.data.role_type,
    },
    importance: "normal",
  });

  // Notify the new assignee.
  if (emp.user_id) {
    const proj = Array.isArray(task.project) ? task.project[0] : task.project;
    await createNotification({
      organizationId: session.orgId,
      recipientUserId: emp.user_id,
      recipientEmployeeId: emp.id,
      type: "TASK_ASSIGNED",
      title: `${session.fullName} أسندك على مهمة`,
      body: `«${proj?.name ?? "—"}» — ${task.task_code ? task.task_code + " " : ""}${task.title ?? ""}`.trim(),
      entityType: "task",
      entityId: parsed.data.task_id,
    });
  }

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  if (task.project_id) revalidatePath(`/projects/${task.project_id}`);
  return { ok: true, assigneeId: inserted.id };
}

export async function removeTaskAssigneeAction(input: {
  assigneeId: string;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = RemoveSchema.safeParse({ assignee_id: input.assigneeId });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const session = await requirePermission("tasks.view").catch(() => null);
  if (!session) return { error: "غير مصرح" };

  const { data: row } = await supabaseAdmin
    .from("task_assignees")
    .select("id, task_id, employee_id, role_type, organization_id, task:tasks!task_assignees_task_id_fkey(id, created_by, project_id, title)")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.assignee_id)
    .maybeSingle();
  if (!row) return { error: "السجل غير موجود" };

  const taskRow = Array.isArray(row.task) ? row.task[0] : row.task;
  const canManage =
    taskRow?.created_by === session.userId ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) return { error: "لا تملك صلاحية الإزالة" };

  // Block removing the last assignee — every task must keep ≥1 assignee.
  const { count } = await supabaseAdmin
    .from("task_assignees")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", session.orgId)
    .eq("task_id", row.task_id);
  if ((count ?? 0) <= 1) {
    return { error: "يجب أن يبقى مُسنَد واحد على الأقل" };
  }

  const { error } = await supabaseAdmin
    .from("task_assignees")
    .delete()
    .eq("id", parsed.data.assignee_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.assignee_remove",
    entityType: "task",
    entityId: row.task_id,
    metadata: {
      employee_id: row.employee_id,
      role_type: row.role_type,
    },
  });

  revalidatePath(`/tasks/${row.task_id}`);
  if (taskRow?.project_id) revalidatePath(`/projects/${taskRow.project_id}`);
  return { ok: true };
}

export async function setAssigneeTeamManagerAction(input: {
  assigneeId: string;
  teamManagerEmployeeId: string | null;
  applyGlobally?: boolean;
}): Promise<{ ok: true; appliedGlobally: boolean } | { error: string }> {
  const parsed = UpdateManagerSchema.safeParse({
    assignee_id: input.assigneeId,
    team_manager_employee_id: input.teamManagerEmployeeId,
    apply_globally: input.applyGlobally ?? false,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const session = await requirePermission("tasks.view").catch(() => null);
  if (!session) return { error: "غير مصرح" };

  const { data: row } = await supabaseAdmin
    .from("task_assignees")
    .select("id, task_id, employee_id, task:tasks!task_assignees_task_id_fkey(created_by, project_id)")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.assignee_id)
    .maybeSingle();
  if (!row) return { error: "السجل غير موجود" };

  const taskRow = Array.isArray(row.task) ? row.task[0] : row.task;
  const canManage =
    taskRow?.created_by === session.userId ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) return { error: "لا تملك صلاحية التعديل" };

  // Applying globally also writes the org-chart record on employee_profiles,
  // which is a higher-blast-radius operation gated by org.manage_structure.
  if (parsed.data.apply_globally && !hasPermission(session, "org.manage_structure")) {
    return { error: "لا تملك صلاحية تعديل الهيكل التنظيمي" };
  }

  if (parsed.data.team_manager_employee_id) {
    const { data: mgr } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("id", parsed.data.team_manager_employee_id)
      .maybeSingle();
    if (!mgr) return { error: "قائد الفريق غير موجود" };
  }

  // Self-reference guard for global writes (an employee can't be their own
  // direct manager in /organization/employees).
  if (
    parsed.data.apply_globally &&
    parsed.data.team_manager_employee_id === row.employee_id
  ) {
    return { error: "لا يمكن أن يكون الموظف مديرًا لنفسه" };
  }

  const { error } = await supabaseAdmin
    .from("task_assignees")
    .update({ team_manager_employee_id: parsed.data.team_manager_employee_id })
    .eq("id", parsed.data.assignee_id);
  if (error) return { error: error.message };

  if (parsed.data.apply_globally) {
    const { error: globalErr } = await supabaseAdmin
      .from("employee_profiles")
      .update({ manager_employee_id: parsed.data.team_manager_employee_id })
      .eq("organization_id", session.orgId)
      .eq("id", row.employee_id);
    if (globalErr) return { error: globalErr.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: parsed.data.apply_globally
      ? "task.assignee_manager_set_global"
      : "task.assignee_manager_set",
    entityType: "task",
    entityId: row.task_id,
    metadata: {
      assignee_id: parsed.data.assignee_id,
      employee_id: row.employee_id,
      team_manager_employee_id: parsed.data.team_manager_employee_id,
      apply_globally: parsed.data.apply_globally,
    },
  });

  revalidatePath(`/tasks/${row.task_id}`);
  if (parsed.data.apply_globally) {
    revalidatePath("/organization/employees");
    revalidatePath("/organization/chart");
  }
  return { ok: true, appliedGlobally: parsed.data.apply_globally };
}

export async function setAssigneeHeadOfDeptAction(input: {
  assigneeId: string;
  headOfDeptEmployeeId: string | null;
  applyGlobally?: boolean;
}): Promise<{ ok: true; appliedGlobally: boolean } | { error: string }> {
  const parsed = UpdateHodSchema.safeParse({
    assignee_id: input.assigneeId,
    head_of_dept_employee_id: input.headOfDeptEmployeeId,
    apply_globally: input.applyGlobally ?? false,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const session = await requirePermission("tasks.view").catch(() => null);
  if (!session) return { error: "غير مصرح" };

  const { data: row } = await supabaseAdmin
    .from("task_assignees")
    .select("id, task_id, employee_id, task:tasks!task_assignees_task_id_fkey(created_by, project_id)")
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.assignee_id)
    .maybeSingle();
  if (!row) return { error: "السجل غير موجود" };

  const taskRow = Array.isArray(row.task) ? row.task[0] : row.task;
  const canManage =
    taskRow?.created_by === session.userId ||
    hasPermission(session, "tasks.manage") ||
    hasPermission(session, "task.view_all");
  if (!canManage) return { error: "لا تملك صلاحية التعديل" };

  // Applying globally rewrites departments.head_employee_id which affects
  // EVERYONE in that department — gated by org.manage_structure.
  if (parsed.data.apply_globally && !hasPermission(session, "org.manage_structure")) {
    return { error: "لا تملك صلاحية تعديل الهيكل التنظيمي" };
  }

  if (parsed.data.head_of_dept_employee_id) {
    const { data: hod } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("id", parsed.data.head_of_dept_employee_id)
      .maybeSingle();
    if (!hod) return { error: "رئيس القسم غير موجود" };
  }

  // Resolve the assignee's department for the global write.
  let assigneeDeptId: string | null = null;
  if (parsed.data.apply_globally) {
    const { data: emp } = await supabaseAdmin
      .from("employee_profiles")
      .select("department_id")
      .eq("organization_id", session.orgId)
      .eq("id", row.employee_id)
      .maybeSingle();
    assigneeDeptId = emp?.department_id ?? null;
    if (!assigneeDeptId) {
      return { error: "الموظف غير مرتبط بقسم — لا يمكن تطبيق التغيير على الهيكل التنظيمي" };
    }
  }

  const { error } = await supabaseAdmin
    .from("task_assignees")
    .update({ head_of_dept_employee_id: parsed.data.head_of_dept_employee_id })
    .eq("id", parsed.data.assignee_id);
  if (error) return { error: error.message };

  if (parsed.data.apply_globally && assigneeDeptId) {
    const { error: globalErr } = await supabaseAdmin
      .from("departments")
      .update({ head_employee_id: parsed.data.head_of_dept_employee_id })
      .eq("organization_id", session.orgId)
      .eq("id", assigneeDeptId);
    if (globalErr) return { error: globalErr.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: parsed.data.apply_globally
      ? "task.assignee_hod_set_global"
      : "task.assignee_hod_set",
    entityType: "task",
    entityId: row.task_id,
    metadata: {
      assignee_id: parsed.data.assignee_id,
      employee_id: row.employee_id,
      head_of_dept_employee_id: parsed.data.head_of_dept_employee_id,
      department_id: assigneeDeptId,
      apply_globally: parsed.data.apply_globally,
    },
  });

  revalidatePath(`/tasks/${row.task_id}`);
  if (parsed.data.apply_globally) {
    revalidatePath("/organization/departments");
    revalidatePath("/organization/chart");
  }
  return { ok: true, appliedGlobally: parsed.data.apply_globally };
}

// =========================================================================
// Per-stage owner positions on a single task (migration 0077).
//
// task_template_items carry a stage_owner_positions map that generate-tasks
// copies onto each task. Templates expose an editor; tasks were read-only.
// This lets a manager override the role responsible for each of the 8
// stages on one specific task without touching the template.
// =========================================================================

const STAGE_KEYS = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
] as const;

const TaskStageOwnerSchema = z.object({
  task_id: z.string().uuid({ message: "معرف المهمة غير صالح" }),
  // Values are position slugs from the org catalog; the combobox constrains
  // the input, so a light string check is enough here.
  mapping: z.record(
    z.string(),
    z.union([z.string().trim().max(64), z.null()]),
  ),
});

export async function updateTaskStageOwnerPositionsAction(input: {
  taskId: string;
  mapping: Record<string, string | null>;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = TaskStageOwnerSchema.safeParse({
    task_id: input.taskId,
    mapping: input.mapping,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  let auth;
  try {
    auth = await authorizeTaskManage(parsed.data.task_id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { session, task } = auth;

  // Keep only known stage keys so the JSON stays tidy.
  const cleaned: Record<string, string | null> = {};
  for (const stage of STAGE_KEYS) {
    cleaned[stage] = parsed.data.mapping[stage] ?? null;
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ stage_owner_positions: cleaned })
    .eq("id", parsed.data.task_id)
    .eq("organization_id", session.orgId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.update_stage_owners",
    entityType: "task",
    entityId: task.id,
    metadata: { mapping: cleaned },
  });

  revalidatePath(`/tasks/${task.id}`);
  return { ok: true };
}
