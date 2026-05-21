import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildTaskFiltersFromParams,
  resolveTasksView,
  type FilterKey,
  type TaskQueryParams,
} from "./_filter_params";
import {
  loadTaskBoardPageForGlobalView,
  loadTasksPageForGlobalView,
} from "./_loaders";
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
  }>;
}) {
  const [session, t, sp] = await Promise.all([
    requirePagePermission("tasks.view"),
    getTranslations("TasksPage"),
    searchParams,
  ]);
  const view = resolveTasksView(sp);

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
          pageSize={pageSize}
          apiQueryString={apiQueryString}
          queryString={queryString}
          resolvedProjectId={resolvedProjectId ?? null}
          noDeadlineActive={noDeadlineActive}
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
  pageSize,
  apiQueryString,
  queryString,
  resolvedProjectId,
  noDeadlineActive,
}: {
  orgId: string;
  view: "kanban" | "list" | "calendar" | "pivot";
  groupBy: string[];
  taskFilters: ReturnType<typeof buildTaskFiltersFromParams>["filters"];
  customFilterTaskIdsTree: string | null;
  pageSize: number;
  apiQueryString: string;
  queryString: string;
  resolvedProjectId: string | null;
  noDeadlineActive: boolean;
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

  const customFilterTaskIds = await customFilterPromise;
  const effectiveFilters = { ...taskFilters, customFilterTaskIds };

  const [boardBundle, listBundle] = await Promise.all([
    view === "kanban"
      ? loadTaskBoardPageForGlobalView(orgId, effectiveFilters, {
          limit: pageSize,
          offset: 0,
        })
      : Promise.resolve({ rows: [], totalCount: 0 }),
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
            filteredTotalCount={filteredTotalCount}
            noDeadlineActive={noDeadlineActive}
            noDeadlineHref={noDeadlineActive ? "/tasks" : "/tasks?f=no_deadline"}
            kpiErrorLabel={t("toolbar.kpiError")}
            kpiNoDeadlineHintLabel={t("toolbar.kpiNoDeadlineHint")}
            kpiNoDeadlineLabel={t("toolbar.kpiNoDeadline")}
          />
        </Suspense>
      </div>

      <TasksInfiniteView
        view={view}
        groupBy={groupBy as Parameters<typeof TasksInfiniteView>[0]["groupBy"]}
        queryString={apiQueryString}
        initialBoardTasks={boardBundle.rows}
        initialListTasks={listBundle.rows}
        totalCount={filteredTotalCount}
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
  filteredTotalCount,
  noDeadlineActive,
  noDeadlineHref,
  kpiErrorLabel,
  kpiNoDeadlineHintLabel,
  kpiNoDeadlineLabel,
}: {
  orgId: string;
  projectId: string | null;
  filteredTotalCount: number;
  noDeadlineActive: boolean;
  noDeadlineHref: string;
  kpiErrorLabel: string;
  kpiNoDeadlineHintLabel: string;
  kpiNoDeadlineLabel: string;
}) {
  const baseTaskQuery = () =>
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null);

  let totalScope = baseTaskQuery();
  if (projectId) totalScope = totalScope.eq("project_id", projectId);

  let noDeadlineScope = baseTaskQuery()
    .neq("stage", "done")
    .is("planned_date", null)
    .is("due_date", null);
  if (projectId) noDeadlineScope = noDeadlineScope.eq("project_id", projectId);

  const [totalRes, noDeadlineRes] = await Promise.all([
    totalScope,
    noDeadlineScope,
  ]);

  const totalCount = totalRes.count ?? 0;
  const noDeadlineCount = noDeadlineRes.error ? null : noDeadlineRes.count ?? 0;
  const trailingText =
    filteredTotalCount !== totalCount ? `من أصل ${totalCount}` : null;

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
