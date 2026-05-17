"use client";

// Sky Light / Rwasem 8-stage Kanban board.
// Drag tasks between stage columns. Drop calls moveTaskStageAction;
// the DB trigger writes a task_stage_history row + flips completed_at.

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Loader2, Calendar, Clock, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TASK_STAGES,
  TASK_STAGE_LABELS,
  TASK_STAGE_LABELS_EN,
  TASK_STAGE_TONES,
  TASK_ROLE_TYPES,
  isForwardStageMove,
  type TaskStage,
  type TaskRoleType,
} from "@/lib/labels";
import { ConfirmDialog } from "@/components/confirm-dialog";

// Rwasem-style priority star — `urgent`/`high` paint a filled star (gold/red),
// medium = outline star, low = no star.
function PriorityStar({ priority, className }: { priority: string; className?: string }) {
  const locale = useLocale();
  if (priority === "low") return null;
  const filled = priority === "urgent" || priority === "high";
  const tone =
    priority === "urgent"
      ? "text-red-500"
      : priority === "high"
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <Star
      className={cn("size-3.5", tone, className)}
      fill={filled ? "currentColor" : "none"}
      strokeWidth={2}
      aria-label={`${locale.startsWith("en") ? "Priority" : "الأولوية"}: ${priority}`}
    />
  );
}

// Next / previous stage helpers (used for the ← → inline buttons).
function nextStage(s: TaskStage): TaskStage | null {
  const i = TASK_STAGES.indexOf(s);
  if (i < 0 || i >= TASK_STAGES.length - 1) return null;
  return TASK_STAGES[i + 1];
}
function prevStage(s: TaskStage): TaskStage | null {
  const i = TASK_STAGES.indexOf(s);
  if (i <= 0) return null;
  return TASK_STAGES[i - 1];
}
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { moveTaskStageAction, quickCreateTaskAction } from "../../tasks/_actions";

const INITIAL_VISIBLE_CARDS = 24;

// -------- types ----------------------------------------------------------

export type BoardTask = {
  id: string;
  title: string;
  task_code?: string | null;
  stage: TaskStage;
  stage_entered_at: string;
  planned_date: string | null;
  due_date: string | null;
  priority: string;
  progress_percent: number | null;
  expected_progress_percent: number | null;
  progress_slip_percent?: number | null;
  allocated_time_minutes?: number | null;
  delay_days?: number | null;
  completed_at?: string | null;
  // tasks.status — distinct from stage. Used by the "Status" group-by (#18)
  // to mirror Odoo's `state` filter. Optional because legacy callers pre-#18
  // didn't pass it; the group-by falls back to "بدون حالة" when absent.
  status?: string | null;
  service: { id: string; name: string; slug: string } | null;
  // Sky Light feedback #19: surface "# designs" and "# edits" alongside the
  // task. design_count is the manually-entered Odoo `project_customization`
  // field (Design / Post Count). closed_subtask_count is the count of
  // sub-tasks currently in stage=done — the Sky Light team treats each
  // closed sub-task as one revision/edit.
  design_count?: number | null;
  closed_subtask_count?: number | null;
  // Optional project name — set when board is cross-project (global /tasks view)
  // so the card can show "Project · Client" under the task title like Odoo.
  project?: { id: string; name: string; client_name?: string | null } | null;
  // Slot-typed assignees: at most one per role.
  role_slots: Partial<
    Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
  >;
  // §5.2: project tags + created_at surfaced so the kanban can group by
  // them (Rwasem parity).
  tags?: Array<{ id: string; name: string; color: number }>;
  created_at?: string;
  // PR-F (#3): origin — "odoo" for synced rows, null for dashboard-created.
  external_source?: string | null;
};

// -------- helpers --------------------------------------------------------

// Service slug → Odoo-palette hex (mirrors tag colors from skylight.rwasem.com).
const SERVICE_COLOR: Record<string, string> = {
  seo:                  "#dfb700", // amber/orange
  "media-buying":       "#28a745", // green
  media_buying:         "#28a745",
  "social-media":       "#3597d3", // light blue
  social_media:         "#3597d3",
  "account-manager":    "#5b8a72", // olive green
  account_manager:      "#5b8a72",
  design:               "#9b59b6", // purple
  content:              "#2a9d8f", // teal
  photography:          "#f4a261", // sand
  video:                "#e63946", // raspberry
  copywriting:          "#264653", // dark teal
};

/** Returns the dot color for a service by slug (falls back to a stable hash). */
function serviceColor(slug: string): string {
  const direct = SERVICE_COLOR[slug.toLowerCase()];
  if (direct) return direct;
  // Try prefix match (e.g. "renewal-seo" → seo)
  for (const [key, val] of Object.entries(SERVICE_COLOR)) {
    if (slug.toLowerCase().includes(key.replace(/-/g, "_"))) return val;
    if (slug.toLowerCase().includes(key)) return val;
  }
  // Stable hash fallback using the Odoo palette
  const PALETTE = ["#9c9c9c","#d44d4d","#dfb700","#3597d3","#5b8a72","#9b59b6","#2a9d8f","#f4a261","#28a745","#5241c3"];
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function formatDuration(fromIso: string, locale: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const m = Math.max(0, Math.floor(ms / 60_000));
    return locale.startsWith("en") ? `${m}m` : `${m}د`;
  }
  if (hours < 48) return locale.startsWith("en") ? `${hours}h` : `${hours}س`;
  return locale.startsWith("en") ? `${Math.floor(hours / 24)}d` : `${Math.floor(hours / 24)}ي`;
}

// Relative deadline label — mirrors Rwasem: "متأخرة ب X يوم" / "اليوم" / "خلال X أيام".
function deadlineLabel(deadline: string | null, locale: string): {
  label: string;
  tone: "late" | "today" | "soon" | "future";
} | null {
  if (!deadline) return null;
  const days = Math.round(
    (new Date(deadline).getTime() - Date.now()) / 86_400_000,
  );
  if (locale.startsWith("en")) {
    if (days < 0) return { label: `${-days}d overdue`, tone: "late" };
    if (days === 0) return { label: "Today", tone: "today" };
    if (days === 1) return { label: "Tomorrow", tone: "soon" };
    if (days <= 7) return { label: `In ${days} days`, tone: "soon" };
    return { label: `${days}d left`, tone: "future" };
  }
  if (days < 0) return { label: `متأخرة ب ${-days} يوم`, tone: "late" };
  if (days === 0) return { label: "اليوم", tone: "today" };
  if (days === 1) return { label: "غداً", tone: "soon" };
  if (days <= 7) return { label: `خلال ${days} أيام`, tone: "soon" };
  return { label: `لـ ${days} يوم`, tone: "future" };
}

