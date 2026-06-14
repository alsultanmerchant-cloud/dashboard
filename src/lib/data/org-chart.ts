import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type OrgEmployee = {
  id: string;
  user_id: string | null;
  full_name: string;
  job_title: string | null;
  email: string | null;
  position: string | null;
  department_id: string | null;
  manager_employee_id: string | null;
  // قائد الفريق — distinct from manager_employee_id (المدير). Edited on
  // /organization/employees. Used as the team-leader source on task cards.
  team_leader_employee_id: string | null;
  employment_status: string;
};

export type OrgDepartment = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: string;
  parent_department_id: string | null;
  head_employee_id: string | null;
  head?: OrgEmployee | null;
  teamLeads: OrgEmployee[];
  members: OrgEmployee[];
  children: OrgDepartment[];
};

export type OrgChart = {
  byId: Map<string, OrgDepartment>;
  roots: OrgDepartment[];
  employees: OrgEmployee[];
};

const KIND_ORDER: Record<string, number> = {
  account_management: 0,
  group: 1,
  main_section: 2,
  supporting_section: 3,
  quality_control: 4,
  other: 5,
};

const SALES_SLUGS = new Set(["sales", "tele-sales", "telesales"]);

/**
 * Pull the entire org graph in three queries, then assemble the tree in
 * memory. The dataset is tiny (≤30 depts, ≤200 employees), so this is well
 * under 100ms even with cold caches. Filtering of sales departments is done
 * by the caller (so the feature flag check happens at render-time).
 */
