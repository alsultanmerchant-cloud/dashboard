import { ListTodo } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { TaskBoard, type BoardTask } from "../projects/[id]/task-board";
import { TasksListView } from "./tasks-list-view";
import { ViewSwitcher } from "./view-switcher";
import { loadTasksForGlobalView } from "./_loaders";
import { SmartSearchBar } from "./smart-search-bar";

const OPEN_STAGES = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
] as const;

const STAGE_FILTERS = [
  { key: "open", label: "مفتوحة" },
  { key: "all", label: "كل المهام" },
  { key: "overdue", label: "متأخرة" },
  { key: "done", label: "مكتملة" },
  { key: "mine", label: "مهامي" },
] as const;

type FilterKey = (typeof STAGE_FILTERS)[number]["key"];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    filter?: FilterKey;
    q?: string;
    projectId?: string;
    groupBy?: string;
  }>;
}) {
  const session = await requirePagePermission("tasks.view");
  const sp = await searchParams;
  const view = sp.view ?? "kanban";
  const filterKey = (sp.filter as FilterKey) ?? "open";
  const search = sp.q?.trim() || undefined;
  const groupBy: "stage" | "project" =
    sp.groupBy === "project" ? "project" : "stage";

  // In kanban view we always render all 8 stages, so the "open" stage filter
  // would just leave the "مكتملة" column permanently empty. Match Rwasem and
  // include done tasks on kanban; list view keeps the strict filter.
  const stageFilter =
    view === "kanban" && filterKey === "open"
      ? undefined
      : filterKey === "open"
        ? [...OPEN_STAGES]
        : filterKey === "done"
          ? ["done"]
          : undefined;

  const tasks = await loadTasksForGlobalView(session.orgId, {
    stage: stageFilter,
    overdue: filterKey === "overdue",
    assignedToEmployeeId:
      filterKey === "mine" ? session.employeeId : undefined,
    projectId: sp.projectId,
    search,
  });

  // BoardTask shape for kanban (cross-project: project name shown on card).
  const boardTasks: BoardTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    stage: t.stage,
    stage_entered_at: t.stage_entered_at,
    planned_date: t.planned_date,
    due_date: t.due_date,
    priority: t.priority,
    progress_percent: t.progress_percent,
    expected_progress_percent: t.expected_progress_percent,
    service: t.service,
    project: {
      id: t.project_id,
      name: t.project_name,
      client_name: t.client_name,
    },
    role_slots: t.role_slots,
  }));

  return (
    <div>
      <PageHeader
        title="المهام"
        description="جميع المهام عبر المشاريع — حركها بين المراحل بالسحب أو افتح التفاصيل."
      />

      {/* Top toolbar — Rwasem-style smart search bar (Filters / Group By /
          Favorites in a single dropdown) on the right, view switcher on the left. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
        <SmartSearchBar
          initialQuery={search ?? ""}
          filterKey={filterKey}
          view={view}
          groupBy={groupBy}
          totalCount={tasks.length}
        />
        <ViewSwitcher current={view} />
      </div>

      {view === "list" && <TasksListView tasks={tasks} />}
      {view === "kanban" && (
        <TaskBoard tasks={boardTasks} groupBy={groupBy} />
      )}
      {view === "calendar" && (
        <div className="rounded-2xl border border-dashed border-soft bg-card/30 p-12 text-center text-sm text-muted-foreground">
          <ListTodo className="mx-auto mb-3 size-6" />
          عرض التقويم قادم قريباً
        </div>
      )}
    </div>
  );
}