function stageLabel(stage: TaskStage, locale: string): string {
  return locale.startsWith("en") ? TASK_STAGE_LABELS_EN[stage] : TASK_STAGE_LABELS[stage];
}

// -------- card -----------------------------------------------------------

function TaskCard({
  task,
  dragging = false,
  onAdvance,
  onRetreat,
  advancing = false,
}: {
  task: BoardTask;
  dragging?: boolean;
  onAdvance?: (next: TaskStage) => void;
  onRetreat?: (prev: TaskStage) => void;
  advancing?: boolean;
}) {
  const t = useTranslations("TasksBoard");
  const locale = useLocale();
  const stageDuration = formatDuration(task.stage_entered_at, locale);
  const deadline = task.planned_date ?? task.due_date;
  const dl = deadlineLabel(task.stage === "done" ? null : deadline, locale);
  const progress =
    typeof task.progress_percent === "number"
      ? task.progress_percent
      : task.progress_percent
        ? parseFloat(String(task.progress_percent))
        : 0;
  const expected =
    typeof task.expected_progress_percent === "number"
      ? task.expected_progress_percent
      : task.expected_progress_percent
        ? parseFloat(String(task.expected_progress_percent))
        : null;
  const slip = expected != null ? expected - progress : null;
  const nxt = nextStage(task.stage);
  const prv = prevStage(task.stage);
  const ref = task.task_code ?? `TSK-${String(task.id).slice(0, 8).toUpperCase()}`;
  const hasAssignee = TASK_ROLE_TYPES.some((r) => task.role_slots[r]);
  const svcColor = task.service ? serviceColor(task.service.slug) : null;

  // Index in the 8-stage Rwasem sequence — drives the bottom progress dots.
  const stageIndex = TASK_STAGES.indexOf(task.stage);
  // Up to 3 distinct assignees collapsed to an overlap stack.
  const assigneeList = TASK_ROLE_TYPES
    .map((r) => task.role_slots[r])
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .reduce<NonNullable<(typeof task.role_slots)[TaskRoleType]>[]>((acc, e) => {
      if (!acc.find((x) => x.id === e.id)) acc.push(e);
      return acc;
    }, []);

  return (
    <div
      className={cn(
        "group/card relative overflow-hidden rounded-lg border bg-card p-2.5 ps-3 shadow-sm transition-colors",
        dragging
          ? "border-primary/40 shadow-lg ring-1 ring-primary/30 cursor-grabbing"
          : "border-border hover:border-primary/30 cursor-grab",
      )}
      title={task.title}
    >
      {/* Left service stripe (Rwasem cards inherit the service tag color) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-0 w-1"
        style={{ backgroundColor: svcColor ?? "#9c9c9c" }}
      />

      {/* ── Row 1: stacked meta to avoid clipped inline content ── */}
      <div className="mb-1 space-y-1 text-[11px] text-muted-foreground/80">
        <div className="flex items-start justify-between gap-2 leading-none">
          <span className="tabular-nums font-mono shrink-0">{ref}</span>
          {hasAssignee && (
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
              {t("assigned")}
            </span>
          )}
        </div>
        {task.project && (
          <div className="leading-relaxed break-words">
            <span>{task.project.name}</span>
            {task.project.client_name && (
              <span className="opacity-60"> - {task.project.client_name}</span>
            )}
          </div>
        )}
        {dl && dl.tone === "future" && (
          <div className="tabular-nums text-muted-foreground/60">{dl.label}</div>
        )}
      </div>

      {/* ── Row 2: Task title ── */}
      <Link
        href={`/tasks/${task.id}`}
        className="block break-words text-[13px] font-bold leading-snug text-foreground transition-colors hover:text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {task.title}
      </Link>

      {/* ── Row 3: service badge · overdue badge · Behind % ── */}
      <div className="mt-1.5 flex flex-col items-start gap-1">
        {task.service && (
          <span
            className="inline-flex max-w-full items-center rounded-full bg-muted/60 px-2.5 py-1 text-[10px] text-foreground"
            title={task.service.name}
          >
            <span className="break-words whitespace-normal leading-none">
              {task.service.name}
            </span>
          </span>
        )}
        {dl && dl.tone !== "future" && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              dl.tone === "late"  && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              dl.tone === "today" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              dl.tone === "soon"  && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
            )}
            title={deadline ?? undefined}
          >
            <Calendar className="size-2.5 shrink-0" />
            {dl.label}
          </span>
        )}
        {slip != null && slip > 5 && (
          <span
            className="inline-flex items-center rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400 tabular-nums"
            title={t("progressVariance")}
          >
            {t("behind")} {Math.round(slip)}%
          </span>
        )}
        {slip != null && slip < -2 && (
          <span
            className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums"
            title={t("progressVariance")}
          >
            {t("ahead")} {Math.round(-slip)}%
          </span>
        )}
      </div>

      {/* ── Row 3.5: one-column detail rows so card data never compresses ── */}
      <dl className="mt-1.5 space-y-1 text-[10px] leading-snug">
        {(task.due_date || task.planned_date) && (
          <div className="space-y-0.5">
            <dt className="text-muted-foreground/80">{t("deadline")}:</dt>
            <dd className="break-words tabular-nums text-foreground/80" dir="ltr">
              {(task.due_date ?? task.planned_date ?? "").slice(0, 10)}
            </dd>
          </div>
        )}
        {task.completed_at && (
          <div className="space-y-0.5">
            <dt className="text-muted-foreground/80">{t("completionDate")}:</dt>
            <dd className="break-words tabular-nums text-emerald-700 dark:text-emerald-300" dir="ltr">
              {task.completed_at.slice(0, 10)}
            </dd>
          </div>
        )}
        {task.allocated_time_minutes != null && task.allocated_time_minutes > 0 && (
          <div className="space-y-0.5">
            <dt className="text-muted-foreground/80">{t("allocatedTime")}:</dt>
            <dd className="break-words tabular-nums text-foreground/80">
              {task.allocated_time_minutes >= 60
                ? locale.startsWith("en")
                  ? `${(task.allocated_time_minutes / 60).toFixed(1)} h`
                  : `${(task.allocated_time_minutes / 60).toFixed(1)} س`
                : locale.startsWith("en")
                  ? `${task.allocated_time_minutes} m`
                  : `${task.allocated_time_minutes} د`}
            </dd>
          </div>
        )}
        {task.delay_days != null && task.delay_days > 0 && (
          <div className="space-y-0.5">
            <dt className="text-muted-foreground/80">{t("delayDays")}:</dt>
            <dd className="break-words font-semibold tabular-nums text-red-600 dark:text-red-400">
              {task.delay_days}
            </dd>
          </div>
        )}
        {expected != null && expected > 0 && (
          <div className="space-y-0.5">
            <dt className="text-muted-foreground/80">{t("expectedProgress")}:</dt>
            <dd className="break-words tabular-nums text-foreground/80">{expected.toFixed(1)}%</dd>
          </div>
        )}
      </dl>

      {/* ── Row 4: progress bar (only when meaningful) ── */}
      {(progress > 0 || (expected != null && expected > 0)) && (
        <div
          className="mt-2"
          title={
            expected != null
              ? `${t("progress")} ${progress.toFixed(0)}% / ${t("expected")} ${expected.toFixed(0)}%`
              : `${t("progress")} ${progress.toFixed(0)}%`
          }
        >
          <div className="relative h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                slip != null && slip > 10
                  ? "bg-red-500"
                  : slip != null && slip > 0
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
            {expected != null && expected > 0 && (
              <div
                className="absolute top-0 h-full w-0.5 bg-foreground/40"
                style={{ insetInlineStart: `${Math.min(100, Math.max(0, expected))}%` }}
                aria-hidden
              />
            )}
          </div>
        </div>
      )}

      {/* ── Row 5: stage progression strip (Odoo-style 8-step dots) ── */}
      <div
        className="mt-2 flex items-center gap-1"
        title={`${t("stage")}: ${stageLabel(task.stage, locale)} (${stageIndex + 1}/${TASK_STAGES.length})`}
      >
        {TASK_STAGES.map((s, i) => (
          <span
            key={s}
            aria-hidden
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < stageIndex
                ? "bg-primary/50"
                : i === stageIndex
                  ? "bg-primary"
                  : "bg-muted",
            )}
          />
        ))}
      </div>

      {/* ── Row 6 (footer): duration | star · ← → · avatar stack ── */}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        {/* left: stage duration */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5 tabular-nums" title={t("timeInStage")}>
            <Clock className="size-3" />
            {stageDuration}
          </span>
        </div>

        {/* right: avatar stack · priority · prev ← · next → */}
        <div className="flex items-center gap-1.5">
          {assigneeList.length > 0 && (
            <div className="flex -space-x-1.5 -space-x-reverse">
              {assigneeList.slice(0, 3).map((e) => (
                <Avatar
                  key={e.id}
                  size="sm"
                  className="size-6 ring-2 ring-card"
                  title={e.full_name}
                >
                  <AvatarFallback className="bg-primary/20 text-[9px] text-primary">
                    {e.full_name[0]}
                  </AvatarFallback>
                </Avatar>
              ))}
              {assigneeList.length > 3 && (
                <span className="grid size-6 place-items-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card">
                  +{assigneeList.length - 3}
                </span>
              )}
            </div>
          )}
          <PriorityStar priority={task.priority} />
          {prv && onRetreat && (
            <button
              type="button"
              disabled={advancing}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRetreat(prv); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-flex items-center rounded border border-border bg-muted/50 p-0.5 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-40"
              title={`${t("moveBackTo")}: ${stageLabel(prv, locale)}`}
            >
              <ChevronRight className="size-3.5 icon-flip-rtl" />
            </button>
          )}
          {nxt && onAdvance && (
            <button
              type="button"
              disabled={advancing}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onAdvance(nxt); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-flex items-center rounded border border-primary/30 bg-primary/5 p-0.5 text-primary transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary disabled:opacity-40"
              title={`${t("moveTo")}: ${stageLabel(nxt, locale)}`}
            >
              <ChevronLeft className="size-3.5 icon-flip-rtl" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------- draggable wrapper ---------------------------------------------

function DraggableCard({
  task,
  onAdvance,
  onRetreat,
  advancing,
}: {
  task: BoardTask;
  onAdvance?: (next: TaskStage) => void;
  onRetreat?: (prev: TaskStage) => void;
  advancing?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });
  // dnd-kit's `aria-describedby` carries a globally-incrementing counter that
  // differs between server and client renders → hydration mismatch. Skip the
  // attributes during SSR; the drag handlers attach right after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      ref={setNodeRef}
      {...(mounted ? attributes : {})}
      {...(mounted ? listeners : {})}
      className={cn(isDragging && "opacity-30")}
      suppressHydrationWarning
    >
      <TaskCard task={task} onAdvance={onAdvance} onRetreat={onRetreat} advancing={advancing} />
    </div>
  );
}

function VisibleTaskList({
  tasks,
  renderTask,
}: {
  tasks: BoardTask[];
  renderTask: (task: BoardTask) => React.ReactNode;
}) {
  const t = useTranslations("TasksBoard");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_CARDS);
  const visibleTasks = tasks.slice(0, visibleCount);
  const remainingCount = Math.max(0, tasks.length - visibleTasks.length);

  return (
    <>
      {visibleTasks.map((task) => renderTask(task))}
      {remainingCount > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_CARDS)}
          className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          {t("showMore", {
            count: Math.min(INITIAL_VISIBLE_CARDS, remainingCount),
            totalSuffix: remainingCount > INITIAL_VISIBLE_CARDS ? ` ${t("from")} ${remainingCount}` : "",
          })}
        </button>
      )}
    </>
  );
}

