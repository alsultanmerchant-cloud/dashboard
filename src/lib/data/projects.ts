import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { LiveProject } from "@/lib/odoo/live";
import { compileFilterTree } from "@/lib/custom-filter/postgrest";
import { getProjectField } from "@/lib/custom-filter/projects-fields";
import type { FilterTree } from "@/lib/custom-filter/types";

export interface ListProjectsPagedResult {
  rows: LiveProject[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    projects: number;
    tasks: number;
    withManager: number;
    needsDeadline: number;
    renewalsThisMonth: number;
  };
}

export interface ListProjectsPagedOpts {
  organizationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  includeTotals?: boolean;
  // Rwasem-style filter flags. Each maps to a chip the user toggles in the
  // search bar's filter dropdown.
  onlyWithCategories?: boolean;
  onlyFavorites?: boolean;
  onlyWithManager?: boolean;
  /** "My Projects": current user is AM, PM, specialist, or member. */
  onlyMine?: boolean;
  /** No project_manager_employee_id AND no account_manager_employee_id. */
  onlyUnassigned?: boolean;
  /** Project on hold (held_at IS NOT NULL) or status='archived'. */
  archived?: boolean;
  /** Project has zero active category links. Opposite of onlyWithCategories. */
  allCategoriesArchived?: boolean;
  /** Project has at least one task where logged hours exceed allocated. */
  overTimesheets?: boolean;
  /** "At risk": project has at least one OPEN (non-archived, not done) overdue
   *  task. Mirrors the executive scores card's `riskProjects` count exactly, so
   *  the dashboard drill-down lands on the same project set. Resolved to an id
   *  whitelist (like the agent scope) rather than a new RPC param. */
  onlyWithOverdue?: boolean;
  /** ISO YYYY-MM-DD bounds. */
  startDateFrom?: string;
  startDateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  /** Employee id of the caller — required for onlyMine. */
  currentEmployeeId?: string;
  /** Odoo-style ad-hoc rule tree from the "Add Custom Filter" dialog. When
   *  present we resolve matching project IDs via PostgREST first, then pass
   *  the whitelist into the bundle RPC. */
  customFilter?: FilterTree | null;
  /** Rwasem-style search facets. Each entry is a field-scoped query the user
   *  built by typing in the search box and picking a row from the dropdown.
   *  AND across distinct fields, OR within the same field — enforced by the
   *  RPC (migration 0132). Mirrors the tasks `searchFacets` shape. */
  searchFacets?: ProjectSearchFacet[];
  /** Hard scope (agent migration phase): restrict results to these project ids
   *  (projects the agent is assigned in or follows). Intersected with any custom
   *  filter. Empty array → no results. undefined/null → unscoped. */
  restrictToProjectIds?: string[] | null;
}

export type ProjectSearchFacetField =
  | "name"
  | "code"
  | "client"
  | "manager"
  | "tags";

export type ProjectSearchFacet = {
  field: ProjectSearchFacetField;
  value: string;
};

export type ProjectSmartBadgeData = {
  topAccountManagers: Array<{
    id: string;
    name: string;
    openTasks: number;
    projects: number;
  }>;
  topTags: Array<{
    id: string;
    name: string;
    projects: number;
  }>;
};

/** Pre-filter project IDs via PostgREST using the custom-filter tree.
 *  Returns `null` when the tree compiles to nothing (no constraints). */
