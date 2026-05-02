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
  const [{ data: depts, error: deptErr }, { data: emps, error: empErr }, { data: leads, error: leadsErr }] =
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
          "id, user_id, full_name, job_title, email, department_id, employment_status",
        )
        .eq("organization_id", orgId),
      supabaseAdmin
        .from("department_team_leads")
        .select("department_id, user_id"),
    ]);
  if (deptErr) throw deptErr;
  if (empErr) throw empErr;
  if (leadsErr) throw leadsErr;

  // employee_profiles.position lives on the same table (added in migration
  // 0021). The Supabase type-gen may lag behind the DB so we widen here.
  const empByUserId = new Map<string, OrgEmployee>();
  const empById = new Map<string, OrgEmployee>();
  const employees: OrgEmployee[] = [];
  for (const raw of emps ?? []) {
    const e = raw as unknown as OrgEmployee & { position?: string | null };
    const norm: OrgEmployee = {
      id: e.id,
      user_id: e.user_id ?? null,
      full_name: e.full_name,
      job_title: e.job_title ?? null,
      email: e.email ?? null,
      department_id: e.department_id ?? null,
      employment_status: e.employment_status,
      position: e.position ?? null,
    };
    employees.push(norm);
    if (norm.user_id) empByUserId.set(norm.user_id, norm);
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

  // Resolve heads via head_employee_id (the canonical FK to
  // employee_profiles.id, mirroring the existing manager_employee_id pattern).
  for (const dept of byId.values()) {
    if (dept.head_employee_id) {
      dept.head = empById.get(dept.head_employee_id) ?? null;
    }
  }

  // Team leads.
  for (const row of leads ?? []) {
    const dept = byId.get(row.department_id);
    if (!dept) continue;
    const emp = empByUserId.get(row.user_id);
    if (emp) dept.teamLeads.push(emp);
  }

  // Members = everyone whose department_id matches AND who isn't already
  // surfaced as the head or a team lead.
  for (const emp of employees) {
    if (!emp.department_id) continue;
    const dept = byId.get(emp.department_id);
    if (!dept) continue;
    if (dept.head?.id === emp.id) continue;
    if (dept.teamLeads.some((l) => l.id === emp.id)) continue;
    dept.members.push(emp);
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