// -------- column ---------------------------------------------------------

function StageColumn({
  stage,
  tasks,
  isMoving,
  onAdvance,
  onRetreat,
  folded,
  onToggleFold,
  onQuickCreate,
}: {
  stage: TaskStage;
  tasks: BoardTask[];
  isMoving: boolean;
  onAdvance?: (taskId: string, next: TaskStage) => void;
  onRetreat?: (taskId: string, prev: TaskStage) => void;
  folded: boolean;
  onToggleFold: () => void;
  /** Optional: enables the Rwasem "+ add task" footer per column. */
  onQuickCreate?: (stage: TaskStage, title: string) => Promise<void> | void;
}) {
  const t = useTranslations("TasksBoard");
  const locale = useLocale();
  // Stable wrapper for dnd-kit — always a <div> so the droppable ref doesn't
  // remount when the user folds/unfolds the column.
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}` });

  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  async function submit() {
    if (!onQuickCreate) return;
    const t = draft.trim();
    if (!t || creating) return;
    setCreating(true);
    try {
      await onQuickCreate(stage, t);
      setDraft("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex shrink-0 flex-col rounded-2xl border bg-muted transition-[width,background-color,border-color]",
        folded ? "w-10" : "w-72",
        isOver
          ? "border-primary/40 bg-primary/10"
          : "border-border",
      )}
    >
      {folded ? (
        // Rwasem-style folded rail: count badge + rotated title, click to unfold
        <button
          type="button"
          onClick={onToggleFold}
          title={`${t("open")}: ${stageLabel(stage, locale)}`}
          className="group flex h-full w-full flex-col items-center gap-2 py-3"
        >
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
              TASK_STAGE_TONES[stage],
            )}
          >
            {tasks.length}
          </span>
          <span
            className="text-xs font-semibold text-foreground/70 group-hover:text-foreground"
            style={{ writingMode: "vertical-rl" }}
          >
            {stageLabel(stage, locale)}
          </span>
        </button>
      ) : (
        <>
          <div
            className={cn(
              "flex items-center justify-between gap-2 rounded-t-2xl border-b border-border px-3 py-2 text-xs font-semibold",
              TASK_STAGE_TONES[stage],
            )}
          >
            <span className="flex items-center gap-1.5">
              {stageLabel(stage, locale)}
              <span className="tabular-nums opacity-80">({tasks.length})</span>
            </span>
            <button
              type="button"
              onClick={onToggleFold}
              aria-label={`${t("collapseColumn")} ${stageLabel(stage, locale)}`}
              title={t("collapseColumn")}
              className="rounded p-0.5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronLeft className="size-3.5 -rotate-90" />
            </button>
          </div>
          <div className="flex flex-col gap-2 p-2 min-h-24 max-h-[70vh] overflow-y-auto">
            <VisibleTaskList
              tasks={tasks}
              renderTask={(t) => (
                <DraggableCard
                  key={t.id}
                  task={t}
                  advancing={isMoving}
                  onAdvance={onAdvance ? (next) => onAdvance(t.id, next) : undefined}
                  onRetreat={onRetreat ? (prev) => onRetreat(t.id, prev) : undefined}
                />
              )}
            />
            {tasks.length === 0 && !onQuickCreate && (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                {isMoving ? "…" : "—"}
              </div>
            )}
          </div>
          {onQuickCreate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="border-t border-border p-2"
            >
              <input
                type="text"
                value={draft}
                disabled={creating}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("newTaskPlaceholder")}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
              />
            </form>
          )}
        </>
      )}
    </div>
  );
}

// Project-grouped column (read-only — no DnD stage transitions, since
// columns aren't stages). Mirrors the Rwasem default task kanban view.
function ProjectColumn({
  projectId,
  projectName,
  clientName,
  tasks,
}: {
  projectId: string;
  projectName: string;
  clientName: string | null;
  tasks: BoardTask[];
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-soft bg-soft-1">
      <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-soft px-3 py-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${projectId}`}
            className="line-clamp-1 text-xs font-semibold hover:text-cyan transition-colors"
          >
            {projectName}
          </Link>
          {clientName && (
            <div className="line-clamp-1 text-[10px] text-muted-foreground">
              {clientName}
            </div>
          )}
        </div>
        <span className="tabular-nums text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-24 max-h-[70vh] overflow-y-auto">
        <VisibleTaskList
          tasks={tasks}
          renderTask={(t) => (
            <Link
              key={t.id}
              href={`/tasks/${t.id}`}
              className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40 rounded-xl"
            >
              <TaskCard task={t} />
            </Link>
          )}
        />
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed border-soft px-3 py-4 text-center text-[11px] text-muted-foreground">
            —
          </div>
        )}
      </div>
    </div>
  );
}

