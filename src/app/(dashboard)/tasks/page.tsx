import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase } from "lucide-react";
import { requirePagePermission, getDashboardScope, hasPermission } from "@/lib/auth-server";
import { PullFromRwasemButton } from "@/components/rwasem/pull-from-rwasem-button";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildTaskFiltersFromParams,
  resolveTasksView,
  type FilterKey,
  type TaskQueryParams,
} from "./_filter_params";
import {
  parseFlowParam,
  resolveFlowTaskIds,
  combineTaskIdSets,
  type FlowFilter,
} from "./_flow_filter";
import {
  loadTaskBoardPageForGlobalView,
  loadTasksPageForGlobalView,
} from "./_loaders";
import { BALANCEABLE_PARTITIONS, BALANCED_BOARD_LIMIT } from "@/lib/data/tasks";
import { getAgentTaskScopeIds } from "@/lib/data/viewer-scope";
import { decodeFilterFromUrl } from "@/lib/custom-filter/url-state";
import { compileFilterTree } from "@/lib/custom-filter/postgrest";
import { getTaskField } from "@/lib/custom-filter/tasks-fields";
import { TasksInfiniteView } from "./tasks-infinite-view";
import { TasksCountProvider } from "./tasks-count-badge";
import { TasksModuleTabsMeta } from "./tasks-module-tabs-meta";
import {
  GLOBAL_BOARD_LIMIT,
  LIST_LIMIT,
  PROJECT_BOARD_LIMIT,
} from "@/lib/data/tasks";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    f?: string;
    d?: string;
    filter?: FilterKey;
    q?: string;
    sf?: string;
    projectId?: string;
    odooProjectId?: string;
    groupBy?: string;
    cf?: string;
    flow?: string;
    fw?: string;
  }>;
}) {
  const [session, t, sp] = await Promise.all([
    requirePagePermission("tasks.view"),
    getTranslations("TasksPage"),
    searchParams,
  ]);
  // Agents (individual contributors) get the kanban board by default — it's the
  // most useful "my work" surface. Explicit ?view= and project boards are
  // untouched; only the bare /tasks default flips from list → kanban for them.
  const baseView = resolveTasksView(sp);
  const scope = await getDashboardScope(session);
  const view = (
    !sp.view && baseView === "list" && scope.kind === "agent" ? "kanban" : baseView
  ) as "kanban" | "list" | "calendar" | "pivot";

  const VALID_GROUPS = [
    "stage", "project", "priority", "deadline",
    "assignee", "customer", "service", "last_stage_update",
    "progress", "status", "start_date",
    "tags", "created_at",
  ] as const;
  type GroupKey = (typeof VALID_GROUPS)[number];
  const groupBy: GroupKey[] = (() => {
    const raw = sp.groupBy ?? "";
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const filtered = parts.filter((p): p is GroupKey =>
      (VALID_GROUPS as readonly string[]).includes(p),
    );
    return filtered.length ? filtered : ["stage"];
  })();

  let resolvedProjectId = sp.projectId;
  if (!resolvedProjectId && sp.odooProjectId) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("external_source", "odoo")
      .eq("external_id", sp.odooProjectId)
      .maybeSingle();
    resolvedProjectId = data?.id;
  }

  const built = buildTaskFiltersFromParams(sp as TaskQueryParams, {
    userId: session.userId,
    employeeId: session.employeeId,
    projectId: resolvedProjectId,
  });
  const active = built.activeKeys;
  const taskFilters = { ...built.filters };

  // Stage-transition drill-down (dashboard regressions card): resolved to the
  // exact task ids that made the from→to move in the window — see _flow_filter.ts.
  const flowFilter = parseFlowParam(sp.flow, sp.fw);

  // Denominator scope for the toolbar "من أصل N": when the view is drilled into a
  // stage facet (e.g. delivery-pipeline card → sf=[stage=in_progress]), the total
  // should count tasks in that stage, not the whole org — so it matches the card.
  const stageScope = (taskFilters.searchFacets ?? [])
    .filter((f) => f.field === "stage")
    .map((f) => f.value);

  const canViewProjectInfo =
    session.isOwner || session.permissions.has("projects.view");

  const pageSize = view === "kanban"
    ? (resolvedProjectId ? PROJECT_BOARD_LIMIT : GLOBAL_BOARD_LIMIT)
    : LIST_LIMIT;

  const noDeadlineActive = active.size === 1 && active.has("no_deadline");

  const queryParams = new URLSearchParams(
    Object.entries(sp).flatMap(([key, value]) =>
      value == null ? [] : [[key, String(value)]],
    ),
  );
  const apiQueryParams = new URLSearchParams(queryParams);
  if (resolvedProjectId) {
    apiQueryParams.set("projectId", resolvedProjectId);
    apiQueryParams.delete("odooProjectId");
  }
  const queryString = queryParams.toString();
  const apiQueryString = apiQueryParams.toString();

  return (
    <div>
      {resolvedProjectId && canViewProjectInfo ? (
        <Suspense fallback={null}>
          <ProjectScopeBanner
            orgId={session.orgId}
            projectId={resolvedProjectId}
            projectScopeLabel={t("projectScope")}
            projectInfoLabel={t("projectInfo")}
            allTasksLabel={t("allTasks")}
          />
        </Suspense>
      ) : null}

      <Suspense
        key={queryString}
        fallback={
          <TasksBoardSkeleton />
        }
      >
        <TasksBoardSection
          orgId={session.orgId}
          view={view}
          groupBy={groupBy}
          taskFilters={taskFilters}
          customFilterTaskIdsTree={sp.cf ?? null}
          flowFilter={flowFilter}
          stageScope={stageScope}
          pageSize={pageSize}
          apiQueryString={apiQueryString}
          queryString={queryString}
          resolvedProjectId={resolvedProjectId ?? null}
          noDeadlineActive={noDeadlineActive}
          agentScope={
            scope.kind === "agent"
              ? { employeeId: session.employeeId, userId: session.userId }
              : null
          }
          canManage={hasPermission(session, "tasks.manage")}
        />
      </Suspense>
    </div>
  );
}

