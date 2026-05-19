import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase, CalendarOff } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { ViewSwitcher } from "./view-switcher";
import { MonthQuickPick } from "./month-quick-pick";
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
import { TasksCountProvider, TaskCountBadge } from "./tasks-count-badge";
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
  const session = await requirePagePermission("tasks.view");
  const t = await getTranslations("TasksPage");
  const sp = await searchParams;
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

  let customFilterTaskIds: string[] | null = null;
  const customTree = decodeFilterFromUrl(sp.cf);
  if (customTree) {
    const compiled = compileFilterTree(customTree, (name) =>
      getTaskField(name, (k) => k),
    );
    if (compiled) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .select("id")
        .eq("organization_id", session.orgId)
        .limit(5000)
        .or(compiled.clause);
      customFilterTaskIds = error ? [] : (data ?? []).map((r) => r.id as string);
    }
  }
  taskFilters.customFilterTaskIds = customFilterTaskIds;

  const canViewProjectInfo =
    session.isOwner || session.permissions.has("projects.view");

  let projectInfo: { id: string; name: string } | null = null;
  if (resolvedProjectId && canViewProjectInfo) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("organization_id", session.orgId)
      .eq("id", resolvedProjectId)
      .maybeSingle();
    projectInfo = data;
  }

  const pageSize = view === "kanban"
    ? (resolvedProjectId ? PROJECT_BOARD_LIMIT : GLOBAL_BOARD_LIMIT)
    : LIST_LIMIT;
  const boardBundle =
    view === "kanban"
      ? await loadTaskBoardPageForGlobalView(session.orgId, taskFilters, {
        limit: pageSize,
        offset: 0,
      })
      : { rows: [], totalCount: 0 };
  const listBundle =
    view === "kanban"
      ? { rows: [], totalCount: 0 }
      : await loadTasksPageForGlobalView(session.orgId, taskFilters, {
        limit: pageSize,
        offset: 0,
      });
  const filteredTotalCount =
    view === "kanban" ? boardBundle.totalCount : listBundle.totalCount;
  const initialLoadedCount =
    view === "kanban" ? boardBundle.rows.length : listBundle.rows.length;

  let scopedTaskCount: number | null = null;
  if (projectInfo) {
    const { count } = await supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.orgId)
      .eq("project_id", projectInfo.id);
    scopedTaskCount = count ?? 0;
  }

  const baseTaskQuery = () =>
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.orgId)
      .is("archived_at", null);
  let totalScope = baseTaskQuery();
  if (resolvedProjectId) totalScope = totalScope.eq("project_id", resolvedProjectId);
  let noDeadlineScope = baseTaskQuery()
    .neq("stage", "done")
    .is("planned_date", null)
    .is("due_date", null);
  if (resolvedProjectId) noDeadlineScope = noDeadlineScope.eq("project_id", resolvedProjectId);
  const [totalRes, noDeadlineRes] = await Promise.all([totalScope, noDeadlineScope]);
  const totalCount = totalRes.count ?? 0;
  const noDeadlineCount = noDeadlineRes.error ? null : noDeadlineRes.count ?? 0;

  const filterLabel = (() => {
    if (active.size === 1 && active.has("open")) return t("toolbar.openTasksFilter");
    if (active.size === 0 || active.has("all")) return t("toolbar.allTasksFilter");
    return t("toolbar.customFilter");
  })();
  const noDeadlineActive = active.size === 1 && active.has("no_deadline");
  const allTasksActive = active.size === 0 || active.has("all");

  const queryString = new URLSearchParams(
    Object.entries(sp).flatMap(([key, value]) =>
      value == null ? [] : [[key, String(value)]],
    ),
  ).toString();
  const toggleAllParams = new URLSearchParams(queryString);
  toggleAllParams.set("f", allTasksActive ? "open" : "all");
  toggleAllParams.delete("filter");
  const toggleAllHref = `/tasks${toggleAllParams.toString() ? `?${toggleAllParams.toString()}` : ""}`;

  return (
    <div>
      {projectInfo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan/30 bg-cyan-dim/30 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Briefcase className="size-4 shrink-0 text-cyan" />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-cyan/80">
                {t("projectScope")}
              </p>
              <p className="truncate text-sm font-semibold">
                {projectInfo.name}
                {scopedTaskCount !== null && (
                  <span className="ms-2 text-xs font-normal text-muted-foreground">
                    {t("taskCount", { count: scopedTaskCount })}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectInfo.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
            >
              <Briefcase className="size-3.5" />
              {t("projectInfo")}
            </Link>
            <Link
              href="/tasks"
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t("allTasks")}
            </Link>
          </div>
        </div>
      )}

      <TasksCountProvider key={queryString} initialLoaded={initialLoadedCount}>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
        <ViewSwitcher current={view} />
        <MonthQuickPick />
        <TaskCountBadge filterLabel={filterLabel} total={filteredTotalCount} />
        <Link
          href={toggleAllHref}
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            allTasksActive
              ? "border-cyan/40 bg-cyan-dim text-cyan"
              : "border-soft bg-card text-foreground/70 hover:text-foreground",
          )}
        >
          {allTasksActive ? "عرض المفتوحة فقط" : "عرض كل المهام"}
        </Link>
        <Link
          href={noDeadlineActive ? "/tasks" : "/tasks?f=no_deadline"}
          title={
            noDeadlineCount === null
              ? t("toolbar.kpiError")
              : t("toolbar.kpiNoDeadlineHint")
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            noDeadlineActive
              ? "border-cyan/40 bg-cyan-dim text-cyan"
              : "border-soft bg-card text-foreground/70 hover:text-foreground",
          )}
        >
          <CalendarOff className="size-3.5" />
          {t("toolbar.kpiNoDeadline")}
          {noDeadlineCount !== null && (
            <span className="tabular-nums rounded-full bg-soft-2/60 px-1.5 text-[10px]">
              {noDeadlineCount}
            </span>
          )}
        </Link>
        {filteredTotalCount !== totalCount && (
          <span className="text-[11px] text-muted-foreground">
            من أصل {totalCount}
          </span>
        )}
      </div>

      <TasksInfiniteView
        view={view}
        groupBy={groupBy}
        queryString={queryString}
        initialBoardTasks={boardBundle.rows}
        initialListTasks={listBundle.rows}
        totalCount={filteredTotalCount}
        pageSize={pageSize}
      />
      </TasksCountProvider>
    </div>
  );
}