function BucketColumn({
  title,
  tasks,
}: {
  title: string;
  tasks: BoardTask[];
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-soft bg-soft-1">
      <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-soft px-3 py-2">
        <div className="line-clamp-1 text-xs font-semibold">{title}</div>
        <span className="tabular-nums text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-24 max-h-[70vh] overflow-y-auto">
        <VisibleTaskList
          tasks={tasks}
          renderTask={(t) => (
            <Link
              key={t.id}
              href={`/tasks/${t.id}`}
              className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40 rounded-xl"
            >
              <TaskCard task={t} />
            </Link>
          )}
        />
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed border-soft px-3 py-4 text-center text-[11px] text-muted-foreground">
            —
          </div>
        )}
      </div>
    </div>
  );
}

// Outer column for stacked group-by: header is the OUTER bucket name+count;
// body is a list of inner sub-sections (one per inner-key bucket) where each
// sub-section has its own mini-header + collapsible card list.
function NestedColumn({
  title,
  tasks,
  innerKey,
}: {
  title: string;
  tasks: BoardTask[];
  innerKey: TaskGroupKey;
}) {
  const inner = bucketTasksBy(tasks, innerKey);
  return (
    <div className="flex w-80 shrink-0 flex-col rounded-2xl border border-soft bg-soft-1">
      <div className="flex items-start justify-between gap-2 rounded-t-2xl border-b border-soft px-3 py-2">
        <div className="line-clamp-1 text-xs font-semibold">{title}</div>
        <span className="tabular-nums text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-24 max-h-[75vh] overflow-y-auto">
        {inner.map((sub) => (
          <NestedSubsection key={sub.id} title={sub.name} tasks={sub.tasks} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed border-soft px-3 py-4 text-center text-[11px] text-muted-foreground">
            —
          </div>
        )}
      </div>
    </div>
  );
}

function NestedSubsection({
  title,
  tasks,
}: {
  title: string;
  tasks: BoardTask[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg border border-soft/70 bg-background/40">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 rounded-t-lg px-2 py-1.5 hover:bg-soft-1"
      >
        <span className="line-clamp-1 text-[11px] font-semibold text-muted-foreground">
          {title}
        </span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1.5 p-1.5">
          <VisibleTaskList
            tasks={tasks}
            renderTask={(t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40"
              >
                <TaskCard task={t} />
              </Link>
            )}
          />
        </div>
      )}
    </div>
  );
}