// Lightweight fallback so the page chrome (toolbar shell) is visible while
// TasksBoardSection's heavy fetch streams.
function TasksBoardSkeleton({
}: Record<string, never>) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-soft bg-card/70" />
        ))}
      </div>
    </div>
  );
}

// Streamed inside Suspense so the toolbar/banner render immediately while the
// board/list (which need a heavy parallel fetch + an optional custom-filter
// resolve) load in the background.
async function TasksBoardSection({
  orgId,
  view,
  groupBy,
  taskFilters,
  customFilterTaskIdsTree,
  flowFilter,
  stageScope,
  pageSize,
  apiQueryString,
  queryString,
  resolvedProjectId,
  noDeadlineActive,
  agentScope,
  canManage,
}: {
  orgId: string;
  view: "kanban" | "list" | "calendar" | "pivot";
  groupBy: string[];
  taskFilters: ReturnType<typeof buildTaskFiltersFromParams>["filters"];
  customFilterTaskIdsTree: string | null;
  // Non-null when drilled into a stage-transition (dashboard regressions card).
  flowFilter: FlowFilter | null;
  // Stage facet values in the current view; scopes the toolbar "of N" denominator.
  stageScope: string[];
  pageSize: number;
  apiQueryString: string;
  queryString: string;
  resolvedProjectId: string | null;
  noDeadlineActive: boolean;
  // Non-null only for agents: scope the board to their own tasks (assigned ∪ followed).
  agentScope: { employeeId: string | null; userId: string | null } | null;
  canManage: boolean;
}) {
  const t = await getTranslations("TasksPage");

  // Custom-filter compile + lookup runs in parallel with the main bundle
  // fetch via Promise.all below.
  const customFilterPromise: Promise<string[] | null> = (async () => {
    const customTree = decodeFilterFromUrl(customFilterTaskIdsTree);
    if (!customTree) return null;
    const compiled = compileFilterTree(customTree, (name) =>
      getTaskField(name, (k) => k),
    );
    if (!compiled) return null;
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id")
      .eq("organization_id", orgId)
      .limit(5000)
      .or(compiled.clause);
    return error ? [] : (data ?? []).map((r) => r.id as string);
  })();

  // Stage-transition drill-down resolves to the exact regressed task ids, in
  // parallel with the custom-filter compile above.
  const flowPromise: Promise<string[] | null> = flowFilter
    ? resolveFlowTaskIds(orgId, flowFilter)
    : Promise.resolve(null);

  const [customFilterTaskIdsRaw, flowTaskIds] = await Promise.all([
    customFilterPromise,
    flowPromise,
  ]);
  const customFilterTaskIds = combineTaskIdSets(customFilterTaskIdsRaw, flowTaskIds);
  // Agent scope: restrict to the viewer's own tasks (assigned ∪ followed). We
  // resolve the id set once and reuse it for both the board filter (intersected
  // with any custom filter) and the toolbar KPI counts.
  const agentTaskIds = agentScope
    ? await getAgentTaskScopeIds(orgId, agentScope.employeeId, agentScope.userId)
    : null;
  const scopedTaskIds = agentTaskIds
    ? (customFilterTaskIds
        ? customFilterTaskIds.filter((id) => new Set(agentTaskIds).has(id))
        : agentTaskIds)
    : customFilterTaskIds;
  const effectiveFilters = { ...taskFilters, customFilterTaskIds: scopedTaskIds };

  // Balanced kanban load: when grouping by a server-partitionable dimension,
  // fetch the newest N per column so every column is populated up front instead
  // of the newest tasks all piling into one bucket. Non-partitionable group-bys
  // (assignee/tags/date) and the list view keep the flat paged load.
  const boardPartition = BALANCEABLE_PARTITIONS[groupBy[0]] ?? null;
  const [boardBundle, listBundle] = await Promise.all([
    view === "kanban"
      ? loadTaskBoardPageForGlobalView(orgId, effectiveFilters, {
          limit: boardPartition ? BALANCED_BOARD_LIMIT : pageSize,
          offset: 0,
          partition: boardPartition
            ? { by: boardPartition.field, limit: boardPartition.perBucket }
            : null,
        })
      : Promise.resolve({ rows: [], totalCount: 0, groupRows: [] }),
    view === "kanban"
      ? Promise.resolve({ rows: [], totalCount: 0 })
      : loadTasksPageForGlobalView(orgId, effectiveFilters, {
          limit: pageSize,
          offset: 0,
        }),
  ]);

  const filteredTotalCount =
    view === "kanban" ? boardBundle.totalCount : listBundle.totalCount;
  const initialLoadedCount =
    view === "kanban" ? boardBundle.rows.length : listBundle.rows.length;

  return (
    <TasksCountProvider key={queryString} initialLoaded={initialLoadedCount}>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
        <Suspense fallback={null}>
          <TasksToolbarMeta
            orgId={orgId}
            projectId={resolvedProjectId}
            restrictTaskIds={agentTaskIds}
            stageScope={stageScope}
            filteredTotalCount={filteredTotalCount}
            noDeadlineActive={noDeadlineActive}
            noDeadlineHref={noDeadlineActive ? "/tasks" : "/tasks?f=no_deadline"}
            kpiErrorLabel={t("toolbar.kpiError")}
            kpiNoDeadlineHintLabel={t("toolbar.kpiNoDeadlineHint")}
            kpiNoDeadlineLabel={t("toolbar.kpiNoDeadline")}
          />
        </Suspense>
        {canManage && (
          <div className="ms-auto">
            <PullFromRwasemButton kind="tasks" />
          </div>
        )}
      </div>

      <TasksInfiniteView
        view={view}
        groupBy={groupBy as Parameters<typeof TasksInfiniteView>[0]["groupBy"]}
        queryString={apiQueryString}
        initialBoardTasks={boardBundle.rows}
        initialListTasks={listBundle.rows}
        totalCount={filteredTotalCount}
        groupingRows={view === "kanban" ? boardBundle.groupRows : []}
        boardPartition={
          view === "kanban" && boardPartition
            ? { key: groupBy[0], perBucket: boardPartition.perBucket }
            : null
        }
        pageSize={pageSize}
      />
    </TasksCountProvider>
  );
}

