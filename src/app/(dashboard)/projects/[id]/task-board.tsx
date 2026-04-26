"use client";

// Sky Light / Rwasem 8-stage Kanban board.
// Drag tasks between stage columns. Drop calls moveTaskStageAction;
// the DB trigger writes a task_stage_history row + flips completed_at.

import { useMemo, useState, useTransition } from "react";
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
import { Loader2, Calendar, Clock } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/status-badges";
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
  // Slot-typed assignees: at most one per role.
  role_slots: Partial<
    Record<TaskRoleType, { id: string; full_name: string; avatar_url: string | null }>
  >;
};

// -------- helpers --------------------------------------------------------

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

function delayFor(task: BoardTask): number | null {
  const deadline = task.planned_date ?? task.due_date;
  if (!deadline || task.stage === "done") return null;
  const days = Math.floor((Date.now() - new Date(deadline).getTime()) / 86_400_000);
  return days;
}

// -------- card -----------------------------------------------------------

function TaskCard({ task, dragging = false }: { task: BoardTask; dragging?: boolean }) {
  const delay = delayFor(task);
  const stageDuration = formatDuration(task.stage_entered_at);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/80 p-3 shadow-sm transition-colors",
        dragging
          ? "border-cyan/40 shadow-lg ring-1 ring-cyan/30 cursor-grabbing"
          : "border-white/[0.06] hover:border-white/[0.12] cursor-grab",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Link
          href={`/tasks/${task.id}`}
          className="line-clamp-2 text-sm font-medium leading-snug hover:text-cyan transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {task.title}
        </Link>
        <PriorityBadge priority={task.priority} className="shrink-0" />
      </div>

      {task.service && (
        <div className="mb-2 text-[10px] text-muted-foreground">
          {task.service.name}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1" title="مدة في المرحلة">
          <Clock className="size-3" />
          <span className="tabular-nums">{stageDuration}</span>
        </span>
        {(task.planned_date ?? task.due_date) && (
          <span
            className={cn(
              "inline-flex items-center gap-1 tabular-nums",
              delay != null && delay > 0 && "text-cc-red",
            )}
            title="الموعد النهائي"
          >
            <Calendar className="size-3" />
            <span dir="ltr">{task.planned_date ?? task.due_date}</span>
            {delay != null && delay > 0 && <span>+{delay}d</span>}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        {TASK_ROLE_TYPES.map((role) => {
          const e = task.role_slots[role];
          return e ? (
            <Avatar
              key={role}
              size="sm"
              className={cn("ring-2 ring-offset-1 ring-offset-card", ROLE_DOT_RING[role])}
              title={`${TASK_ROLE_LABELS[role]}: ${e.full_name}`}
            >
              <AvatarFallback className="text-[10px]">{e.full_name[0]}</AvatarFallback>
            </Avatar>
          ) : (
            <span
              key={role}
              className={cn(
                "inline-block size-2 rounded-full opacity-25",
                ROLE_DOT_FILL[role],
              )}
              title={`${TASK_ROLE_LABELS[role]}: غير معيّن`}
              aria-label={`${TASK_ROLE_LABELS[role]}: غير معيّن`}
            />
          );
        })}
      </div>
    </div>
  );
}

// -------- draggable wrapper ---------------------------------------------

function DraggableCard({ task }: { task: BoardTask }) {
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
      <TaskCard task={task} />
    </div>
  );
}

// -------- column ---------------------------------------------------------

function StageColumn({
  stage,
  tasks,
  isMoving,
}: {
  stage: TaskStage;
  tasks: BoardTask[];
  isMoving: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors",
        isOver && "border-cyan/40 bg-cyan/[0.06]",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-t-2xl border-b border-white/[0.04] px-3 py-2 text-xs font-semibold",
          TASK_STAGE_TONES[stage],
        )}
      >
        <span>{TASK_STAGE_LABELS[stage]}</span>
        <span className="tabular-nums opacity-80">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-24 max-h-[70vh] overflow-y-auto">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/[0.06] px-3 py-4 text-center text-[11px] text-muted-foreground">
            {isMoving ? "…" : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

// -------- board ----------------------------------------------------------

export function TaskBoard({ tasks: initialTasks }: { tasks: BoardTask[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, start] = useTransition();

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

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overId = e.over?.id;
    if (!overId || typeof overId !== "string" || !overId.startsWith("stage:")) return;
    const newStage = overId.slice("stage:".length) as TaskStage;
    const taskId = String(e.active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.stage === newStage) return;

    // optimistic
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
        // revert
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
