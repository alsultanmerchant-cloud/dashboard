// Server component — renders the chronological list of project status
// updates posted via postProjectStatusUpdateAction. Uses the audit_logs
// table as the source of truth so AI eventing + the feed share state.

import { CheckCircle2, AlertTriangle, AlertOctagon, Flag, ArrowRight, MoveRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { TASK_STAGE_LABELS } from "@/lib/labels";
import { avatarUrlFor } from "@/lib/utils-format";
import {
  listProjectStatusUpdates,
  type ProjectUpdateRow,
  type StatusValue,
} from "./_status-actions";

function stageLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return TASK_STAGE_LABELS[s as keyof typeof TASK_STAGE_LABELS] ?? s;
}

const STATUS_META: Record<
  StatusValue,
  { label: string; icon: React.ReactNode; tone: string }
> = {
  on_track: {
    label: "On Track",
    icon: <CheckCircle2 className="size-3.5" />,
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  at_risk: {
    label: "At Risk",
    icon: <AlertTriangle className="size-3.5" />,
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  off_track: {
    label: "Off Track",
    icon: <AlertOctagon className="size-3.5" />,
    tone: "bg-red-500/15 text-red-700 dark:text-red-300",
  },
  done: {
    label: "Done",
    icon: <Flag className="size-3.5" />,
    tone: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
  },
};

function formatRelative(iso: string) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "الآن";
  if (min < 60) return `منذ ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `منذ ${hr} س`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `منذ ${day} يوم`;
  return date.toISOString().slice(0, 10);
}

export async function UpdatesFeed({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string | null;
}) {
  if (!projectId) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-center">
          <Flag className="mx-auto size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">لا يوجد مشروع مرتبط بقاعدة البيانات</p>
          <p className="text-xs text-muted-foreground">
            استورد المشروع أولاً لتمكين سجل التحديثات.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows: ProjectUpdateRow[] = await listProjectStatusUpdates(
    organizationId,
    projectId,
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-center">
          <Flag className="mx-auto size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">لا توجد تحديثات بعد</p>
          <p className="text-xs text-muted-foreground">
            انشر أول تحديث للمشروع من الشريط أعلاه.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ol className="space-y-3">
      {rows.map((u) => {
        if (u.kind === "task_stage") {
          return <TaskStageEntry key={u.id} u={u} />;
        }
        return <StatusUpdateEntry key={u.id} u={u} />;
      })}
    </ol>
  );
}

function StatusUpdateEntry({ u }: { u: ProjectUpdateRow }) {
  const meta = u.status ? STATUS_META[u.status] : null;
  const prev = u.previousStatus ? STATUS_META[u.previousStatus] : null;
  const avatarSrc = avatarUrlFor(u.actorName, u.actorAvatar);
  return (
    <li>
      <Card>
        <CardContent className="flex gap-3 p-3">
          <Avatar size="sm" className="size-10 shrink-0">
            {avatarSrc ? (
              <AvatarImage src={avatarSrc} alt={u.actorName ?? ""} />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-[13px] font-semibold text-primary">
              {u.actorName?.[0] ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-bold">{u.actorName ?? "—"}</span>
              {prev && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium opacity-70",
                    prev.tone,
                  )}
                >
                  {prev.icon}
                  {prev.label}
                </span>
              )}
              {prev && meta && <ArrowRight className="size-3 text-muted-foreground" />}
              {meta && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                    meta.tone,
                  )}
                >
                  {meta.icon}
                  {meta.label}
                </span>
              )}
              <span className="ms-auto text-[10px] text-muted-foreground">
                {formatRelative(u.createdAt)}
              </span>
            </div>
            {u.note && (
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-foreground/90">
                {u.note}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function TaskStageEntry({ u }: { u: ProjectUpdateRow }) {
  const avatarSrc = avatarUrlFor(u.actorName, u.actorAvatar);
  return (
    <li>
      <Card className="bg-card/60">
        <CardContent className="flex items-center gap-3 p-2.5">
          <Avatar size="sm" className="size-8 shrink-0">
            {avatarSrc ? (
              <AvatarImage src={avatarSrc} alt={u.actorName ?? ""} />
            ) : null}
            <AvatarFallback className="bg-muted text-[11px] font-semibold text-muted-foreground">
              {u.actorName?.[0] ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[12px]">
            <span className="font-bold text-foreground">{u.actorName ?? "—"}</span>
            <span className="text-muted-foreground">نقل المهمة</span>
            <span className="truncate font-semibold text-foreground" title={u.taskTitle ?? ""}>
              «{u.taskTitle ?? "—"}»
            </span>
            <span className="text-muted-foreground">من</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              {stageLabel(u.taskFromStage)}
            </span>
            <MoveRight className="size-3 text-muted-foreground" />
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              {stageLabel(u.taskToStage)}
            </span>
            <span className="ms-auto text-[10px] text-muted-foreground">
              {formatRelative(u.createdAt)}
            </span>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
