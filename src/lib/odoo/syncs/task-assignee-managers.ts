import { supabaseAdmin } from "@/lib/supabase/admin";

type ServiceKind = "social" | "media" | "seo" | null;
type RoleType = "agent" | "account_manager" | "manager" | "specialist";
type ProjectRoleContext = {
  project_manager_employee_id: string | null;
  social_specialist_id: string | null;
  media_specialist_id: string | null;
  seo_specialist_id: string | null;
  social_manager_id: string | null;
  media_manager_id: string | null;
  seo_manager_id: string | null;
};

function classifyServiceKind(input: {
  externalId: string | null;
  name: string | null;
  slug: string | null;
}): ServiceKind {
  const ext = input.externalId ? Number(input.externalId) : null;
  if (ext != null) {
    if (ext === 234 || ext === 158) return "social";
    if (ext === 134 || ext === 69) return "media";
    if (ext === 235 || ext === 71) return "seo";
  }

  const haystack = `${input.name ?? ""} ${input.slug ?? ""}`.toLowerCase();
  if (
    haystack.includes("social") ||
    haystack.includes("سوشيال") ||
    haystack.includes("التواصل")
  ) return "social";
  if (
    haystack.includes("media") ||
    haystack.includes("ممولة") ||
    haystack.includes("إعلانات") ||
    haystack.includes("ads")
  ) return "media";
  if (
    haystack.includes("seo") ||
    haystack.includes("سيو") ||
    haystack.includes("تحسين")
  ) return "seo";
  return null;
}

function resolveLegacyTeamManagerEmployeeId(input: {
  roleType: RoleType;
  assigneeEmployeeId: string;
  serviceKind: ServiceKind;
  project: ProjectRoleContext;
}): string | null {
  const projectManager = input.project.project_manager_employee_id ?? null;
  const preferManager = (candidate: string | null): string | null => {
    if (candidate && candidate !== input.assigneeEmployeeId) return candidate;
    if (projectManager && projectManager !== input.assigneeEmployeeId) return projectManager;
    return null;
  };
  if (input.roleType === "account_manager" || input.roleType === "manager") {
    return preferManager(projectManager);
  }

  if (input.serviceKind === "social") {
    return preferManager(input.project.social_manager_id);
  }
  if (input.serviceKind === "media") {
    return preferManager(input.project.media_manager_id);
  }
  if (input.serviceKind === "seo") {
    return preferManager(input.project.seo_manager_id);
  }

  if (input.assigneeEmployeeId === input.project.social_specialist_id) {
    return preferManager(input.project.social_manager_id);
  }
  if (input.assigneeEmployeeId === input.project.media_specialist_id) {
    return preferManager(input.project.media_manager_id);
  }
  if (input.assigneeEmployeeId === input.project.seo_specialist_id) {
    return preferManager(input.project.seo_manager_id);
  }

  return preferManager(projectManager);
}

function resolveTeamManagerEmployeeId(input: {
  roleType: RoleType;
  assigneeEmployeeId: string;
  assigneeManagerEmployeeId: string | null;
  serviceKind: ServiceKind;
  project: ProjectRoleContext;
}): string | null {
  if (
    input.assigneeManagerEmployeeId &&
    input.assigneeManagerEmployeeId !== input.assigneeEmployeeId
  ) {
    return input.assigneeManagerEmployeeId;
  }
  return resolveLegacyTeamManagerEmployeeId(input);
}

async function cleanupAccountManagerAgentDuplicates(
  orgId: string,
  log: boolean,
): Promise<number> {
  const PAGE = 5000;
  const rows: Array<{
    id: string;
    task_id: string;
    employee_id: string;
    role_type: RoleType;
  }> = [];
  for (let from = 0;; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("task_assignees")
      .select("id, task_id, employee_id, role_type")
      .eq("organization_id", orgId)
      .in("role_type", ["agent", "account_manager"])
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as typeof rows));
    if (data.length < PAGE) break;
  }

  const byTaskEmployee = new Map<string, Array<{
    id: string;
    role_type: RoleType;
  }>>();
  for (const row of rows) {
    const key = `${row.task_id}:${row.employee_id}`;
    const arr = byTaskEmployee.get(key) ?? [];
    arr.push({ id: row.id, role_type: row.role_type });
    byTaskEmployee.set(key, arr);
  }

  const agentIdsToDelete: string[] = [];
  for (const group of byTaskEmployee.values()) {
    const hasAM = group.some((row) => row.role_type === "account_manager");
    if (!hasAM) continue;
    for (const row of group) {
      if (row.role_type === "agent") agentIdsToDelete.push(row.id);
    }
  }

  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < agentIdsToDelete.length; i += BATCH) {
    const slice = agentIdsToDelete.slice(i, i + BATCH);
    const { error } = await supabaseAdmin
      .from("task_assignees")
      .delete()
      .in("id", slice);
    if (error) throw error;
    deleted += slice.length;
  }

  if (log) {
    console.log(`[task-assignee-managers] deduped agent/account_manager collisions: ${deleted}`);
  }
  return deleted;
}

export type TaskAssigneeManagersSyncResult = {
  updated: number;
  skipped: number;
};

