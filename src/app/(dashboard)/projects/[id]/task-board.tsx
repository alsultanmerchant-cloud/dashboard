"use client";

// Sky Light / Rwasem 8-stage Kanban board.
// Drag tasks between stage columns. Drop calls moveTaskStageAction;
// the DB trigger writes a task_stage_history row + flips completed_at.

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Loader2, Calendar, Clock, Hash, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TASK_STAGES,
  TASK_STAGE_LABELS,
  TASK_STAGE_TONES,
  TASK_ROLE_TYPES,
  TASK_ROLE_LABELS,
  type TaskStage,
  type TaskRoleType,
} from "@/lib/labels";

// Rwasem-style priority star — `urgent`/`high` paint a filled star (gold/red),
// medium = outline star, low = no star.
function PriorityStar({ priority, className }: { priority: string; className?: string }) {
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
      aria-label={`أولوية: ${priority}`}
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
import { moveTaskStageAction } from "../../tasks/_actions";

// Sky Light role dot color (matches TASK_ROLE_TONES — kept inline for the
// solid-fill avatar / placeholder dot variant).
const ROLE_DOT_FILL: Record<TaskRoleType, string> = {
  specialist: "bg-amber-400",
  manager: "bg-blue-400",
  agent: "bg-emerald-400",
  account_manager: "bg-rose-400",
};
const ROLE_DOT_RING: Record<TaskRoleType, string> = {
  specialist: "ring-amber-400/50",
  manager: "ring-blue-400/50",
  agent: "ring-emerald-400/50",
  account_manager: "ring-rose-400/50",
};

// -------- types ----------------------------------------------------------

export type BoardTask = {
  id: string;
  title: string;
  stage: TaskStage;
  stage_entered_at: string;
  planned_date: string | null;
  due_date: string | null;
  priority: string;
  progress_percent: number | null;
  expected_progress_percent: number | null;
  service: { id: string; name: string; slug: string } | null;
  // Optional project name — set when board is cross-project (global /tasks view)
  // so the card can show "Project · Client" under the task title like Odoo.
  project?: { id: string; name: string; client_name?: string | null } | null;
  // Slot-typed assignees: at most one per role.
  role_slots: Partial<
    Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
  >;
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

function formatDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const m = Math.max(0, Math.floor(ms / 60_000));
    return `${m}د`;
  }
  if (hours < 48) return `${hours}س`;
  return `${Math.floor(hours / 24)}ي`;
}

