// Domain status badges. Each one accepts the raw enum value and renders the
// appropriate Arabic label with a color treatment matching the command-center palette.

import { cn } from "@/lib/utils";
import {
  TASK_STATUS_LABELS,
  TASK_STAGE_LABELS,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  HANDOVER_STATUS_LABELS,
  CLIENT_STATUS_LABELS,
  URGENCY_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  type TaskStatus,
  type TaskStage,
  type Priority,
  type ProjectStatus,
  type HandoverStatus,
  type ClientStatus,
  type UrgencyLevel,
  type EmploymentStatus,
} from "@/lib/labels";

const baseChip =
  "inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium tracking-tight whitespace-nowrap";

const tones = {
  cyan: "border-cyan/30 bg-cyan-dim text-cyan",
  green: "border-cc-green/30 bg-green-dim text-cc-green",
  amber: "border-amber/30 bg-amber-dim text-amber",
  red: "border-cc-red/30 bg-red-dim text-cc-red",
  blue: "border-cc-blue/30 bg-blue-dim text-cc-blue",
  purple: "border-cc-purple/30 bg-purple-dim text-cc-purple",
  pink: "border-pink/30 bg-pink/15 text-pink",
  muted: "border-white/10 bg-white/[0.04] text-muted-foreground",
} as const;

function Dot({ tone }: { tone: keyof typeof tones }) {
  const dot: Record<keyof typeof tones, string> = {
    cyan: "bg-cyan",
    green: "bg-cc-green",
    amber: "bg-amber",
    red: "bg-cc-red",
    blue: "bg-cc-blue",
    purple: "bg-cc-purple",
    pink: "bg-pink",
    muted: "bg-muted-foreground",
  };
  return <span className={cn("size-1.5 rounded-full", dot[tone])} aria-hidden />;
}

const taskTone: Record<TaskStatus, keyof typeof tones> = {
  todo: "muted",
  in_progress: "cyan",
  review: "amber",
  blocked: "red",
  done: "green",
  cancelled: "muted",
};

export function TaskStatusBadge({ status, className }: { status: TaskStatus | string; className?: string }) {
  const t = taskTone[status as TaskStatus] ?? "muted";
  const label = TASK_STATUS_LABELS[status as TaskStatus] ?? status;
  return (
    <span className={cn(baseChip, tones[t], className)}>
      <Dot tone={t} />
      {label}
    </span>
  );
}

// Sky Light / Rwasem 8-stage workflow badge.
const stageTone: Record<TaskStage, keyof typeof tones> = {
  new: "muted",
  in_progress: "cyan",
  manager_review: "purple",
  specialist_review: "amber",
  ready_to_send: "blue",
  sent_to_client: "blue",
  client_changes: "pink",
  done: "green",
};

export function TaskStageBadge({ stage, className }: { stage: TaskStage | string; className?: string }) {
  const t = stageTone[stage as TaskStage] ?? "muted";
  const label = TASK_STAGE_LABELS[stage as TaskStage] ?? stage;
  return (
    <span className={cn(baseChip, tones[t], className)}>
      <Dot tone={t} />
      {label}
    </span>
  );
}

const priorityTone: Record<Priority, keyof typeof tones> = {
  low: "muted",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

export function PriorityBadge({ priority, className }: { priority: Priority | string; className?: string }) {
  const t = priorityTone[priority as Priority] ?? "muted";
  const label = PRIORITY_LABELS[priority as Priority] ?? priority;
  const isUrgent = priority === "urgent";
  return (
    <span className={cn(baseChip, tones[t], isUrgent && "animate-[pulse_2.4s_ease-in-out_infinite]", className)}>
      <Dot tone={t} />
      {label}
    </span>
  );
}

const projectTone: Record<ProjectStatus, keyof typeof tones> = {
  active: "green",
  on_hold: "amber",
  completed: "blue",
  cancelled: "muted",
};
export function ProjectStatusBadge({ status, className }: { status: ProjectStatus | string; className?: string }) {
  const t = projectTone[status as ProjectStatus] ?? "muted";
  const label = PROJECT_STATUS_LABELS[status as ProjectStatus] ?? status;
  return <span className={cn(baseChip, tones[t], className)}><Dot tone={t} />{label}</span>;
}

const handoverTone: Record<HandoverStatus, keyof typeof tones> = {
  submitted: "cyan",
  in_review: "amber",
  accepted: "green",
  rejected: "red",
};
export function HandoverStatusBadge({ status, className }: { status: HandoverStatus | string; className?: string }) {
  const t = handoverTone[status as HandoverStatus] ?? "muted";
  const label = HANDOVER_STATUS_LABELS[status as HandoverStatus] ?? status;
  return <span className={cn(baseChip, tones[t], className)}><Dot tone={t} />{label}</span>;
}

const clientTone: Record<ClientStatus, keyof typeof tones> = {
  active: "green",
  inactive: "muted",
  lead: "blue",
};
export function ClientStatusBadge({ status, className }: { status: ClientStatus | string; className?: string }) {
  const t = clientTone[status as ClientStatus] ?? "muted";
  const label = CLIENT_STATUS_LABELS[status as ClientStatus] ?? status;
  return <span className={cn(baseChip, tones[t], className)}><Dot tone={t} />{label}</span>;
}

const urgencyTone: Record<UrgencyLevel, keyof typeof tones> = {
  low: "muted",
  normal: "blue",
  high: "amber",
  critical: "red",
};
export function UrgencyBadge({ level, className }: { level: UrgencyLevel | string; className?: string }) {
  const t = urgencyTone[level as UrgencyLevel] ?? "muted";
  const label = URGENCY_LABELS[level as UrgencyLevel] ?? level;
  return <span className={cn(baseChip, tones[t], className)}><Dot tone={t} />{label}</span>;
}

const employmentTone: Record<EmploymentStatus, keyof typeof tones> = {
  active: "green",
  on_leave: "blue",
  suspended: "amber",
  terminated: "muted",
};
export function EmploymentStatusBadge({ status, className }: { status: EmploymentStatus | string; className?: string }) {
  const t = employmentTone[status as EmploymentStatus] ?? "muted";
  const label = EMPLOYMENT_STATUS_LABELS[status as EmploymentStatus] ?? status;
  return <span className={cn(baseChip, tones[t], className)}><Dot tone={t} />{label}</span>;
}

const serviceTone: Record<string, keyof typeof tones> = {
  "social-media-management": "cyan",
  "seo": "amber",
  "media-buying": "purple",
};

export function ServiceBadge({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const t = serviceTone[slug] ?? "blue";
  return <span className={cn(baseChip, tones[t], className)}>{name}</span>;
}
