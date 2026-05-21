import "server-only";
// Live recompute of role-slot assignees on a project's open tasks. Mirrors
// the resolver logic in generate-tasks.ts but runs against current rules
// instead of the snapshot taken at project creation. Use this when the
// operator changes a project specialist, an account manager, a per-service
// team pin, or a position-table rule, and wants existing tasks to reflect
// the new owner without waiting for the next Odoo sync.
//
// Behaviour:
//   - Touches only tasks whose stage is NOT a terminal stage (so historical
//     records stay frozen).
//   - For each task, recomputes the desired (role_type → employee_id) map
//     and reconciles task_assignees:
//       • inserts missing role→employee rows
//       • updates rows where the employee changed
//       • deletes role rows the rule no longer produces
//   - Only touches the 7 structural role_type values the resolver knows
//     about. Any other role_type rows (e.g. ad-hoc 'agent' adds by the
//     bulk-reassign dialog) are left intact.
//
// This function is the building block — wire it into server actions that
// mutate project specialists / project_service_team / positions /
// employee_profiles.position so the cascade is automatic. It is also safe
// to call directly from a "Recompute team" button on the project page.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildOwnerResolver } from "./resolve-task-owners";

const STRUCTURAL_ROLES = new Set([
  "account_manager",
  "specialist",
  "manager",
  "team_lead",
  "agent",
  "supporting_lead",
  "supporting_agent",
]);

// Stages we treat as "still open" for the recompute. Anything else
// (completed/done/archived) keeps its historical assignees.
const OPEN_STAGE_PREDICATE = (stage: string | null): boolean => {
  if (!stage) return true;
  const terminal = new Set(["done", "completed", "archived", "cancelled"]);
  return !terminal.has(stage);
};

export type RecomputeResult = {
  taskCount: number;
  inserted: number;
  updated: number;
  deleted: number;
};

