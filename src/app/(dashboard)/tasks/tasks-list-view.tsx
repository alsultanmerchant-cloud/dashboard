// Server component — Odoo-style rich tasks list/table view.
// Columns mirror Odoo's project.task list view: title, project, service,
// stage, priority, role-colored assignee dots, deadline (with delay), and
// time-in-stage. Click a row to open the task detail.

import Link from "next/link";
import { Clock, Calendar, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TASK_STAGE_LABELS,
  TASK_STAGE_TONES,
  TASK_ROLE_TYPES,
  TASK_ROLE_LABELS,
} from "@/lib/labels";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/status-badges";
import {
  DataTableShell,
  DataTable,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableCell,
} from "@/components/data-table-shell";
import { EmptyState } from "@/components/empty-state";
import { ListTodo } from "lucide-react";
import type { ListTaskRow } from "./_loaders";

const ROLE_DOT_FILL: Record<string, string> = {
  specialist: "bg-amber-400",
  manager: "bg-blue-400",
  agent: "bg-emerald-400",
  account_manager: "bg-rose-400",
  supporting_lead: "bg-violet-400",
  supporting_agent: "bg-violet-300",
};
const ROLE_DOT_RING: Record<string, string> = {
  specialist: "ring-amber-400/50",
  manager: "ring-blue-400/50",
  agent: "ring-emerald-400/50",
  account_manager: "ring-rose-400/50",
  supporting_lead: "ring-violet-400/50",
  supporting_agent: "ring-violet-300/50",
};

function formatDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 60_000) return "الآن";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}س ${minutes % 60}د`;
  const days = Math.floor(hours / 24);
  return `${days}ي ${hours % 24}س`;
}

function deadlineDelta(deadline: string | null): {
  days: number | null;
  label: string | null;
  tone: "late" | "today" | "soon" | "future" | null;
} {
  if (!deadline) return { days: null, label: null, tone: null };
  const ms = new Date(deadline).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < 0) return { days, label: `+${-days}d`, tone: "late" };
  if (days === 0) return { days, label: "اليوم", tone: "today" };
  if (days === 1) return { days, label: "غداً", tone: "soon" };
  if (days < 7) return { days, label: `بعد ${days}ي`, tone: "soon" };
  return { days, label: `بعد ${days}ي`, tone: "future" };
}

export function TasksListView({ tasks }: { tasks: ListTaskRow[] }) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo className="size-6" />}
        title="لا توجد مهام"
        description="لا توجد مهام تطابق هذا الفلتر حالياً."
      />
    );
  }

  return (
    <DataTableShell>
      <DataTable>
        <DataTableHead>
          <tr>
            <DataTableHeaderCell>المهمة</DataTableHeaderCell>
            <DataTableHeaderCell>المشروع</DataTableHeaderCell>
            <DataTableHeaderCell>الخدمة</DataTableHeaderCell>
            <DataTableHeaderCell>المرحلة</DataTableHeaderCell>
            <DataTableHeaderCell>الفريق</DataTableHeaderCell>
            <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
            <DataTableHeaderCell>الموعد النهائي</DataTableHeaderCell>
            <DataTableHeaderCell>المدة في المرحلة</DataTableHeaderCell>
            <DataTableHeaderCell>التقدم</DataTableHeaderCell>
            <DataTableHeaderCell aria-label="فتح" />
          </tr>
        </DataTableHead>
        <tbody>
          {tasks.map((t) => {
            const deadline = t.planned_date ?? t.due_date;
            const dl = deadlineDelta(deadline);
            const isLate = dl.tone === "late" && t.stage !== "done";
            const stageDuration = formatDuration(t.stage_entered_at);
            const slip = (t.expected_progress_percent ?? 0) - (t.progress_percent ?? 0);
            return (
              <DataTableRow key={t.id}>
                <DataTableCell className="max-w-[280px] font-medium">
                  <Link
                    href={`/tasks/${t.id}`}
                    className="line-clamp-1 hover:text-cyan transition-colors"
                  >
                    {t.title}
                  </Link>
                </DataTableCell>
                <DataTableCell className="max-w-[200px] text-xs">
                  <Link
                    href={`/projects/${t.project_id}`}
                    className="line-clamp-1 text-muted-foreground hover:text-cyan transition-colors"
                  >
                    {t.project_name}
                  </Link>
                  {t.client_name && (
                    <div className="text-[10px] text-muted-foreground/60 line-clamp-1">
                      {t.client_name}
                    </div>
                  )}
                </DataTableCell>
                <DataTableCell className="text-xs text-muted-foreground">
                  {t.service?.name ?? "—"}
                </DataTableCell>
                <DataTableCell>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                      TASK_STAGE_TONES[t.stage],
                    )}
                  >
                    {TASK_STAGE_LABELS[t.stage]}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <div className="flex items-center gap-1">
                    {TASK_ROLE_TYPES.map((role) => {
                      const e = t.role_slots[role];
                      return e ? (
                        <Avatar
                          key={role}
                          size="sm"
                          className={cn(
                            "ring-2 ring-offset-1 ring-offset-card",
                            ROLE_DOT_RING[role],
                          )}
                          title={`${TASK_ROLE_LABELS[role]}: ${e.full_name}`}
                        >
                          <AvatarFallback className="text-[10px]">
                            {e.full_name[0]}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <span
                          key={role}
                          className={cn(
                            "inline-block size-2 rounded-full opacity-25",
                            ROLE_DOT_FILL[role],
                          )}
                          title={`${TASK_ROLE_LABELS[role]}: غير معيّن`}
                        />
                      );
                    })}
                  </div>
                </DataTableCell>
                <DataTableCell>
                  <PriorityBadge priority={t.priority} />
                </DataTableCell>
                <DataTableCell>
                  {deadline ? (
                    <div
                      className={cn(
                        "inline-flex items-center gap-1 text-xs tabular-nums",
                        isLate && "text-cc-red font-medium",
                        dl.tone === "today" && "text-amber-300",
                      )}
                      dir="ltr"
                    >
                      <Calendar className="size-3" />
                      <span>{deadline}</span>
                      {dl.label && (
                        <span className="opacity-80">({dl.label})</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                    <Clock className="size-3" />
                    {stageDuration}
                  </span>
                </DataTableCell>
                <DataTableCell className="min-w-[140px]">
                  <div className="flex items-center gap-2">
                    <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-soft-2">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          slip > 10 ? "bg-cc-red" :
                          slip > 0 ? "bg-amber-400" :
                          "bg-emerald-400",
                        )}
                        style={{ width: `${Math.min(100, t.progress_percent ?? 0)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(t.progress_percent ?? 0)}%
                    </span>
                    {slip > 0 && (
                      <span className="text-[10px] tabular-nums text-cc-red">
                        خلف {Math.round(slip)}%
                      </span>
                    )}
                  </div>
                </DataTableCell>
                <DataTableCell>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-soft-2 hover:text-foreground transition-colors"
                    aria-label="فتح"
                  >
                    <ChevronLeft className="size-3.5 icon-flip-rtl" />
                  </Link>
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </tbody>
      </DataTable>
    </DataTableShell>
  );
}