// -------- board ----------------------------------------------------------

export type TaskGroupKey =
  | "stage"
  | "project"
  | "priority"
  | "deadline"
  | "assignee"
  | "customer"
  | "service"
  | "last_stage_update"
  // #18 (filter parity with Odoo): progress bucket, distinct workflow
  // status, and start-date (planned_date) month groupings.
  | "progress"
  | "status"
  | "start_date"
  // §5.2 (Rwasem parity): project-tags + creation-date week groupings.
  | "tags"
  | "created_at";

type TaskBucket = { id: string; name: string; tasks: BoardTask[] };

// Generic bucket function. Same data each existing useMemo produces, but
// reachable both at the top level (current behaviour) and nested inside an
// outer bucket (PR 5: stacked group-by, e.g. Stage > Assignee).
function bucketTasksBy(tasks: BoardTask[], key: TaskGroupKey): TaskBucket[] {
  const NONE = "__none__";

  if (key === "stage") {
    const order: TaskStage[] = [
      "new", "in_progress", "manager_review", "specialist_review",
      "ready_to_send", "sent_to_client", "client_changes", "done",
    ];
    const map = new Map<TaskStage, BoardTask[]>(order.map((s) => [s, []]));
    for (const t of tasks) map.get(t.stage)?.push(t);
    return order.map((s) => ({
      id: s,
      name: TASK_STAGE_LABELS[s],
      tasks: map.get(s) ?? [],
    }));
  }

  if (key === "project") {
    const order: string[] = [];
    const byId = new Map<string, TaskBucket>();
    for (const t of tasks) {
      const id = t.project?.id ?? NONE;
      const name = t.project?.name ?? "بدون مشروع";
      if (!byId.has(id)) {
        byId.set(id, { id, name, tasks: [] });
        order.push(id);
      }
      byId.get(id)!.tasks.push(t);
    }
    return order.map((id) => byId.get(id)!);
  }

  if (key === "priority") {
    const order: Array<{ key: string; label: string }> = [
      { key: "urgent", label: "عاجلة" },
      { key: "high", label: "عالية" },
      { key: "medium", label: "متوسطة" },
      { key: "low", label: "منخفضة" },
      { key: NONE, label: "بدون أولوية" },
    ];
    const buckets = new Map<string, BoardTask[]>(order.map((o) => [o.key, []]));
    for (const t of tasks) {
      const k = ["urgent", "high", "medium", "low"].includes(t.priority) ? t.priority : NONE;
      buckets.get(k)!.push(t);
    }
    return order
      .map((o) => ({ id: o.key, name: o.label, tasks: buckets.get(o.key) ?? [] }))
      .filter((c) => c.tasks.length > 0 || c.id !== NONE);
  }

  if (key === "progress") {
    const order: Array<{ key: string; label: string }> = [
      { key: "not_started", label: "لم تبدأ (0%)" },
      { key: "in_progress", label: "قيد التنفيذ (1-99%)" },
      { key: "completed", label: "منجزة (100%)" },
      { key: NONE, label: "غير محدد" },
    ];
    const buckets = new Map<string, BoardTask[]>(order.map((o) => [o.key, []]));
    for (const t of tasks) {
      const p = t.progress_percent;
      if (p === null || p === undefined) buckets.get(NONE)!.push(t);
      else if (p <= 0) buckets.get("not_started")!.push(t);
      else if (p >= 100) buckets.get("completed")!.push(t);
      else buckets.get("in_progress")!.push(t);
    }
    return order
      .map((o) => ({ id: o.key, name: o.label, tasks: buckets.get(o.key) ?? [] }))
      .filter((c) => c.tasks.length > 0 || c.id !== NONE);
  }

  if (key === "status") {
    // tasks.status workflow column from migration 0003. Distinct from `stage`.
    const order: Array<{ key: string; label: string }> = [
      { key: "todo", label: "للتنفيذ" },
      { key: "in_progress", label: "قيد التنفيذ" },
      { key: "review", label: "مراجعة" },
      { key: "blocked", label: "متوقفة" },
      { key: "done", label: "مكتملة" },
      { key: "cancelled", label: "ملغاة" },
      { key: NONE, label: "بدون حالة" },
    ];
    const buckets = new Map<string, BoardTask[]>(order.map((o) => [o.key, []]));
    for (const t of tasks) {
      const k = t.status && order.some((o) => o.key === t.status) ? t.status : NONE;
      buckets.get(k as string)!.push(t);
    }
    return order
      .map((o) => ({ id: o.key, name: o.label, tasks: buckets.get(o.key) ?? [] }))
      .filter((c) => c.tasks.length > 0);
  }

  if (key === "start_date") {
    // Bucket by planned_date month — Odoo parity for "Group By: Start Date".
    const map = new Map<string, TaskBucket>();
    const push = (id: string, name: string, t: BoardTask) => {
      const col = map.get(id) ?? { id, name, tasks: [] };
      col.tasks.push(t);
      map.set(id, col);
    };
    const MONTH_AR = [
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
      "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
    ];
    for (const t of tasks) {
      const raw = t.planned_date;
      if (!raw) {
        push(NONE, "بدون تاريخ بدء", t);
        continue;
      }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        push(NONE, "بدون تاريخ بدء", t);
        continue;
      }
      const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      push(id, `${MONTH_AR[d.getMonth()]} ${d.getFullYear()}`, t);
    }
    // Sort by id ascending so months read chronologically, "بدون" last.
    return [...map.values()].sort((a, b) => {
      if (a.id === NONE) return 1;
      if (b.id === NONE) return -1;
      return a.id.localeCompare(b.id);
    });
  }

  if (key === "deadline") {
    const order: Array<{ key: string; label: string }> = [
      { key: "overdue", label: "متأخرة" },
      { key: "today", label: "اليوم" },
      { key: "week", label: "هذا الأسبوع" },
      { key: "later", label: "لاحقاً" },
      { key: "none", label: "غير محدد" },
      { key: "done", label: "مكتملة" },
    ];
    const buckets = new Map<string, BoardTask[]>(order.map((o) => [o.key, []]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    for (const t of tasks) {
      if (t.stage === "done") {
        buckets.get("done")!.push(t);
        continue;
      }
      const raw = t.planned_date ?? t.due_date;
      if (!raw) {
        buckets.get("none")!.push(t);
        continue;
      }
      const d = new Date(raw);
      d.setHours(0, 0, 0, 0);
      if (Number.isNaN(d.getTime())) buckets.get("none")!.push(t);
      else if (d < today) buckets.get("overdue")!.push(t);
      else if (d.getTime() === today.getTime()) buckets.get("today")!.push(t);
      else if (d <= weekEnd) buckets.get("week")!.push(t);
      else buckets.get("later")!.push(t);
    }
    return order
      .map((o) => ({ id: o.key, name: o.label, tasks: buckets.get(o.key) ?? [] }))
      .filter((c) => c.tasks.length > 0);
  }

  // assignee / customer / service / last_stage_update / tags / created_at
  // — same shape as the existing `customColumns` memo, count-desc with a
  // "بدون …" fallback last.
  const noneLabel =
    key === "assignee" ? "بدون مسؤول"
      : key === "customer" ? "بدون عميل"
        : key === "service" ? "بدون خدمة"
          : key === "tags" ? "بدون وسم"
            : "بدون تاريخ";
  const map = new Map<string, TaskBucket>();
  const push = (id: string, name: string, t: BoardTask) => {
    const col = map.get(id) ?? { id, name, tasks: [] };
    col.tasks.push(t);
    map.set(id, col);
  };
  function weekBucketLocal(rawDate: string | undefined | null) {
    if (!rawDate) return null;
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return null;
    const monday = new Date(d);
    const dow = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - dow);
    monday.setHours(0, 0, 0, 0);
    const id = monday.toISOString().slice(0, 10);
    return { id, label: `أسبوع ${id}` };
  }
  for (const t of tasks) {
    if (key === "assignee") {
      const slots = Object.values(t.role_slots ?? {});
      const assigned = slots.filter(Boolean) as Array<{ id: string; full_name: string }>;
      if (assigned.length === 0) push(NONE, noneLabel, t);
      else for (const a of assigned) push(a.id, a.full_name, t);
    } else if (key === "customer") {
      const name = t.project?.client_name ?? null;
      if (name) push(`c:${name}`, name, t);
      else push(NONE, noneLabel, t);
    } else if (key === "service") {
      if (t.service?.id) push(t.service.id, t.service.name, t);
      else push(NONE, noneLabel, t);
    } else if (key === "tags") {
      const tagList = t.tags ?? [];
      if (tagList.length === 0) push(NONE, noneLabel, t);
      else for (const tag of tagList) push(`tag:${tag.id}`, tag.name, t);
    } else if (key === "created_at") {
      const bucket = weekBucketLocal(t.created_at);
      if (!bucket) push(NONE, noneLabel, t);
      else push(bucket.id, bucket.label, t);
    } else {
      const bucket = weekBucketLocal(t.stage_entered_at);
      if (!bucket) push(NONE, noneLabel, t);
      else push(bucket.id, bucket.label, t);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === NONE) return 1;
    if (b.id === NONE) return -1;
    return b.tasks.length - a.tasks.length;
  });
}