export async function recomputeProjectTeam(args: {
  projectId: string;
  organizationId: string;
  /** Optional — if provided, written into task_assignees.assigned_by on changes. */
  actorUserId?: string | null;
}): Promise<RecomputeResult> {
  const { projectId, organizationId } = args;

  // 1. Load the project's team config + service ids.
  const { data: project, error: projectErr } = await supabaseAdmin
    .from("projects")
    .select(
      "id, account_manager_employee_id, social_specialist_employee_id, media_specialist_employee_id, seo_specialist_employee_id, project_services:project_services!project_services_project_id_fkey ( service_id, service:services!project_services_service_id_fkey ( id, slug, default_department_id ) )",
    )
    .eq("organization_id", organizationId)
    .eq("id", projectId)
    .maybeSingle();
  if (projectErr || !project) {
    throw new Error(`recomputeProjectTeam: project not found (${projectErr?.message ?? "no row"})`);
  }

  type PsRow = {
    service_id: string;
    service:
      | { id: string; slug: string | null; default_department_id: string | null }
      | { id: string; slug: string | null; default_department_id: string | null }[]
      | null;
  };
  const projectServices = (project.project_services ?? []) as PsRow[];
  const serviceIds = projectServices.map((ps) => ps.service_id);
  if (serviceIds.length === 0) {
    return { taskCount: 0, inserted: 0, updated: 0, deleted: 0 };
  }

  // 2. Resolve specialist + dept-head per service the same way the form does.
  //    Per-service specialist: project.{slug}_specialist_employee_id if the
  //    service slug matches social/media/seo; otherwise null.
  const specialistByServiceId = new Map<string, string>();
  for (const ps of projectServices) {
    const svc = Array.isArray(ps.service) ? ps.service[0] : ps.service;
    if (!svc) continue;
    const slug = (svc.slug ?? "").toLowerCase();
    const employeeId =
      slug.includes("social")
        ? project.social_specialist_employee_id
        : slug.includes("media")
        ? project.media_specialist_employee_id
        : slug.includes("seo")
        ? project.seo_specialist_employee_id
        : null;
    if (employeeId) specialistByServiceId.set(ps.service_id, employeeId);
  }

  const deptIds = Array.from(
    new Set(
      projectServices
        .map((ps) => (Array.isArray(ps.service) ? ps.service[0] : ps.service)?.default_department_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const deptHeadByServiceId = new Map<string, string>();
  if (deptIds.length > 0) {
    const { data: depts } = await supabaseAdmin
      .from("departments")
      .select("id, head_employee_id")
      .in("id", deptIds);
    const headByDept = new Map<string, string>();
    for (const d of depts ?? []) {
      if (d.head_employee_id) headByDept.set(d.id as string, d.head_employee_id as string);
    }
    for (const ps of projectServices) {
      const svc = Array.isArray(ps.service) ? ps.service[0] : ps.service;
      const deptId = svc?.default_department_id;
      if (!deptId) continue;
      const head = headByDept.get(deptId);
      if (head) deptHeadByServiceId.set(ps.service_id, head);
    }
  }

  // 3. Build the resolver.
  const resolver = await buildOwnerResolver({
    organizationId,
    projectId,
    serviceIds,
    accountManagerEmployeeId: project.account_manager_employee_id ?? null,
    specialistByServiceId,
    deptHeadByServiceId,
  });

  // 4. Load open tasks for this project with the metadata the resolver needs.
  const { data: tasks, error: tasksErr } = await supabaseAdmin
    .from("tasks")
    .select("id, service_id, stage, stage_owner_positions")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId);
  if (tasksErr) {
    throw new Error(`recomputeProjectTeam: load tasks failed: ${tasksErr.message}`);
  }
  const openTasks = (tasks ?? []).filter((t) =>
    OPEN_STAGE_PREDICATE(t.stage as string | null),
  );
  if (openTasks.length === 0) {
    return { taskCount: 0, inserted: 0, updated: 0, deleted: 0 };
  }

  // 5. Compute desired (task_id → role → employee_id) map.
  type Desired = Map<string, Map<string, string>>;
  const desired: Desired = new Map();
  for (const task of openTasks) {
    const slugs = new Set<string>(["account_manager", "specialist"]);
    const sop = (task.stage_owner_positions ?? null) as
      | Record<string, string | null>
      | null;
    if (sop) {
      for (const v of Object.values(sop)) if (v) slugs.add(v);
    }
    const roleToEmp = new Map<string, string>();
    for (const slug of slugs) {
      const role = resolver.roleOf(slug);
      if (!role || roleToEmp.has(role)) continue;
      const employeeId = resolver.resolve(slug, task.service_id as string | null);
      if (employeeId) roleToEmp.set(role, employeeId);
    }
    for (const ex of resolver.extrasFor(task.service_id as string | null)) {
      if (!roleToEmp.has(ex.role)) roleToEmp.set(ex.role, ex.employeeId);
    }
    desired.set(task.id as string, roleToEmp);
  }

  // 6. Load current task_assignees for these tasks and diff.
  const taskIds = Array.from(desired.keys());
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("task_assignees")
    .select("id, task_id, role_type, employee_id")
    .in("task_id", taskIds);
  if (existingErr) {
    throw new Error(`recomputeProjectTeam: load assignees failed: ${existingErr.message}`);
  }
  type Existing = {
    id: string;
    task_id: string;
    role_type: string;
    employee_id: string;
  };
  const byTaskRole = new Map<string, Existing>();
  for (const row of (existing ?? []) as Existing[]) {
    if (!STRUCTURAL_ROLES.has(row.role_type)) continue;
    byTaskRole.set(`${row.task_id}|${row.role_type}`, row);
  }

  const toInsert: Array<{
    organization_id: string;
    task_id: string;
    employee_id: string;
    role_type: string;
    assigned_by: string | null;
  }> = [];
  const toUpdate: Array<{ id: string; employee_id: string }> = [];
  const toDelete: string[] = [];

  for (const [taskId, roleToEmp] of desired) {
    // Update / insert each desired (role → emp).
    for (const [role, empId] of roleToEmp) {
      const key = `${taskId}|${role}`;
      const current = byTaskRole.get(key);
      if (!current) {
        toInsert.push({
          organization_id: organizationId,
          task_id: taskId,
          employee_id: empId,
          role_type: role,
          assigned_by: args.actorUserId ?? null,
        });
      } else if (current.employee_id !== empId) {
        toUpdate.push({ id: current.id, employee_id: empId });
      }
      byTaskRole.delete(key); // mark as accounted for
    }
  }

  // Any structural-role rows left unaccounted for: the resolver no longer
  // produces an assignment for them on this task → delete.
  for (const row of byTaskRole.values()) {
    toDelete.push(row.id);
  }

  // 7. Execute writes.
  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin
      .from("task_assignees")
      .insert(toInsert);
    if (error) {
      throw new Error(`recomputeProjectTeam: insert failed: ${error.message}`);
    }
  }
  for (const u of toUpdate) {
    const { error } = await supabaseAdmin
      .from("task_assignees")
      .update({ employee_id: u.employee_id, assigned_by: args.actorUserId ?? null })
      .eq("id", u.id);
    if (error) {
      throw new Error(`recomputeProjectTeam: update failed: ${error.message}`);
    }
  }
  if (toDelete.length > 0) {
    const { error } = await supabaseAdmin
      .from("task_assignees")
      .delete()
      .in("id", toDelete);
    if (error) {
      throw new Error(`recomputeProjectTeam: delete failed: ${error.message}`);
    }
  }

  return {
    taskCount: openTasks.length,
    inserted: toInsert.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
  };
}