// Lightweight fallback so the page chrome (banner + toolbar shell) is visible
// while TasksBoardSection streams.
async function ProjectScopeBanner({
  orgId,
  projectId,
  projectScopeLabel,
  projectInfoLabel,
  allTasksLabel,
}: {
  orgId: string;
  projectId: string;
  projectScopeLabel: string;
  projectInfoLabel: string;
  allTasksLabel: string;
}) {
  const t = await getTranslations("TasksPage");
  const [projectInfoRes, scopedTaskCountRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("id", projectId)
      .maybeSingle(),
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("project_id", projectId),
  ]);

  const projectInfo = projectInfoRes.data;
  if (!projectInfo) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan/30 bg-cyan-dim/30 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Briefcase className="size-4 shrink-0 text-cyan" />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-cyan/80">
            {projectScopeLabel}
          </p>
          <p className="truncate text-sm font-semibold">
            {projectInfo.name}
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {t("taskCount", { count: scopedTaskCountRes.count ?? 0 })}
            </span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/projects/${projectInfo.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
        >
          <Briefcase className="size-3.5" />
          {projectInfoLabel}
        </Link>
        <Link
          href="/tasks"
          className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {allTasksLabel}
        </Link>
      </div>
    </div>
  );
}

async function TasksToolbarMeta({
  orgId,
  projectId,
  restrictTaskIds,
  stageScope,
  filteredTotalCount,
  noDeadlineActive,
  noDeadlineHref,
  kpiErrorLabel,
  kpiNoDeadlineHintLabel,
  kpiNoDeadlineLabel,
}: {
  orgId: string;
  projectId: string | null;
  // Agent scope: when non-null, count only these task ids (the viewer's own).
  restrictTaskIds: string[] | null;
  // Stage facet values in view: when set, the "of N" total is scoped to those
  // stages so it matches the dashboard card that drilled in (e.g. "15 of 38 in
  // in_progress") instead of the org-wide grand total.
  stageScope: string[];
  filteredTotalCount: number;
  noDeadlineActive: boolean;
  noDeadlineHref: string;
  kpiErrorLabel: string;
  kpiNoDeadlineHintLabel: string;
  kpiNoDeadlineLabel: string;
}) {
  // `kind`: "total" = all non-archived (optionally stage-scoped); "noDeadline" =
  // open + no dates.
  const buildScope = (kind: "total" | "noDeadline", ids?: string[]) => {
    let q = supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null);
    if (projectId) q = q.eq("project_id", projectId);
    // The "of N" denominator follows the stage the user drilled into.
    if (kind === "total" && stageScope.length) q = q.in("stage", stageScope);
    if (kind === "noDeadline") {
      q = q.neq("stage", "done").is("planned_date", null).is("due_date", null);
    }
    if (ids) q = q.in("id", ids);
    return q;
  };

  // Agent scope counts via chunked `.in()` — a single 676-id IN blows the GET
  // URL limit (returns 0). null restrict → one unscoped count.
  const countScoped = async (kind: "total" | "noDeadline"): Promise<number | null> => {
    if (restrictTaskIds == null) {
      const res = await buildScope(kind);
      return res.error ? null : res.count ?? 0;
    }
    if (restrictTaskIds.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < restrictTaskIds.length; i += 100) {
      const res = await buildScope(kind, restrictTaskIds.slice(i, i + 100));
      if (res.error) return null;
      sum += res.count ?? 0;
    }
    return sum;
  };

  const [totalCountRaw, noDeadlineCount] = await Promise.all([
    countScoped("total"),
    countScoped("noDeadline"),
  ]);
  const totalCount = totalCountRaw ?? 0;
  // Show how many match the current view, not just the grand total —
  // "245 of 1,579" instead of a bare "of 1,579". Localized so it follows the UI
  // language (and so the number isn't bidi-jumbled inside the LTR-forced badge).
  const t = await getTranslations("TasksPage");
  const trailingText =
    filteredTotalCount !== totalCount
      ? t("toolbar.viewOfTotal", { shown: filteredTotalCount, total: totalCount })
      : null;

  return (
    <>
      <TasksModuleTabsMeta
        trailingText={trailingText}
        pills={[
          {
            label: kpiNoDeadlineLabel,
            href: noDeadlineHref,
            active: noDeadlineActive,
            count: noDeadlineCount,
            title: noDeadlineCount === null ? kpiErrorLabel : kpiNoDeadlineHintLabel,
          },
        ]}
      />
    </>
  );
}