export async function loadOrgChart(orgId: string): Promise<OrgChart> {
  // Team leads are derived from employee_profiles.manager_employee_id:
  // an employee is a "team lead" in their department if anyone else in
  // the same department reports to them. /organization/employees is the
  // single source of truth for who-reports-to-whom — the old
  // department_team_leads table is no longer read.
  const [{ data: depts, error: deptErr }, { data: emps, error: empErr }] =
    await Promise.all([
      supabaseAdmin
        .from("departments")
        .select(
          "id, name, slug, description, kind, parent_department_id, head_employee_id",
        )
        .eq("organization_id", orgId),
      supabaseAdmin
        .from("employee_profiles")
        .select(
          "id, user_id, full_name, job_title, email, department_id, manager_employee_id, team_leader_employee_id, employment_status",
        )
        .eq("organization_id", orgId),
    ]);
  if (deptErr) throw deptErr;
  if (empErr) throw empErr;

  const rawEmployees: OrgEmployee[] = [];
  for (const raw of emps ?? []) {
    const e = raw as unknown as OrgEmployee & { position?: string | null };
    rawEmployees.push({
      id: e.id,
      user_id: e.user_id ?? null,
      full_name: e.full_name,
      job_title: e.job_title ?? null,
      email: e.email ?? null,
      department_id: e.department_id ?? null,
      manager_employee_id: e.manager_employee_id ?? null,
      team_leader_employee_id: e.team_leader_employee_id ?? null,
      employment_status: e.employment_status,
      position: e.position ?? null,
    });
  }

  // #8: collapse exact duplicate employees — the seed in migration 0043
  // inserted some people twice, so the chart rendered them as separate
  // nodes. Two rows are "the same person" when name + role + department all
  // match. Keep the row with a linked user account (and active status), and
  // remap any manager pointers from the dropped twin to the kept one so the
  // hierarchy stays intact.
  const dedupKey = (e: OrgEmployee) =>
    `${e.full_name.trim().toLowerCase()}|${e.position ?? ""}|${e.department_id ?? ""}`;
  const score = (e: OrgEmployee) =>
    (e.user_id ? 2 : 0) + (e.employment_status === "active" ? 1 : 0);
  const keptByKey = new Map<string, OrgEmployee>();
  for (const e of rawEmployees) {
    const k = dedupKey(e);
    const existing = keptByKey.get(k);
    if (!existing || score(e) > score(existing)) keptByKey.set(k, e);
  }
  const idRemap = new Map<string, string>(); // dropped employee id → kept id
  for (const e of rawEmployees) {
    const kept = keptByKey.get(dedupKey(e));
    if (kept && kept.id !== e.id) idRemap.set(e.id, kept.id);
  }
  const resolveId = (id: string | null): string | null =>
    id ? (idRemap.get(id) ?? id) : null;

  const empById = new Map<string, OrgEmployee>();
  const employees: OrgEmployee[] = [];
  for (const e of keptByKey.values()) {
    const norm: OrgEmployee = {
      ...e,
      manager_employee_id: resolveId(e.manager_employee_id),
      team_leader_employee_id: resolveId(e.team_leader_employee_id),
    };
    employees.push(norm);
    empById.set(norm.id, norm);
  }

  const byId = new Map<string, OrgDepartment>();
  for (const d of depts ?? []) {
    byId.set(d.id, {
      id: d.id,
      name: d.name,
      slug: d.slug,
      description: d.description ?? null,
      kind: (d as { kind: string }).kind,
      parent_department_id: d.parent_department_id ?? null,
      head_employee_id: d.head_employee_id ?? null,
      head: null,
      teamLeads: [],
      members: [],
      children: [],
    });
  }

  // Resolve heads via head_employee_id — through the dedup remap so a head
  // pointed at a dropped duplicate still resolves to the kept row.
  for (const dept of byId.values()) {
    if (dept.head_employee_id) {
      const headId = resolveId(dept.head_employee_id);
      dept.head_employee_id = headId;
      dept.head = headId ? empById.get(headId) ?? null : null;
    }
  }

  // Index: who reports to whom. An employee is considered a "team lead" of
  // their department if at least one other employee in the same department
  // has them as manager_employee_id.
  const reportsByManager = new Map<string, OrgEmployee[]>();
  for (const emp of employees) {
    if (!emp.manager_employee_id) continue;
    const arr = reportsByManager.get(emp.manager_employee_id) ?? [];
    arr.push(emp);
    reportsByManager.set(emp.manager_employee_id, arr);
  }

  // Place every employee with a department into head / teamLeads / members.
  for (const emp of employees) {
    if (!emp.department_id) continue;
    const dept = byId.get(emp.department_id);
    if (!dept) continue;
    if (dept.head?.id === emp.id) continue;
    const hasDeptReports = (reportsByManager.get(emp.id) ?? []).some(
      (r) => r.department_id === dept.id,
    );
    if (hasDeptReports) dept.teamLeads.push(emp);
    else dept.members.push(emp);
  }

  // Build child arrays + collect roots.
  const roots: OrgDepartment[] = [];
  for (const dept of byId.values()) {
    if (dept.parent_department_id) {
      const parent = byId.get(dept.parent_department_id);
      if (parent) {
        parent.children.push(dept);
        continue;
      }
    }
    roots.push(dept);
  }

  // Stable sort: kind first, then name (RTL-aware Arabic sort).
  const cmp = (a: OrgDepartment, b: OrgDepartment) => {
    const ka = KIND_ORDER[a.kind] ?? 99;
    const kb = KIND_ORDER[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return a.name.localeCompare(b.name, "ar");
  };
  roots.sort(cmp);
  for (const dept of byId.values()) {
    dept.children.sort(cmp);
    dept.teamLeads.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
    dept.members.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
  }

  return { byId, roots, employees };
}

export function isSalesDepartment(d: Pick<OrgDepartment, "slug">): boolean {
  return SALES_SLUGS.has(d.slug);
}

/**
 * Strip the sales subtree (Sales + Tele-Sales departments) from a chart.
 * Used when the `sales_track_enabled` feature flag is OFF.
 */
export function filterSalesSubtree(chart: OrgChart): OrgChart {
  const removed = new Set<string>();
  const walk = (d: OrgDepartment): boolean => {
    if (isSalesDepartment(d)) {
      removed.add(d.id);
      // Mark children too.
      const stack = [...d.children];
      while (stack.length) {
        const c = stack.pop()!;
        removed.add(c.id);
        stack.push(...c.children);
      }
      return true;
    }
    d.children = d.children.filter((c) => !walk(c));
    return false;
  };
  const roots = chart.roots.filter((r) => !walk(r));
  const byId = new Map(chart.byId);
  for (const id of removed) byId.delete(id);
  return { byId, roots, employees: chart.employees };
}