export async function syncTaskAssigneeManagers(
  orgSlug: string,
  opts: { log?: boolean } = {},
): Promise<TaskAssigneeManagersSyncResult> {
  const log = opts.log ?? false;
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();
  if (!org) throw new Error(`org ${orgSlug} not found`);
  const orgId = org.id as string;

  const { data: projects, error: projectsErr } = await supabaseAdmin
    .from("projects")
    .select(
      "id, project_manager_employee_id, social_specialist_id, media_specialist_id, seo_specialist_id, social_manager_id, media_manager_id, seo_manager_id",
    )
    .eq("organization_id", orgId);
  if (projectsErr) throw projectsErr;
  const projectById = new Map(
    (projects ?? []).map((p) => [p.id as string, p]),
  );

  const { data: employees, error: employeesErr } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, manager_employee_id")
    .eq("organization_id", orgId);
  if (employeesErr) throw employeesErr;
  const employeeManagerById = new Map(
    (employees ?? []).map((row) => [
      row.id as string,
      (row.manager_employee_id as string | null) ?? null,
    ]),
  );

  const { data: services, error: servicesErr } = await supabaseAdmin
    .from("services")
    .select("id, external_id, name, slug")
    .eq("organization_id", orgId);
  if (servicesErr) throw servicesErr;
  const serviceKindById = new Map<string, ServiceKind>();
  for (const s of services ?? []) {
    serviceKindById.set(
      s.id as string,
      classifyServiceKind({
        externalId: (s.external_id as string | null) ?? null,
        name: (s.name as string | null) ?? null,
        slug: (s.slug as string | null) ?? null,
      }),
    );
  }

  const PAGE = 1000;
  let updated = 0;
  let skipped = 0;

  await cleanupAccountManagerAgentDuplicates(orgId, log);

  for (let from = 0;; from += PAGE) {
    const { data: rows, error } = await supabaseAdmin
      .from("task_assignees")
      .select(
        "id, employee_id, role_type, team_manager_employee_id, task:tasks!task_assignees_task_id_fkey(id, organization_id, external_source, project_id, service_id)",
      )
      .eq("organization_id", orgId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;

    const updatesByManager = new Map<string, string[]>();
    for (const row of rows as Array<{
      id: string;
      employee_id: string;
      role_type: "agent" | "account_manager" | "manager" | "specialist";
      team_manager_employee_id: string | null;
      task:
        | {
            id: string;
            organization_id: string;
            external_source: string | null;
            project_id: string;
            service_id: string | null;
          }
        | {
            id: string;
            organization_id: string;
            external_source: string | null;
            project_id: string;
            service_id: string | null;
          }[]
        | null;
    }>) {
      const task = Array.isArray(row.task) ? row.task[0] : row.task;
      if (!task) {
        skipped++;
        continue;
      }
      const project = projectById.get(task.project_id);
      if (!project) {
        skipped++;
        continue;
      }

      const projectContext: ProjectRoleContext = {
        project_manager_employee_id: (project.project_manager_employee_id as string | null) ?? null,
        social_specialist_id: (project.social_specialist_id as string | null) ?? null,
        media_specialist_id: (project.media_specialist_id as string | null) ?? null,
        seo_specialist_id: (project.seo_specialist_id as string | null) ?? null,
        social_manager_id: (project.social_manager_id as string | null) ?? null,
        media_manager_id: (project.media_manager_id as string | null) ?? null,
        seo_manager_id: (project.seo_manager_id as string | null) ?? null,
      };
      const legacyManagerId = resolveLegacyTeamManagerEmployeeId({
        roleType: row.role_type,
        assigneeEmployeeId: row.employee_id,
        serviceKind: task.service_id ? (serviceKindById.get(task.service_id) ?? null) : null,
        project: projectContext,
      });
      const managerId = resolveTeamManagerEmployeeId({
        roleType: row.role_type,
        assigneeEmployeeId: row.employee_id,
        assigneeManagerEmployeeId: employeeManagerById.get(row.employee_id) ?? null,
        serviceKind: task.service_id ? (serviceKindById.get(task.service_id) ?? null) : null,
        project: projectContext,
      });
      const currentManagerId = row.team_manager_employee_id ?? null;
      const shouldUpdate =
        Boolean(managerId) &&
        managerId !== row.employee_id &&
        (
          currentManagerId === null ||
          currentManagerId === legacyManagerId
        ) &&
        currentManagerId !== managerId;
      if (!shouldUpdate || !managerId) {
        skipped++;
        continue;
      }

      const arr = updatesByManager.get(managerId) ?? [];
      arr.push(row.id);
      updatesByManager.set(managerId, arr);
    }

    if (updatesByManager.size > 0) {
      const BATCH = 500;
      for (const [managerId, rowIds] of updatesByManager) {
        for (let i = 0; i < rowIds.length; i += BATCH) {
          const slice = rowIds.slice(i, i + BATCH);
          const { error: updateErr } = await supabaseAdmin
            .from("task_assignees")
            .update({ team_manager_employee_id: managerId })
            .in("id", slice);
          if (updateErr) {
            if (log) console.warn(`[task-assignee-managers] batch ${managerId}:${i}: ${updateErr.message}`);
            skipped += slice.length;
          } else {
            updated += slice.length;
          }
        }
      }
    }

    if (rows.length < PAGE) break;
  }

  if (log) {
    console.log(`[task-assignee-managers] DONE — updated=${updated}, skipped=${skipped}`);
  }
  return { updated, skipped };
}
