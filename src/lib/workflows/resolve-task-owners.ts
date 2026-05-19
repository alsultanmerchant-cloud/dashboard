import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Resolves a task-template "owner" reference (a position slug, or a legacy
// bare role key) to a concrete employee for a generated task.
//
//   position slug  →  positions.role  →  employee
//
// The 7 structural roles resolve as follows:
//   account_manager           → the project's account manager
//   specialist                → the project's per-service specialist
//   manager                   → the head of the service's department
//   team_lead                 → the team leader of the service's specialist
//   agent / supporting_lead /  → the unique active employee in the service's
//   supporting_agent             department holding a position with that role
//
// Anything that doesn't resolve to exactly one employee is left unassigned
// (the caller simply skips it).

export type OwnerResolver = {
  /** Structural role for a stored slug/role key, or null if unknown. */
  roleOf: (slugOrRole: string) => string | null;
  /** Resolve a stored slug/role key to an employee id for a given service. */
  resolve: (slugOrRole: string, serviceId: string | null) => string | null;
  /** Extra people the operator pinned on a service — they join every task. */
  extrasFor: (serviceId: string | null) => { role: string; employeeId: string }[];
};

export async function buildOwnerResolver(args: {
  organizationId: string;
  projectId: string;
  serviceIds: string[];
  accountManagerEmployeeId?: string | null;
  /** service id → resolved specialist employee id (caller decides overrides). */
  specialistByServiceId: Map<string, string>;
  /** service id → department-head employee id. */
  deptHeadByServiceId: Map<string, string>;
}): Promise<OwnerResolver> {
  // 1. Position catalog → slug/role → structural role.
  const { data: positions } = await supabaseAdmin
    .from("positions")
    .select("id, slug, role")
    .eq("organization_id", args.organizationId);
  const roleBySlug = new Map<string, string>();
  const slugById = new Map<string, string>();
  for (const p of positions ?? []) {
    roleBySlug.set(p.slug, p.role);
    slugById.set(p.id, p.slug);
  }

  // 1b. The project's explicit team assignment (ServiceTeamPanel). This is
  //     the operator's choice and overrides org-chart resolution.
  //       teamMap:        `${serviceId}|${positionSlug}` → employee id
  //       extrasByService: serviceId → [{ role, employeeId }]
  const { data: teamRows } = await supabaseAdmin
    .from("project_service_team")
    .select("service_id, position_id, employee_id, is_extra")
    .eq("project_id", args.projectId);
  const teamMap = new Map<string, string>();
  const extrasByService = new Map<string, { role: string; employeeId: string }[]>();
  for (const row of teamRows ?? []) {
    const slug = slugById.get(row.position_id);
    if (!slug) continue;
    teamMap.set(`${row.service_id}|${slug}`, row.employee_id);
    if (row.is_extra) {
      const role = roleBySlug.get(slug);
      if (!role) continue;
      const list = extrasByService.get(row.service_id) ?? [];
      list.push({ role, employeeId: row.employee_id });
      extrasByService.set(row.service_id, list);
    }
  }

  // 2. service id → department id (for the supporting/agent dept lookup).
  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, default_department_id")
    .eq("organization_id", args.organizationId)
    .in("id", args.serviceIds.length ? args.serviceIds : ["00000000-0000-0000-0000-000000000000"]);
  const deptByServiceId = new Map<string, string>();
  for (const s of services ?? []) {
    if (s.default_department_id) deptByServiceId.set(s.id, s.default_department_id);
  }

  // 3. team leader of each service's specialist (for the team_lead role).
  const specialistIds = Array.from(new Set(args.specialistByServiceId.values()));
  const teamLeaderByEmployeeId = new Map<string, string | null>();
  if (specialistIds.length > 0) {
    const { data: specialists } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, team_leader_employee_id")
      .in("id", specialistIds);
    for (const e of specialists ?? []) {
      teamLeaderByEmployeeId.set(e.id, e.team_leader_employee_id ?? null);
    }
  }

  // 4. Department lookup index: deptId → role → employee ids. Used for the
  //    roles that have no single org-chart anchor (agent, supporting_*).
  const deptIds = Array.from(new Set(deptByServiceId.values()));
  const byDeptRole = new Map<string, string[]>(); // key = `${deptId}|${role}`
  if (deptIds.length > 0) {
    const { data: emps } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, department_id, position:positions!employee_profiles_position_id_fkey ( role )")
      .eq("organization_id", args.organizationId)
      .eq("employment_status", "active")
      .in("department_id", deptIds);
    for (const e of emps ?? []) {
      const pos = Array.isArray(e.position) ? e.position[0] : e.position;
      if (!e.department_id || !pos?.role) continue;
      const key = `${e.department_id}|${pos.role}`;
      const list = byDeptRole.get(key) ?? [];
      list.push(e.id);
      byDeptRole.set(key, list);
    }
  }

  const roleOf = (slugOrRole: string): string | null =>
    roleBySlug.get(slugOrRole) ?? null;

  const resolve = (slugOrRole: string, serviceId: string | null): string | null => {
    const role = roleBySlug.get(slugOrRole);
    if (!role) return null;
    // The operator's explicit project-team choice wins over org-chart defaults.
    if (serviceId) {
      const picked = teamMap.get(`${serviceId}|${slugOrRole}`);
      if (picked) return picked;
    }
    if (role === "account_manager") return args.accountManagerEmployeeId ?? null;
    if (role === "specialist") {
      return serviceId ? args.specialistByServiceId.get(serviceId) ?? null : null;
    }
    if (role === "manager") {
      return serviceId ? args.deptHeadByServiceId.get(serviceId) ?? null : null;
    }
    if (role === "team_lead") {
      const specialist = serviceId
        ? args.specialistByServiceId.get(serviceId) ?? null
        : null;
      return specialist
        ? teamLeaderByEmployeeId.get(specialist) ?? null
        : null;
    }
    // agent / supporting_lead / supporting_agent — department lookup. Assign
    // only when the department has exactly one employee holding that role.
    const deptId = serviceId ? deptByServiceId.get(serviceId) ?? null : null;
    if (!deptId) return null;
    const matches = byDeptRole.get(`${deptId}|${role}`) ?? [];
    return matches.length === 1 ? matches[0] : null;
  };

  const extrasFor = (serviceId: string | null) =>
    serviceId ? extrasByService.get(serviceId) ?? [] : [];

  return { roleOf, resolve, extrasFor };
}
