import dynamic from "next/dynamic";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase, CalendarOff } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { TaskBoard, type BoardTask } from "../projects/[id]/task-board";
import { ViewSwitcher } from "./view-switcher";
import { MonthQuickPick } from "./month-quick-pick";
import { loadTaskBoardForGlobalView, loadTasksForGlobalView } from "./_loaders";
import { DATE_FIELDS, type DateField } from "@/lib/data/tasks";

const TasksListView = dynamic(
  () =>
    import("./tasks-list-view").then((mod) => ({
      default: mod.TasksListView,
    })),
);

const TasksCalendarView = dynamic(
  () =>
    import("./tasks-calendar-view").then((mod) => ({
      default: mod.TasksCalendarView,
    })),
);

const TasksPivotView = dynamic(
  () =>
    import("./tasks-pivot-view").then((mod) => ({
      default: mod.TasksPivotView,
    })),
);

// Date filter token format: `<field>:<bucket>` where bucket is one of:
//   • `YYYY`         — whole year
//   • `YYYYqN`       — quarter N (1-4) of year
//   • `YYYYmN`       — month N (1-12) of year
// e.g. `due_date:2026,due_date:2026q3,actual_done_date:2025`.
function expandDateToken(token: string): { field: DateField; from: string; to: string } | null {
  const m = token.match(/^([a-z_]+):(\d{4})(?:(q)(\d)|(m)(\d{1,2}))?$/);
  if (!m) return null;
  const field = m[1] as DateField;
  if (!DATE_FIELDS.includes(field)) return null;
  const year = Number(m[2]);
  if (m[3] === "q" && m[4]) {
    const q = Number(m[4]);
    if (q < 1 || q > 4) return null;
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 3;
    return {
      field,
      from: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      to: endMonth > 12
        ? `${year + 1}-01-01`
        : `${year}-${String(endMonth).padStart(2, "0")}-01`,
    };
  }
  if (m[5] === "m" && m[6]) {
    const month = Number(m[6]);
    if (month < 1 || month > 12) return null;
    return {
      field,
      from: `${year}-${String(month).padStart(2, "0")}-01`,
      to: month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, "0")}-01`,
    };
  }
  return { field, from: `${year}-01-01`, to: `${year + 1}-01-01` };
}

function parseDateFilters(raw: string | undefined) {
  if (!raw) return undefined;
  const out: Array<{ field: DateField; from: string; to: string }> = [];
  for (const token of raw.split(",")) {
    const expanded = expandDateToken(token.trim());
    if (expanded) out.push(expanded);
  }
  return out.length ? out : undefined;
}

const OPEN_STAGES = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
] as const;

type FilterKey =
  | "open"
  | "all"
  | "overdue"
  | "done"
  | "mine"
  | "due_today"
  | "behind"
  | "ahead"
  | "critical"
  | "not_started"
  | "in_progress_pct"
  | "completed_pct"
  | "starred"
  | "followed"
  | "has_start_date"
  | "has_end_date"
  | "no_deadline"
  | "unassigned"
  | "over_timesheets"
  | "near_timesheets"
  | "archived";

const ALL_FILTER_KEYS: ReadonlySet<FilterKey> = new Set([
  "open", "all", "overdue", "done", "mine", "due_today", "behind", "ahead",
  "critical", "not_started", "in_progress_pct", "completed_pct", "starred", "followed",
  "has_start_date", "has_end_date", "no_deadline",
  "unassigned", "over_timesheets", "near_timesheets",
  "archived",
]);

function parseFilterKeys(raw: string | undefined, legacy: string | undefined): Set<FilterKey> {
  // Multi-select param `f=open,starred,behind`. Falls back to legacy `filter=open`
  // for shareable links saved before the multi-select rollout.
  const source = raw ?? legacy;
  if (source === undefined) return new Set(["open"]);
  if (source === "") return new Set();
  return new Set(
    source.split(",")
      .map((s) => s.trim())
      .filter((s): s is FilterKey => ALL_FILTER_KEYS.has(s as FilterKey)),
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    f?: string;
    d?: string;
    filter?: FilterKey;
    q?: string;
    projectId?: string;
    odooProjectId?: string;
    groupBy?: string;
  }>;
}) {
  const session = await requirePagePermission("tasks.view");
  const t = await getTranslations("TasksPage");
  const sp = await searchParams;
  const view = sp.view ?? "kanban";
  const active = parseFilterKeys(sp.f, sp.filter);
  const dateFilters = parseDateFilters(sp.d);
  const search = sp.q?.trim() || undefined;
  const VALID_GROUPS = [
    "stage", "project", "priority", "deadline",
    "assignee", "customer", "service", "last_stage_update",
    // #18 — Odoo parity additions.
    "progress", "status", "start_date",
    // §5.2 — Rwasem parity additions.
    "tags", "created_at",
  ] as const;
  type GroupKey = (typeof VALID_GROUPS)[number];
  // Comma-separated group-by stack (Rwasem-style "Stage > Assignee"). Pass the
  // full ordered list to TaskBoard; it renders a flat board for length 1 and a
  // nested outer/inner board for length 2+.
  const groupBy: GroupKey[] = (() => {
    const raw = sp.groupBy ?? "";
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const filtered = parts.filter((p): p is GroupKey =>
      (VALID_GROUPS as readonly string[]).includes(p),
    );
    return filtered.length ? filtered : ["stage"];
  })();

  // Stage filter combines "open" / "done" / "all". Both selected (or "all") =
  // every stage. Kanban view always shows the "done" column even when only
  // "open" is active — otherwise the column is permanently empty.
  const stageFilter: string[] | undefined = (() => {
    if (active.has("all")) return undefined;
    const stages: string[] = [];
    if (active.has("open")) stages.push(...OPEN_STAGES);
    if (active.has("done")) stages.push("done");
    if (stages.length === 0) return undefined;
    if (view === "kanban" && active.has("open") && !active.has("done")) return undefined;
    return stages;
  })();

  // Resolve odooProjectId → Supabase project UUID when coming from the
  // project card (which only knows the Odoo integer ID).
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

  const progressBuckets: Array<"not_started" | "in_progress" | "completed"> = [];
  if (active.has("not_started")) progressBuckets.push("not_started");
  if (active.has("in_progress_pct")) progressBuckets.push("in_progress");
  if (active.has("completed_pct")) progressBuckets.push("completed");

  const taskFilters = {
    stage: stageFilter,
    overdue: active.has("overdue"),
    dueToday: active.has("due_today"),
    behindSchedule: active.has("behind"),
    aheadSchedule: active.has("ahead"),
    criticalDelay: active.has("critical"),
    progressBuckets: progressBuckets.length ? progressBuckets : undefined,
    starred: active.has("starred"),
    hasStartDate: active.has("has_start_date"),
    hasEndDate: active.has("has_end_date"),
    noDeadline: active.has("no_deadline"),
    unassigned: active.has("unassigned"),
    overTimesheets: active.has("over_timesheets"),
    nearTimesheets: active.has("near_timesheets"),
    archived: active.has("archived"),
    followedByUserId: active.has("followed") ? session.userId : undefined,
    assignedToEmployeeId: active.has("mine") ? session.employeeId : undefined,
    projectId: resolvedProjectId,
    search,
    dateFilters,
  };

  const boardTasks: BoardTask[] =
    view === "kanban"
      ? await loadTaskBoardForGlobalView(session.orgId, taskFilters)
      : [];
  const tasks =
    view === "kanban"
      ? []
      : await loadTasksForGlobalView(session.orgId, taskFilters);

  // Project-scoped task count for the banner — only computed when projectId
  // is set. Cheap (count head) and clearly communicates "view is filtered".
  let scopedTaskCount: number | null = null;
  if (projectInfo) {
    const { count } = await supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.orgId)
      .eq("project_id", projectInfo.id);
    scopedTaskCount = count ?? 0;
  }

  // #1/#2: the count chip reports "<shown> of <total>" so the active filter
  // is unambiguous — matching Rwasem's search_default_my_open_tasks header.
  // #13: the "no deadline" KPI tile surfaces open tasks missing a date.
  const shownCount = view === "kanban" ? boardTasks.length : tasks.length;
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

  return (
    <div>
      {/* Sky Light §2.5: when /tasks is project-scoped via ?projectId=, render
          a prominent banner so the user knows the view is filtered (the prior
          tiny "Project Info" link was easy to miss; users reported the kanban
          looking like the global list). */}
      {projectInfo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan/30 bg-cyan-dim/30 px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Briefcase className="size-4 text-cyan shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-cyan/80">
                {t("projectScope")}
              </p>
              <p className="text-sm font-semibold truncate">
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

      {/* Top toolbar — Rwasem-style smart search bar (Filters / Group By /
          Favorites in a single dropdown) on the right, view switcher on the left. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
        <ViewSwitcher current={view} />
        <MonthQuickPick />
        {/* #1/#2: filter + count chip — makes the active domain unambiguous,
            mirroring Rwasem's "Open Tasks · N of M" header. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-soft bg-soft-1/50 px-2.5 py-1 text-[11px] font-medium"
          aria-label={t("toolbar.countAria", { shown: shownCount, total: totalCount })}
        >
          <span className="text-foreground">{filterLabel}</span>
          <span className="text-muted-foreground">·</span>
          <span className="tabular-nums text-foreground/70">
            {t("toolbar.countLabel", { shown: shownCount, total: totalCount })}
          </span>
        </span>
        {/* #13: "tasks without deadline" KPI tile — toggles the no_deadline filter. */}
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
      </div>

      {view === "list" && <TasksListView tasks={tasks} />}
      {view === "kanban" && (
        <TaskBoard tasks={boardTasks} groupBy={groupBy} />
      )}
      {view === "calendar" && <TasksCalendarView tasks={tasks} />}
      {view === "pivot" && <TasksPivotView tasks={tasks} />}
    </div>
  );
}
