import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PriorityBadge, ServiceBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";
import { DesignCountsRow } from "./design-counts-row";
import { DeadlineEditor } from "./deadline-editor";

type Project = {
  id: string;
  name: string;
} | null | undefined;

type Client = {
  id: string;
  name: string;
} | null | undefined;

type Service = {
  id: string;
  slug?: string | null;
  name: string;
} | null | undefined;

type TaskFormData = {
  id: string;
  priority: string;
  planned_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  actual_done_date: string | null;
  allocated_time_minutes: number | null;
  progress_percent: number | string | null;
  expected_progress_percent: number | string | null;
  progress_slip_percent: number | string | null;
  delay_days: number | null;
  hold_reason: string | null;
  hold_since: string | null;
  design_count: number;
  revision_count: number;
};

function formatMinutes(min: number | null, locale: string): string {
  if (min == null || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hourUnit = locale === "ar" ? "س" : "h";
  const minuteUnit = locale === "ar" ? "د" : "m";
  if (h === 0) return `${m}${minuteUnit}`;
  if (m === 0) return `${h}${hourUnit}`;
  return `${h}${hourUnit} ${m}${minuteUnit}`;
}

function formatPct(v: number | string | null): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[7.5rem_1fr] gap-2 py-1.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function TaskFormCard({
  task,
  project,
  client,
  service,
  computedDelayDays,
  overdue,
  formattedCompletedAt,
  canEditCounts,
  canEditDeadline,
}: {
  task: TaskFormData;
  project: Project;
  client: Client;
  service: Service;
  computedDelayDays: number | null;
  overdue: boolean;
  formattedCompletedAt: string | null;
  canEditCounts: boolean;
  canEditDeadline: boolean;
}) {
  const progress = task.progress_percent;
  const t = useTranslations("TaskDetailPage.form");
  const locale = useLocale();
  const progressNum =
    progress == null
      ? 0
      : typeof progress === "string"
        ? parseFloat(progress) || 0
        : progress;
  const slipNum =
    task.progress_slip_percent == null
      ? null
      : typeof task.progress_slip_percent === "string"
        ? parseFloat(task.progress_slip_percent)
        : task.progress_slip_percent;

  return (
    <Card>
      <CardContent className="grid gap-x-8 gap-y-0 p-5 md:grid-cols-2">
        <dl className="divide-y divide-soft/40">
          <Row label={t("project")}>
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                className="inline-flex items-center gap-1.5 font-medium hover:text-cyan transition-colors"
              >
                <Briefcase className="size-3.5" />
                {project.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {client?.name && (
              <div className="text-[11px] text-muted-foreground">
                {client.name}
              </div>
            )}
          </Row>
          <Row label={t("service")}>
            {service ? (
              <ServiceBadge slug={service.slug ?? ""} name={service.name} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label={t("priority")}>
            <PriorityBadge priority={task.priority} />
          </Row>
          <Row label={t("progress")}>
            <div className="flex items-center gap-2">
              <div className="relative h-1.5 w-32 overflow-hidden rounded-full bg-soft-2">
                <div
                  className={cn(
                    "h-full rounded-full",
                    slipNum != null && slipNum > 10
                      ? "bg-cc-red"
                      : slipNum != null && slipNum > 0
                        ? "bg-amber-400"
                        : "bg-emerald-400",
                  )}
                  style={{ width: `${Math.min(100, progressNum)}%` }}
                />
              </div>
              <span className="text-xs tabular-nums">
                {formatPct(progress)}
              </span>
            </div>
          </Row>
          <Row label={t("expectedProgress")}>
            <span className="tabular-nums">
              {formatPct(task.expected_progress_percent)}
            </span>
          </Row>
          <Row label={t("progressVariance")}>
            <span
              className={cn(
                "tabular-nums",
                slipNum != null && slipNum > 0 && "text-cc-red font-medium",
              )}
            >
              {formatPct(task.progress_slip_percent)}
            </span>
          </Row>
        </dl>

        <dl className="divide-y divide-soft/40">
          <Row label={t("allocatedTime")}>
            <span className="tabular-nums">
              {formatMinutes(task.allocated_time_minutes, locale)}
            </span>
          </Row>
          <Row label={t("deadline")}>
            <DeadlineEditor
              taskId={task.id}
              initialDate={task.planned_date ?? task.due_date ?? null}
              overdue={overdue}
              canEdit={canEditDeadline}
            />
          </Row>
          {task.due_date &&
            task.planned_date &&
            task.due_date !== task.planned_date && (
              <Row label={t("plannedDeadline")}>
                <span className="tabular-nums" dir="ltr">
                  {task.due_date}
                </span>
              </Row>
            )}
          {task.actual_done_date && (
            <Row label={t("actualDoneDate")}>
              <span className="text-cc-green tabular-nums" dir="ltr">
                {task.actual_done_date}
              </span>
            </Row>
          )}
          <Row label={t("completedAt")}>
            {formattedCompletedAt ? (
              <span className="text-cc-green tabular-nums" dir="ltr">
                {formattedCompletedAt}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label={t("delayDays")}>
            {computedDelayDays != null && computedDelayDays > 0 ? (
              <span className="text-cc-red tabular-nums font-medium">
                {computedDelayDays}
              </span>
            ) : (
              <span className="text-muted-foreground tabular-nums">0</span>
            )}
          </Row>
          {task.hold_reason && (
            <Row label={t("holdReason")}>
              <span className="text-amber-300">{task.hold_reason}</span>
            </Row>
          )}
          {/* Designer output — pair of integers used by the monthly closing
              report. Inline-editable so the agent can update them without
              leaving the task page; Odoo parity (project_customization). */}
          <DesignCountsRow
            taskId={task.id}
            initialDesignCount={task.design_count}
            initialRevisionCount={task.revision_count}
            canEdit={canEditCounts}
          />
        </dl>
      </CardContent>
    </Card>
  );
}
