import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { LiveProject } from "@/lib/odoo/live";

export interface ListProjectsPagedResult {
  rows: LiveProject[];
  total: number;
  page: number;
  pageSize: number;
  totals: { projects: number; tasks: number; withManager: number };
}

export interface ListProjectsPagedOpts {
  organizationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
}

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: number;
  is_favorite: boolean;
  store_name: string | null;
  target: string | null;
  last_update_status: string | null;
  last_update_color: number | null;
  start_date: string | null;
  end_date: string | null;
  external_id: string | null;
  client: { id: string; name: string; address: string | null; external_id: string | null } | null;
  project_manager: { id: string; full_name: string; external_id: string | null; avatar_url: string | null } | null;
  account_manager: { id: string; full_name: string; external_id: string | null; avatar_url: string | null } | null;
};

function externalToOdooId(ext: string | null | undefined): number {
  if (!ext) return 0;
  const n = Number(ext);
  return Number.isFinite(n) ? n : 0;
}

function safeTarget(v: string | null): LiveProject["target"] {
  return v === "on_target" || v === "off_target" || v === "out" || v === "sales_deposit" || v === "renewed"
    ? v
    : null;
}

/**
 * Supabase-backed equivalent of listLiveProjectsPaged() in src/lib/odoo/live.ts.
 * Returns the same LiveProject shape so the projects-list UI renders unchanged.
 */
export async function listProjectsPaged(opts: ListProjectsPagedOpts): Promise<ListProjectsPagedResult> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = (opts.search ?? "").trim();

  let q = supabaseAdmin
    .from("projects")
    .select(
      `
        id, name, description, color, is_favorite, store_name, target,
        last_update_status, last_update_color,
        start_date, end_date, external_id,
        client:clients ( id, name, address, external_id ),
        project_manager:employee_profiles!projects_project_manager_employee_id_fkey ( id, full_name, external_id, avatar_url ),
        account_manager:employee_profiles!projects_account_manager_employee_id_fkey ( id, full_name, external_id, avatar_url )
      `,
      { count: "exact" },
    )
    .eq("organization_id", opts.organizationId)
    .order("external_id", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (search) {
    // Match project name, store_name, or client name. Embedded-table filters
    // use the dotted form: "client.name.ilike.%term%".
    q = q.or(
      `name.ilike.%${search}%,store_name.ilike.%${search}%,client.name.ilike.%${search}%`,
    );
  }

  const { data: projectRows, count, error } = await q;
  if (error) throw error;
  const rows = (projectRows ?? []) as unknown as ProjectRow[];
  const total = count ?? rows.length;

  if (rows.length === 0) {
    const emptyTotals = await aggregateProjectTotals(opts.organizationId);
    return { rows: [], total, page, pageSize, totals: emptyTotals };
  }

  const projectIds = rows.map((r) => r.id);
  const [countsRes, servicesRes, membersRes] = await Promise.all([
    supabaseAdmin
      .from("project_task_counts")
      .select("project_id, task_count, open_task_count, closed_task_count")
      .in("project_id", projectIds),
    // Project chips come from category_ids in Odoo, mirrored as project_services.
    supabaseAdmin
      .from("project_services")
      .select(`project_id, service:services ( id, name, external_id )`)
      .in("project_id", projectIds),
    // Project members (Odoo favorite_user_ids) — render as overlapping avatars.
    supabaseAdmin
      .from("project_members")
      .select(`project_id, employee:employee_profiles ( id, full_name, avatar_url )`)
      .in("project_id", projectIds),
  ]);
  if (countsRes.error) throw countsRes.error;
  if (servicesRes.error) throw servicesRes.error;
  if (membersRes.error) throw membersRes.error;

  const countsByProject = new Map<string, { task: number; open: number; closed: number }>();
  for (const c of countsRes.data ?? []) {
    countsByProject.set(c.project_id as string, {
      task: Number(c.task_count) || 0,
      open: Number(c.open_task_count) || 0,
      closed: Number(c.closed_task_count) || 0,
    });
  }

  const tagsByProject = new Map<string, { ids: number[]; names: string[] }>();
  for (const row of (servicesRes.data ?? []) as unknown as Array<{
    project_id: string;
    service: { id: string; name: string; external_id: string | null } | null;
  }>) {
    if (!row.service) continue;
    const slot = tagsByProject.get(row.project_id) ?? { ids: [], names: [] };
    slot.ids.push(externalToOdooId(row.service.external_id));
    slot.names.push(row.service.name);
    tagsByProject.set(row.project_id, slot);
  }

  const membersByProject = new Map<string, { name: string; avatarUrl: string | null }[]>();
  for (const row of (membersRes.data ?? []) as unknown as Array<{
    project_id: string;
    employee: { id: string; full_name: string; avatar_url: string | null } | null;
  }>) {
    if (!row.employee) continue;
    const slot = membersByProject.get(row.project_id) ?? [];
    slot.push({ name: row.employee.full_name, avatarUrl: row.employee.avatar_url });
    membersByProject.set(row.project_id, slot);
  }

  const mapped: LiveProject[] = rows.map((r) => {
    const odooId = externalToOdooId(r.external_id);
    const counts = countsByProject.get(r.id) ?? { task: 0, open: 0, closed: 0 };
    const tags = tagsByProject.get(r.id) ?? { ids: [], names: [] };
    return {
      odooId,
      name: r.name,
      clientId: r.client ? externalToOdooId(r.client.external_id) || null : null,
      clientName: r.client?.name ?? null,
      managerId: r.project_manager ? externalToOdooId(r.project_manager.external_id) || null : null,
      managerName: r.project_manager?.full_name ?? null,
      managerAvatarUrl: r.project_manager?.avatar_url ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      taskCount: counts.task,
      ref: `PRJ-${String(odooId || 0).padStart(5, "0")}`,
      openTaskCount: counts.open,
      closedTaskCount: counts.closed,
      color: r.color ?? 0,
      isFavorite: Boolean(r.is_favorite),
      tagIds: tags.ids,
      tagNames: tags.names,
      lastUpdateStatus: r.last_update_status,
      lastUpdateColor: r.last_update_color,
      description: r.description,
      storeName: r.store_name,
      accountManagerId: r.account_manager ? externalToOdooId(r.account_manager.external_id) || null : null,
      accountManagerName: r.account_manager?.full_name ?? null,
      accountManagerAvatarUrl: r.account_manager?.avatar_url ?? null,
      target: safeTarget(r.target),
      stageId: null,
      stageName: null,
      siteAddress: r.client?.address ?? null,
      members: membersByProject.get(r.id) ?? [],
    };
  });

  const totals = await aggregateProjectTotals(opts.organizationId);

  return { rows: mapped, total, page, pageSize, totals };
}

