import Link from "next/link";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { TASK_STAGE_LABELS, TASK_STAGE_TONES, type TaskStage } from "@/lib/labels";

// Strip emoji + keycap sequences (e.g. «… 4 مقالات 1️⃣») and collapse spaces so
// imported Odoo titles read cleanly. Keeps Arabic + latin + digits + dashes.
export function cleanTaskTitle(raw: string): string {
  return (raw || "")
    .replace(/[#*\d]️?⃣/g, "") // keycaps 1️⃣ 2️⃣ …
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, "") // pictographs
    .replace(/[\u{2600}-\u{27BF}]/gu, "") // misc symbols/dingbats
    .replace(/[\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]/gu, "") // arrows
    .replace(/[️‍]/g, "") // variation selectors / ZWJ
    .replace(/\s{2,}/g, " ")
    .trim();
}

const stageLabel = (s: string) => TASK_STAGE_LABELS[s as TaskStage] ?? s;
const stageTone = (s: string) => TASK_STAGE_TONES[s as TaskStage] ?? "bg-soft-1 text-muted-foreground border-border";

const PRIORITY: Record<string, { chip: string; flag: string; label: string }> = {
  urgent: { chip: "bg-red-dim text-cc-red", flag: "text-cc-red", label: "عاجل" },
  high: { chip: "bg-amber-dim text-amber", flag: "text-amber", label: "مرتفعة" },
  medium: { chip: "bg-cyan-dim text-cyan", flag: "text-cyan", label: "متوسطة" },
  low: { chip: "bg-soft-2 text-muted-foreground", flag: "text-muted-foreground", label: "منخفضة" },
};

const ACCENT: Record<string, string> = {
  red: "bg-cc-red",
  amber: "bg-amber",
  cyan: "bg-cyan/60",
  none: "bg-transparent",
};

export type TaskRowProps = {
  href: string;
  title: string;
  taskCode?: string | null;
  meta?: string | null; // client / project / assignee
  stage?: string | null;
  priority?: string | null;
  progressPercent?: number | null;
  accent?: "red" | "amber" | "cyan" | "none";
  /** Right-aligned trailing chip(s): due label, idle badge, etc. */
  trailing?: React.ReactNode;
};

export function TaskRow({
  href,
  title,
  taskCode,
  meta,
  stage,
  priority,
  progressPercent,
  accent = "none",
  trailing,
}: TaskRowProps) {
  const pri = priority ? PRIORITY[priority] ?? PRIORITY.medium : null;
  const clean = cleanTaskTitle(title);
  return (
    <Link
      href={href}
      className="group flex items-stretch overflow-hidden rounded-xl border border-border/70 bg-card transition-all hover:border-cyan/40 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
    >
      <span className={cn("w-1 shrink-0", ACCENT[accent])} />
      <div className="flex flex-1 items-center gap-3 p-3">
        {/* leading priority chip */}
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            pri ? pri.chip : "bg-soft-2 text-muted-foreground",
          )}
          title={pri ? `أولوية ${pri.label}` : undefined}
        >
          <Flag className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-snug text-foreground">{clean}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {taskCode && <span className="font-mono tracking-tight">{taskCode}</span>}
            {taskCode && meta && <span className="opacity-50">•</span>}
            {meta && <span className="truncate">{meta}</span>}
          </p>
          {progressPercent != null && progressPercent > 0 && (
            <div className="mt-1.5 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-soft-2">
              <div
                className={cn("h-full rounded-full", progressPercent >= 100 ? "bg-cc-green/60" : "bg-cyan/55")}
                style={{ width: `${Math.min(100, progressPercent)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {stage && (
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", stageTone(stage))}>
              {stageLabel(stage)}
            </span>
          )}
          {trailing}
        </div>
      </div>
    </Link>
  );
}