export function TaskBoard({
  tasks: initialTasks,
  groupBy = "stage",
  projectId,
}: {
  tasks: BoardTask[];
  /**
   * Comma-friendly group-by: pass a single key for flat columns OR an array
   * for nested rendering (outer column + inner sub-sections, Rwasem-style).
   */
  groupBy?: TaskGroupKey | TaskGroupKey[];
  /** Optional: when set, each non-folded column shows a Rwasem-style quick-add input. */
  projectId?: string;
}) {
  const groupKeys: TaskGroupKey[] = Array.isArray(groupBy)
    ? groupBy.filter(Boolean)
    : [groupBy];
  const outerKey = groupKeys[0] ?? "stage";
  const innerKey = groupKeys[1];

  const t = useTranslations("TasksBoard");
  const locale = useLocale();
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Folded columns — Rwasem defaults "done" to folded; user can unfold and
  // the choice is mirrored to localStorage.
  const [folded, setFolded] = useState<Set<TaskStage>>(() => {
    if (typeof window === "undefined") return new Set(["done"]);
    try {
      const raw = window.localStorage.getItem("rwasem.kanban.folded");
      if (raw) return new Set(JSON.parse(raw) as TaskStage[]);
    } catch {}
    return new Set(["done"]);
  });
  function toggleFold(s: TaskStage) {
    setFolded((curr) => {
      const next = new Set(curr);
      if (next.has(s)) next.delete(s); else next.add(s);
      try {
        localStorage.setItem("rwasem.kanban.folded", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const grouped = useMemo(() => {
    const map: Record<TaskStage, BoardTask[]> = {
      new: [],
      in_progress: [],
      manager_review: [],
      specialist_review: [],
      ready_to_send: [],
      sent_to_client: [],
      client_changes: [],
      done: [],
    };
    for (const t of tasks) map[t.stage]?.push(t);
    return map;
  }, [tasks]);

  const projectColumns = useMemo(() => {
    if (outerKey !== "project") return [];
    const order: string[] = [];
    const byId = new Map<
      string,
      { id: string; name: string; client_name: string | null; tasks: BoardTask[] }
    >();
    for (const t of tasks) {
      const p = t.project;
      const id = p?.id ?? "__none__";
      const name = p?.name ?? "بدون مشروع";
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name,
          client_name: p?.client_name ?? null,
          tasks: [],
        });
        order.push(id);
      }
      byId.get(id)!.tasks.push(t);
    }
    return order.map((id) => byId.get(id)!);
  }, [tasks, groupBy]);

  // Priority grouping: fixed column order urgent → high → medium → low. Any
  // unknown priority value falls into a "بدون أولوية" bucket so we never lose
  // tasks. Hidden when groupBy is something else.
  const priorityColumns = useMemo(() => {
    if (outerKey !== "priority") return [];
    const order: Array<{ key: string; label: string }> = [
      { key: "urgent", label: "عاجلة" },
      { key: "high",   label: "عالية" },
      { key: "medium", label: "متوسطة" },
      { key: "low",    label: "منخفضة" },
      { key: "__none__", label: "بدون أولوية" },
    ];
    const buckets = new Map<string, BoardTask[]>(order.map((o) => [o.key, []]));
    for (const t of tasks) {
      const k = ["urgent", "high", "medium", "low"].includes(t.priority)
        ? t.priority
        : "__none__";
      buckets.get(k)!.push(t);
    }
    return order
      .map((o) => ({ id: o.key, name: o.label, tasks: buckets.get(o.key) ?? [] }))
      .filter((c) => c.tasks.length > 0 || c.id !== "__none__");
  }, [tasks, groupBy]);

  // Deadline grouping: bucket by planned_date (falls back to due_date) into
  // متأخرة / اليوم / هذا الأسبوع / لاحقاً / غير محدد. "Done" tasks land in
  // their own bucket so finished work doesn't pollute the active buckets.
  const deadlineColumns = useMemo(() => {
    if (outerKey !== "deadline") return [];
    const order: Array<{ key: string; label: string }> = [
      { key: "overdue", label: "متأخرة" },
      { key: "today",   label: "اليوم" },
      { key: "week",    label: "هذا الأسبوع" },
      { key: "later",   label: "لاحقاً" },
      { key: "none",    label: "غير محدد" },
      { key: "done",    label: "مكتملة" },
    ];
    const buckets = new Map<string, BoardTask[]>(order.map((o) => [o.key, []]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    for (const t of tasks) {
      if (t.stage === "done") {
        buckets.get("done")!.push(t);
        continue;
      }
      const raw = t.planned_date ?? t.due_date;
      if (!raw) {
        buckets.get("none")!.push(t);
        continue;
      }
      const d = new Date(raw);
      d.setHours(0, 0, 0, 0);
      if (Number.isNaN(d.getTime())) {
        buckets.get("none")!.push(t);
        continue;
      }
      if (d < today) buckets.get("overdue")!.push(t);
      else if (d.getTime() === today.getTime()) buckets.get("today")!.push(t);
      else if (d <= weekEnd) buckets.get("week")!.push(t);
      else buckets.get("later")!.push(t);
    }
    return order
      .map((o) => ({ id: o.key, name: o.label, tasks: buckets.get(o.key) ?? [] }))
      .filter((c) => c.tasks.length > 0);
  }, [tasks, groupBy]);

  // Generic bucket for the four "any field" groupings — assignee / customer /
  // service / last_stage_update. Each returns a list of {id, name, tasks}
  // ordered by task count desc, with a "بدون …" fallback bucket sorted last.
  const customColumns = useMemo(() => {
    if (
      outerKey !== "assignee" &&
      outerKey !== "customer" &&
      outerKey !== "service" &&
      outerKey !== "last_stage_update" &&
      outerKey !== "tags" &&
      outerKey !== "created_at"
    ) {
      return [];
    }
    type Col = { id: string; name: string; tasks: BoardTask[] };
    const NONE = "__none__";
    const noneLabel =
      outerKey === "assignee"
        ? "بدون مسؤول"
        : outerKey === "customer"
          ? "بدون عميل"
          : outerKey === "service"
            ? "بدون خدمة"
            : outerKey === "tags"
              ? "بدون وسم"
              : "بدون تاريخ";
    const map = new Map<string, Col>();
    const push = (id: string, name: string, t: BoardTask) => {
      const col = map.get(id) ?? { id, name, tasks: [] };
      col.tasks.push(t);
      map.set(id, col);
    };
    function weekBucket(rawDate: string | undefined | null) {
      if (!rawDate) return null;
      const d = new Date(rawDate);
      if (Number.isNaN(d.getTime())) return null;
      const monday = new Date(d);
      const day = (monday.getDay() + 6) % 7;
      monday.setDate(monday.getDate() - day);
      monday.setHours(0, 0, 0, 0);
      const id = monday.toISOString().slice(0, 10);
      return { id, label: `أسبوع ${id}` };
    }
    for (const t of tasks) {
      if (outerKey === "assignee") {
        const slots = Object.values(t.role_slots ?? {});
        const assigned = slots.filter(Boolean) as Array<{ id: string; full_name: string }>;
        if (assigned.length === 0) push(NONE, noneLabel, t);
        else for (const a of assigned) push(a.id, a.full_name, t);
      } else if (outerKey === "customer") {
        const name = t.project?.client_name ?? null;
        if (name) push(`c:${name}`, name, t);
        else push(NONE, noneLabel, t);
      } else if (outerKey === "service") {
        if (t.service?.id) push(t.service.id, t.service.name, t);
        else push(NONE, noneLabel, t);
      } else if (outerKey === "tags") {
        const tagList = t.tags ?? [];
        if (tagList.length === 0) push(NONE, noneLabel, t);
        else for (const tag of tagList) push(`tag:${tag.id}`, tag.name, t);
      } else if (outerKey === "created_at") {
        const bucket = weekBucket(t.created_at);
        if (!bucket) push(NONE, noneLabel, t);
        else push(bucket.id, bucket.label, t);
      } else {
        const bucket = weekBucket(t.stage_entered_at);
        if (!bucket) push(NONE, noneLabel, t);
        else push(bucket.id, bucket.label, t);
      }
    }
    const out = [...map.values()].sort((a, b) => {
      if (a.id === NONE) return 1;
      if (b.id === NONE) return -1;
      return b.tasks.length - a.tasks.length;
    });
    return out;
  }, [tasks, groupBy]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  // Pending stage move awaiting user confirmation in the alert dialog.
  const [pendingMove, setPendingMove] = useState<{
    taskId: string;
    fromStage: TaskStage;
    toStage: TaskStage;
  } | null>(null);

  function moveTask(taskId: string, newStage: TaskStage) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.stage === newStage) return;
    if (!isForwardStageMove(task.stage, newStage)) {
      toast.error(t("cannotMoveBack"));
      return;
    }
    setPendingMove({ taskId, fromStage: task.stage, toStage: newStage });
  }

  function confirmPendingMove() {
    if (!pendingMove) return;
    const { taskId, fromStage, toStage } = pendingMove;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      setPendingMove(null);
      return;
    }
    const previousEntered = task.stage_entered_at;
    setTasks((curr) =>
      curr.map((t) =>
        t.id === taskId
          ? { ...t, stage: toStage, stage_entered_at: new Date().toISOString() }
          : t,
      ),
    );
    setPendingMove(null);
    start(async () => {
      const res = await moveTaskStageAction({ taskId, stage: toStage });
      if ("error" in res) {
        toast.error(res.error);
        setTasks((curr) =>
          curr.map((t) =>
            t.id === taskId
              ? { ...t, stage: fromStage, stage_entered_at: previousEntered }
              : t,
          ),
        );
        return;
      }
      toast.success(`${t("taskMoved")} ${stageLabel(toStage, locale)}`);
      router.refresh();
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overId = e.over?.id;
    if (!overId || typeof overId !== "string" || !overId.startsWith("stage:")) return;
    const newStage = overId.slice("stage:".length) as TaskStage;
    moveTask(String(e.active.id), newStage);
  }

  // Nested grouping (Rwasem stacked group-by like "Stage > Assignee"): outer
  // produces columns, inner produces collapsible sub-sections inside each.
  if (innerKey) {
    const outerCols = bucketTasksBy(tasks, outerKey);
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {outerCols.map((col) => (
          <NestedColumn
            key={col.id}
            title={col.name}
            tasks={col.tasks}
            innerKey={innerKey}
          />
        ))}
        {outerCols.length === 0 && (
          <div className="w-full rounded-2xl border border-dashed border-soft bg-card/30 p-12 text-center text-sm text-muted-foreground">
            {t("noTasksToShow")}
          </div>
        )}
      </div>
    );
  }

  if (outerKey === "project") {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {projectColumns.map((col) => (
          <ProjectColumn
            key={col.id}
            projectId={col.id}
            projectName={col.name}
            clientName={col.client_name}
            tasks={col.tasks}
          />
        ))}
        {projectColumns.length === 0 && (
          <div className="w-full rounded-2xl border border-dashed border-soft bg-card/30 p-12 text-center text-sm text-muted-foreground">
            {t("noTasksToShow")}
          </div>
        )}
      </div>
    );
  }

  if (outerKey === "priority" || outerKey === "deadline") {
    const cols = outerKey === "priority" ? priorityColumns : deadlineColumns;
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cols.map((col) => (
          <BucketColumn key={col.id} title={col.name} tasks={col.tasks} />
        ))}
        {cols.length === 0 && (
          <div className="w-full rounded-2xl border border-dashed border-soft bg-card/30 p-12 text-center text-sm text-muted-foreground">
            {t("noTasksToShow")}
          </div>
        )}
      </div>
    );
  }

  if (
    outerKey === "assignee" ||
    outerKey === "customer" ||
    outerKey === "service" ||
    outerKey === "last_stage_update"
  ) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {customColumns.map((col) => (
          <BucketColumn key={col.id} title={col.name} tasks={col.tasks} />
        ))}
        {customColumns.length === 0 && (
          <div className="w-full rounded-2xl border border-dashed border-soft bg-card/30 p-12 text-center text-sm text-muted-foreground">
            {t("noTasksToShow")}
          </div>
        )}
      </div>
    );
  }

  // #18 — Odoo parity group-bys (progress / status / start_date) share the
  // generic BucketColumn renderer fed by bucketTasksBy.
  if (
    outerKey === "progress" ||
    outerKey === "status" ||
    outerKey === "start_date"
  ) {
    const cols = bucketTasksBy(tasks, outerKey);
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {cols.map((col) => (
          <BucketColumn key={col.id} title={col.name} tasks={col.tasks} />
        ))}
        {cols.length === 0 && (
          <div className="w-full rounded-2xl border border-dashed border-soft bg-card/30 p-12 text-center text-sm text-muted-foreground">
            {t("noTasksToShow")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      {pending && (
        <div className="absolute end-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full bg-card/80 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur">
          <Loader2 className="size-3 animate-spin" />
          {t("saving")}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {TASK_STAGES.map((s) => (
            <StageColumn
              key={s}
              stage={s}
              tasks={grouped[s]}
              isMoving={pending}
              onAdvance={moveTask}
              folded={folded.has(s)}
              onToggleFold={() => toggleFold(s)}
              onQuickCreate={
                projectId
                  ? async (stage, title) => {
                      const res = await quickCreateTaskAction({
                        projectId,
                        stage,
                        title,
                      });
                      if ("error" in res) {
                        toast.error(res.error);
                      } else {
                        toast.success(t("taskCreated"));
                        router.refresh();
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} dragging /> : null}
        </DragOverlay>
      </DndContext>
      <ConfirmDialog
        open={pendingMove !== null}
        onOpenChange={(o) => {
          if (!o && !pending) setPendingMove(null);
        }}
        title={t("confirmMoveTitle")}
        description={
          pendingMove ? (
            <>
              {t("confirmMoveFrom")}{" "}
              <span className="font-semibold text-foreground">
                {stageLabel(pendingMove.fromStage, locale)}
              </span>{" "}
              {t("confirmMoveTo")}{" "}
              <span className="font-semibold text-foreground">
                {stageLabel(pendingMove.toStage, locale)}
              </span>
              ? {t("confirmMoveWarning")}
            </>
          ) : null
        }
        confirmLabel={t("confirmMove")}
        onConfirm={confirmPendingMove}
        pending={pending}
      />
    </div>
  );
}