async function aggregateProjectTotals(organizationId: string) {
  const [projectsCount, tasksCount, withMgrCount] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .not("project_manager_employee_id", "is", null),
  ]);
  return {
    projects: projectsCount.count ?? 0,
    tasks: tasksCount.count ?? 0,
    withManager: withMgrCount.count ?? 0,
  };
}

export async function listProjects(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(`
      id, name, status, priority, start_date, end_date, created_at,
      hold_reason, held_at, cycle_length_months, next_renewal_date,
      client:clients ( id, name ),
      account_manager:employee_profiles!projects_account_manager_employee_id_fkey ( id, full_name ),
      project_services ( service:services ( id, name, slug ) ),
      tasks(count)
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getProject(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(`
      *,
      client:clients ( id, name, contact_name, phone, email ),
      account_manager:employee_profiles!projects_account_manager_employee_id_fkey ( id, full_name, job_title ),
      project_services ( id, status, service:services ( id, name, slug ) ),
      project_members ( id, role_label, employee:employee_profiles ( id, full_name, job_title, avatar_url ) )
    `)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectTaskSummary(orgId: string, projectId: string) {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("stage, status")
    .eq("organization_id", orgId)
    .eq("project_id", projectId);

  const summary = {
    total: 0,
    // Sky Light / Rwasem stages
    new: 0,
    in_progress: 0,
    manager_review: 0,
    specialist_review: 0,
    ready_to_send: 0,
    sent_to_client: 0,
    client_changes: 0,
    done: 0,
    // Legacy status counts (kept for any older callers).
    todo: 0,
    review: 0,
    blocked: 0,
    cancelled: 0,
  } as Record<string, number>;

  for (const row of data ?? []) {
    summary.total += 1;
    if (row.stage) summary[row.stage] = (summary[row.stage] ?? 0) + 1;
    if (row.status) summary[row.status] = (summary[row.status] ?? 0) + 1;
  }
  return summary;
}