// Relative deadline label — mirrors Rwasem: "متأخرة ب X يوم" / "اليوم" / "خلال X أيام".
function deadlineLabel(deadline: string | null): {
  label: string;
  tone: "late" | "today" | "soon" | "future";
} | null {
  if (!deadline) return null;
  const days = Math.round(
    (new Date(deadline).getTime() - Date.now()) / 86_400_000,
  );
  if (days < 0) return { label: `متأخرة ب ${-days} يوم`, tone: "late" };
  if (days === 0) return { label: "اليوم", tone: "today" };
  if (days === 1) return { label: "غداً", tone: "soon" };
  if (days <= 7) return { label: `خلال ${days} أيام`, tone: "soon" };
  return { label: `لـ ${days} يوم`, tone: "future" };
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
  const stageDuration = formatDuration(task.stage_entered_at);
  const deadline = task.planned_date ?? task.due_date;
  const dl = deadlineLabel(task.stage === "done" ? null : deadline);
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
  const ref = `TSK-${String(task.id).slice(0, 8).toUpperCase()}`;
  const hasAssignee = TASK_ROLE_TYPES.some((r) => task.role_slots[r]);
  const svcColor = task.service ? serviceColor(task.service.slug) : null;

  return (
    <div
      className={cn(
        "group/card rounded-lg border bg-card p-2.5 shadow-sm transition-colors",
        dragging
          ? "border-primary/40 shadow-lg ring-1 ring-primary/30 cursor-grabbing"
          : "border-border hover:border-primary/30 cursor-grab",
      )}
      title={task.title}
    >
      {/* ── Row 1: REF · Project · Client · لـ X يوم · محدد ── */}
      <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground/80 leading-none">
        <span className="tabular-nums font-mono shrink-0">{ref}</span>
        {task.project && (
          <>
            <span aria-hidden className="opacity-40">·</span>
            <span className="truncate min-w-0">
              {task.project.name}
              {task.project.client_name && (
                <span className="opacity-60"> - {task.project.client_name}</span>
              )}
            </span>
          </>
        )}
        {dl && dl.tone === "future" && (
          <>
            <span aria-hidden className="opacity-40">·</span>
            <span className="shrink-0 tabular-nums text-muted-foreground/60">{dl.label}</span>
          </>
        )}
        {hasAssignee && (
          <span className="ms-auto shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
            محدد
          </span>
        )}
      </div>

      {/* ── Row 2: Task title ── */}
      <Link
        href={`/tasks/${task.id}`}
        className="block text-[13px] font-bold leading-snug text-foreground hover:text-primary transition-colors line-clamp-2"
        onClick={(e) => e.stopPropagation()}
      >
        {task.title}
      </Link>

      {/* ── Row 3: service badge · overdue badge · Behind % ── */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {task.service && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] text-foreground"
            title={task.service.name}
          >
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: svcColor ?? "#9c9c9c" }}
            />
            <span className="max-w-[14ch] truncate">{task.service.name}</span>
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
        {slip != null && slip > 0 && (
          <span
            className="inline-flex items-center rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400 tabular-nums"
            title="فرق التقدم"
          >
            Behind: {Math.round(slip)}%
          </span>
        )}
      </div>

      {/* ── Row 4: progress bar (only when meaningful) ── */}
      {(progress > 0 || (expected != null && expected > 0)) && (
        <div
          className="mt-2"
          title={
            expected != null
              ? `التقدم ${progress.toFixed(0)}% / المتوقع ${expected.toFixed(0)}%`
              : `التقدم ${progress.toFixed(0)}%`
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

      {/* ── Row 5 (footer): duration · assignee dots | star · ← → ── */}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        {/* left: stage duration · role dots */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5 tabular-nums" title="مدة في المرحلة">
            <Clock className="size-3" />
            {stageDuration}
          </span>
          {/* Role-slot dots (filled = assigned, faded = empty) */}
          <div className="flex items-center gap-0.5">
            {TASK_ROLE_TYPES.map((role) => {
              const e = task.role_slots[role];
              return e ? (
                <Avatar
                  key={role}
                  size="sm"
                  className={cn("size-5 ring-1 ring-card", ROLE_DOT_RING[role])}
                  title={`${TASK_ROLE_LABELS[role]}: ${e.full_name}`}
                >
                  <AvatarFallback className="text-[8px]">{e.full_name[0]}</AvatarFallback>
                </Avatar>
              ) : (
                <span
                  key={role}
                  className={cn("inline-block size-1.5 rounded-full opacity-20", ROLE_DOT_FILL[role])}
                  title={`${TASK_ROLE_LABELS[role]}: غير معيّن`}
                />
              );
            })}
          </div>
        </div>

        {/* right: priority star · prev ← · next → */}
        <div className="flex items-center gap-1">
          <PriorityStar priority={task.priority} />
          {prv && onRetreat && (
            <button
              type="button"
              disabled={advancing}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRetreat(prv); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-flex items-center rounded border border-border bg-muted/50 p-0.5 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-40"
              title={`الرجوع إلى: ${TASK_STAGE_LABELS[prv]}`}
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
              title={`نقل إلى: ${TASK_STAGE_LABELS[nxt]}`}
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

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(isDragging && "opacity-30")}
    >
      <TaskCard task={task} onAdvance={onAdvance} onRetreat={onRetreat} advancing={advancing} />
    </div>
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
}: {
  stage: TaskStage;
  tasks: BoardTask[];
  isMoving: boolean;
  onAdvance?: (taskId: string, next: TaskStage) => void;
  onRetreat?: (taskId: string, prev: TaskStage) => void;
  folded: boolean;
  onToggleFold: () => void;
}) {
  // Stable wrapper for dnd-kit — always a <div> so the droppable ref doesn't
  // remount when the user folds/unfolds the column.
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}` });

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
          title={`فتح: ${TASK_STAGE_LABELS[stage]}`}
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
            {TASK_STAGE_LABELS[stage]}
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
              {TASK_STAGE_LABELS[stage]}
              <span className="tabular-nums opacity-80">({tasks.length})</span>
            </span>
            <button
              type="button"
              onClick={onToggleFold}
              aria-label={`طي العمود ${TASK_STAGE_LABELS[stage]}`}
              title="طي العمود"
              className="rounded p-0.5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronLeft className="size-3.5 -rotate-90" />
            </button>
          </div>
          <div className="flex flex-col gap-2 p-2 min-h-24 max-h-[70vh] overflow-y-auto">
            {tasks.map((t) => (
              <DraggableCard
                key={t.id}
                task={t}
                advancing={isMoving}
                onAdvance={onAdvance ? (next) => onAdvance(t.id, next) : undefined}
                onRetreat={onRetreat ? (prev) => onRetreat(t.id, prev) : undefined}
              />
            ))}
            {tasks.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                {isMoving ? "…" : "—"}
              </div>
            )}
          </div>
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
        {tasks.map((t) => (
          <Link
            key={t.id}
            href={`/tasks/${t.id}`}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40 rounded-xl"
          >
            <TaskCard task={t} />
          </Link>
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

// -------- board ----------------------------------------------------------

export function TaskBoard({
  tasks: initialTasks,
  groupBy = "stage",
}: {
  tasks: BoardTask[];
  groupBy?: "stage" | "project";
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Folded columns — Rwasem defaults "done" to folded; user can unfold and
  // the choice is mirrored to localStorage.
  const [folded, setFolded] = useState<Set<TaskStage>>(() => new Set(["done"]));
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rwasem.kanban.folded");
      if (raw) setFolded(new Set(JSON.parse(raw) as TaskStage[]));
    } catch {}
  }, []);
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
    if (groupBy !== "project") return [];
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

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function moveTask(taskId: string, newStage: TaskStage) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.stage === newStage) return;
    const previousStage = task.stage;
    const previousEntered = task.stage_entered_at;
    setTasks((curr) =>
      curr.map((t) =>
        t.id === taskId
          ? { ...t, stage: newStage, stage_entered_at: new Date().toISOString() }
          : t,
      ),
    );
    start(async () => {
      const res = await moveTaskStageAction({ taskId, stage: newStage });
      if ("error" in res) {
        toast.error(res.error);
        setTasks((curr) =>
          curr.map((t) =>
            t.id === taskId
              ? { ...t, stage: previousStage, stage_entered_at: previousEntered }
              : t,
          ),
        );
        return;
      }
      toast.success(`المهمة → ${TASK_STAGE_LABELS[newStage]}`);
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

  if (groupBy === "project") {
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
            لا توجد مهام لعرضها.
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
          جاري الحفظ
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
              onRetreat={moveTask}
              folded={folded.has(s)}
              onToggleFold={() => toggleFold(s)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