async function resolveCustomFilterIds(
  organizationId: string,
  tree: FilterTree,
): Promise<string[] | null> {
  const compiled = compileFilterTree(tree, (name) => getProjectField(name, (k) => k));
  if (!compiled) return null;

  const query = supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    // Hard cap — if a custom filter matches more than this the user almost
    // certainly wants to narrow further. Matches the "Search More" pattern
    // in Odoo where the autocomplete returns ~80 then offers to widen.
    .limit(5000)
    .or(compiled.clause);
  const { data, error } = await query;
  if (error) {
    // Don't throw — a malformed/unsupported filter should yield "no matches"
    // rather than crashing the page. The pill still renders so the user can
    // edit/remove it.
    console.warn(`[listProjectsPaged] custom filter compile failed: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => r.id as string);
}

type BundleRow = {
  id: string;
  name: string;
  description: string | null;
  color: number | null;
  is_favorite: boolean;
  store_name: string | null;
  target: string | null;
  last_update_status: string | null;
  last_update_color: number | null;
  start_date: string | null;
  end_date: string | null;
  external_id: string | null;
  // PR-F (#3): origin — "odoo" for synced rows, null for dashboard-created.
  external_source: string | null;
  client: { id: string; name: string; address: string | null; external_id: string | null } | null;
  project_manager: { id: string; full_name: string; external_id: string | null; avatar_url: string | null } | null;
  account_manager: { id: string; full_name: string; external_id: string | null; avatar_url: string | null } | null;
  task_count: number;
  open_task_count: number;
  closed_task_count: number;
  services: Array<{ id: string; name: string; external_id: string | null }>;
  members: Array<{ full_name: string; avatar_url: string | null }>;
  tags: Array<{ id: string; name: string; color: number }>;
};

type BundleResult = {
  rows: BundleRow[];
  total: number;
  totals: {
    projects: number;
    tasks: number;
    withManager: number;
    needsDeadline: number;
    renewalsThisMonth: number;
  };
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
 *
 * Single round trip: delegates filter+page+nested relations+org totals to the
 * `list_projects_page_bundle` Postgres RPC (migrations 0083/0084). Replaces
 * the previous 5-call sequence (main + counts + services + members + 3 org
 * counts).
 */
/**
 * Distinct project ids that have at least one OPEN (non-archived, not done)
 * overdue task. Same predicate as the executive scores card's `riskProjects`
 * (executive-scores.ts), so the dashboard "مشاريع معرضة للخطر" drill-down opens
 * exactly that project set. Paginated to stay correct past PostgREST's 1000-row
 * cap even though the open-task set is currently small.
 */
async function resolveOverdueProjectIds(orgId: string): Promise<string[]> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("project_id")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .neq("stage", "done")
      .eq("is_overdue", true)
      .not("project_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`[resolveOverdueProjectIds] ${error.message}`);
      break;
    }
    const rows = (data ?? []) as Array<{ project_id: string | null }>;
    for (const r of rows) if (r.project_id) ids.add(r.project_id);
    if (rows.length < PAGE) break;
  }
  return [...ids];
}

export async function listProjectsPaged(opts: ListProjectsPagedOpts): Promise<ListProjectsPagedResult> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const rawSearch = (opts.search ?? "").trim();
  // Strip PostgREST-special chars to mirror previous behavior; the RPC ilikes
  // the value as-is so we just need it not to break URL/JSON.
  const search = rawSearch ? rawSearch.replace(/[%,()]/g, " ").trim() : "";

  const onlyMineEmployeeId =
    opts.onlyMine && opts.currentEmployeeId ? opts.currentEmployeeId : null;

  // Resolve custom-filter IDs first so we can hand the bundle RPC a whitelist.
  let customIds: string[] | null = null;
  if (opts.customFilter) {
    customIds = await resolveCustomFilterIds(opts.organizationId, opts.customFilter);
  }

  // "At risk" drill-down: intersect with projects carrying an open overdue task.
  if (opts.onlyWithOverdue) {
    const overdueIds = await resolveOverdueProjectIds(opts.organizationId);
    const allowed = new Set(overdueIds);
    customIds = customIds == null
      ? [...allowed]
      : customIds.filter((id) => allowed.has(id));
  }

  // Agent scope: intersect the whitelist with the projects the agent may see.
  if (opts.restrictToProjectIds != null) {
    const allowed = new Set(opts.restrictToProjectIds);
    customIds = customIds == null
      ? [...allowed]
      : customIds.filter((id) => allowed.has(id));
  }

  {
    // Empty array = filter (or scope) compiled but matched zero rows; shortcut.
    if (customIds && customIds.length === 0) {
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        totals:
          opts.includeTotals === false
            ? { projects: 0, tasks: 0, withManager: 0 }
            : {
                projects: 0,
                tasks: 0,
                withManager: 0,
                needsDeadline: 0,
                renewalsThisMonth: 0,
              },
      };
    }
  }

  const { data, error } = await supabaseAdmin.rpc("list_projects_page_bundle", {
    p_org_id: opts.organizationId,
    p_page: page,
    p_page_size: pageSize,
    p_search: search || null,
    p_only_favorites: !!opts.onlyFavorites,
    p_only_with_manager: !!opts.onlyWithManager,
    p_only_unassigned: !!opts.onlyUnassigned,
    p_archived: !!opts.archived,
    p_only_with_categories: !!opts.onlyWithCategories,
    p_start_date_from: opts.startDateFrom || null,
    p_start_date_to: opts.startDateTo || null,
    p_end_date_from: opts.endDateFrom || null,
    p_end_date_to: opts.endDateTo || null,
    p_only_mine_employee_id: onlyMineEmployeeId,
    p_all_categories_archived: !!opts.allCategoriesArchived,
    p_over_timesheets: !!opts.overTimesheets,
    p_id_whitelist: customIds,
    p_search_facets:
      opts.searchFacets && opts.searchFacets.length > 0
        ? (opts.searchFacets as unknown as Record<string, unknown>[])
        : null,
  });
  if (error) throw error;
  const bundle = (
    data ?? {
      rows: [],
      total: 0,
      totals: {
        projects: 0,
        tasks: 0,
        withManager: 0,
        needsDeadline: 0,
        renewalsThisMonth: 0,
      },
    }
  ) as BundleResult;

  const mapped: LiveProject[] = bundle.rows.map((r) => {
    const odooId = externalToOdooId(r.external_id);
    return {
      id: r.id,
      odooId,
      name: r.name,
      clientId: r.client ? externalToOdooId(r.client.external_id) || null : null,
      clientName: r.client?.name ?? null,
      managerId: r.project_manager ? externalToOdooId(r.project_manager.external_id) || null : null,
      managerName: r.project_manager?.full_name ?? null,
      managerAvatarUrl: r.project_manager?.avatar_url ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      taskCount: r.task_count,
      ref: `PRJ-${String(odooId || 0).padStart(5, "0")}`,
      openTaskCount: r.open_task_count,
      closedTaskCount: r.closed_task_count,
      color: r.color ?? 0,
      isFavorite: Boolean(r.is_favorite),
      tagIds: r.services.map((s) => externalToOdooId(s.external_id)),
      tagNames: r.services.map((s) => s.name),
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
      members: r.members.map((m) => ({ name: m.full_name, avatarUrl: m.avatar_url })),
      customTags: r.tags ?? [],
      externalSource: r.external_source ?? null,
    };
  });

  return {
    rows: mapped,
    total: bundle.total,
    page,
    pageSize,
    totals:
      opts.includeTotals === false
        ? { projects: 0, tasks: 0, withManager: 0 }
        : bundle.totals,
  };
}

const aggregateProjectTotals = cache(async (organizationId: string) => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

  const [
    projectsCount,
    tasksCount,
    openTasksNoDeadlineCount,
    needsDeadlineCount,
    renewalsThisMonthCount,
  ] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .neq("status", "archived"),
    supabaseAdmin
      .from("tasks")
      .select("id, project:projects!inner(status)", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .neq("project.status", "archived"),
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .neq("stage", "done")
      .is("planned_date", null)
      .is("due_date", null),
    supabaseAdmin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .neq("status", "archived")
      .is("end_date", null),
    supabaseAdmin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .neq("status", "archived")
      .gte("next_renewal_date", firstOfMonth)
      .lte("next_renewal_date", lastOfMonth),
  ]);
  return {
    projects: projectsCount.count ?? 0,
    tasks: tasksCount.count ?? 0,
    openTasksNoDeadline: openTasksNoDeadlineCount.count ?? 0,
    needsDeadline: needsDeadlineCount.count ?? 0,
    renewalsThisMonth: renewalsThisMonthCount.count ?? 0,
  };
});

export const getProjectTotals = aggregateProjectTotals;

export const getProjectSmartBadgeData = unstable_cache(
  async (organizationId: string): Promise<ProjectSmartBadgeData> => {
    const [{ data: projects }, { data: openTasks }, { data: tagAssignments }] = await Promise.all([
      supabaseAdmin
        .from("projects")
        .select(
          "id, account_manager_employee_id, account_manager:employee_profiles!projects_account_manager_employee_id_fkey(id, full_name)",
        )
        .eq("organization_id", organizationId)
        .neq("status", "archived"),
      supabaseAdmin
        .from("tasks")
        .select("project_id")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .neq("stage", "done"),
      supabaseAdmin
        .from("project_tag_assignments")
        .select("project_id, tag:project_tags(id, name)")
        .eq("organization_id", organizationId),
    ]);

    const activeProjectIds = new Set<string>();
    const projectToManager = new Map<string, { id: string; name: string }>();

    for (const row of (projects ?? []) as Array<{
      id: string;
      account_manager_employee_id: string | null;
      account_manager:
        | { id: string; full_name: string | null }
        | { id: string; full_name: string | null }[]
        | null;
    }>) {
      activeProjectIds.add(row.id);
      const manager = Array.isArray(row.account_manager) ? row.account_manager[0] : row.account_manager;
      if (row.account_manager_employee_id && manager?.full_name) {
        projectToManager.set(row.id, {
          id: row.account_manager_employee_id,
          name: manager.full_name,
        });
      }
    }

    const managerAgg = new Map<string, { id: string; name: string; openTasks: number; projectIds: Set<string> }>();
    for (const row of (openTasks ?? []) as Array<{ project_id: string | null }>) {
      if (!row.project_id || !activeProjectIds.has(row.project_id)) continue;
      const manager = projectToManager.get(row.project_id);
      if (!manager) continue;
      const slot = managerAgg.get(manager.id) ?? {
        id: manager.id,
        name: manager.name,
        openTasks: 0,
        projectIds: new Set<string>(),
      };
      slot.openTasks += 1;
      slot.projectIds.add(row.project_id);
      managerAgg.set(manager.id, slot);
    }

    const tagAgg = new Map<string, { id: string; name: string; projectIds: Set<string> }>();
    for (const row of (tagAssignments ?? []) as Array<{
      project_id: string | null;
      tag:
        | { id: string; name: string | null }
        | { id: string; name: string | null }[]
        | null;
    }>) {
      if (!row.project_id || !activeProjectIds.has(row.project_id)) continue;
      const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
      if (!tag?.id || !tag.name) continue;
      const slot = tagAgg.get(tag.id) ?? {
        id: tag.id,
        name: tag.name,
        projectIds: new Set<string>(),
      };
      slot.projectIds.add(row.project_id);
      tagAgg.set(tag.id, slot);
    }

    return {
      topAccountManagers: [...managerAgg.values()]
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          openTasks: entry.openTasks,
          projects: entry.projectIds.size,
        }))
        .sort((a, b) => b.openTasks - a.openTasks || b.projects - a.projects || a.name.localeCompare(b.name))
        .slice(0, 2),
      topTags: [...tagAgg.values()]
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          projects: entry.projectIds.size,
        }))
        .filter((entry) => entry.projects >= 2)
        .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name))
        .slice(0, 3),
    };
  },
  ["project-smart-badges"],
  { revalidate: 300 },
);

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

// Project tags surfaced from the org-wide `project_tags` table. The detail
// page reads both lists in parallel — attached chips drive the panel display,
// `all` feeds the search-and-pick combobox.
export type ProjectTagRow = { id: string; name: string; color: number };
export async function getProjectAttachedTags(
  orgId: string,
  projectId: string,
): Promise<ProjectTagRow[]> {
  const attachedRes = await supabaseAdmin
    .from("project_tag_assignments")
    .select("tag:project_tags ( id, name, color )")
    .eq("organization_id", orgId)
    .eq("project_id", projectId);

  if (attachedRes.error) throw attachedRes.error;

  type AttRow = {
    tag: ProjectTagRow | ProjectTagRow[] | null;
  };
  return (attachedRes.data ?? [])
    .map((row) => {
      const t = (row as AttRow).tag;
      return Array.isArray(t) ? t[0] : t;
    })
    .filter((t): t is ProjectTagRow => Boolean(t));
}

export async function listProjectTags(
  orgId: string,
): Promise<ProjectTagRow[]> {
  const { data, error } = await supabaseAdmin
    .from("project_tags")
    .select("id, name, color")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectTagRow[];
}

export async function getProjectTagsForProject(
  orgId: string,
  projectId: string,
): Promise<{ attached: ProjectTagRow[]; all: ProjectTagRow[] }> {
  const [attached, all] = await Promise.all([
    getProjectAttachedTags(orgId, projectId),
    listProjectTags(orgId),
  ]);
  return { attached, all };
}

export async function getProject(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(`
      *,
      client:clients ( id, name, contact_name, phone, email, address ),
      project_manager:employee_profiles!projects_project_manager_employee_id_fkey ( id, full_name, job_title, avatar_url ),
      account_manager:employee_profiles!projects_account_manager_employee_id_fkey ( id, full_name, job_title ),
      social_specialist:employee_profiles!projects_social_specialist_id_fkey ( id, full_name, job_title, avatar_url ),
      media_specialist:employee_profiles!projects_media_specialist_id_fkey ( id, full_name, job_title, avatar_url ),
      seo_specialist:employee_profiles!projects_seo_specialist_id_fkey ( id, full_name, job_title, avatar_url ),
      project_services ( id, service_id, status, service:services ( id, name, slug ) ),
      project_members ( id, role_label, employee:employee_profiles ( id, full_name, job_title, avatar_url ) )
    `)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Resolve the user who put the project on hold most recently. The actor is
// stamped on `project.hold` rows in `audit_logs` (held_at lives on the project
// row but the actor doesn't), so we fan out one extra read joined to
// employee_profiles for the display name.
export async function getProjectHoldActor(
  orgId: string,
  projectId: string,
): Promise<{ name: string; at: string } | null> {
  const { data } = await supabaseAdmin
    .from("audit_logs")
    .select("actor_user_id, created_at")
    .eq("organization_id", orgId)
    .eq("entity_type", "project")
    .eq("entity_id", projectId)
    .eq("action", "project.hold")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.actor_user_id) {
    // Sky Light feedback #4 (polish): the dashboard writes audit_logs on
    // every hold, but Odoo-imported holds were set before the dashboard
    // existed and have no row. Surface "مزامنة من Odoo" so the ribbon
    // doesn't render an empty actor and the operator knows where it came
    // from. Only kicks in when held_at is set.
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("held_at, external_source")
      .eq("organization_id", orgId)
      .eq("id", projectId)
      .maybeSingle();
    if (project?.held_at && project.external_source === "odoo") {
      return { name: "مزامنة من Odoo", at: project.held_at };
    }
    return null;
  }
  const { data: profile } = await supabaseAdmin
    .from("employee_profiles")
    .select("full_name")
    .eq("user_id", data.actor_user_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return {
    name: profile?.full_name ?? "—",
    at: data.created_at,
  };
}

export async function getProjectTaskSummary(orgId: string, projectId: string) {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("stage, status")
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    // Mirror Rwasem's "Tasks" smart-button which excludes archived rows
    // — without this, projects imported from Odoo with historical tasks
    // inflate to ~7x the live count.
    .is("archived_at", null);

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
    // Status overlaps stage on 'done' and 'in_progress'. Double-counting
    // pushed Total Progress past 100% — only
    // tally status when it's distinct from the stage value.
    if (row.status && row.status !== row.stage) {
      summary[row.status] = (summary[row.status] ?? 0) + 1;
    }
  }
  return summary;
}
