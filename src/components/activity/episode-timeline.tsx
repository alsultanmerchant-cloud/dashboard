import Link from "next/link";
import { X, CheckCircle2, Clock, CircleDot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import type { EpisodeRow } from "@/lib/data/activity-scores";

const NA = "—";

function stageLabel(s: string) {
  return TASK_STAGE_LABELS[s as TaskStage] ?? s;
}

function fmt(iso: string | null): string {
  if (!iso) return NA;
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(iso));
}

const ANSWER_KIND: Record<string, string> = {
  stage_advance: "تقدّم المرحلة",
  approval: "اعتماد",
  comment: "تعليق",
  upload: "رفع",
  timesheet: "وقت",
};

export function EpisodeTimeline({
  employeeName,
  episodes,
}: {
  employeeName: string;
  episodes: EpisodeRow[];
}) {
  return (
    <Card className="mb-6 border-cyan/25">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">سجل الواجبات — {employeeName}</p>
          <Link
            href="/team-activity"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" /> إغلاق
          </Link>
        </div>

        {episodes.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            لا توجد واجبات مُقاسة بعد لهذا الموظف (تتراكم مع حركة المهام بعد تاريخ بدء القياس).
          </p>
        ) : (
          <ul className="space-y-1.5">
            {episodes.map((e) => {
              const open = e.closedAt == null;
              const answered = e.answeredAt != null;
              const Icon = open ? CircleDot : answered ? CheckCircle2 : Clock;
              const tone =
                e.withinSla === false
                  ? "text-cc-red"
                  : answered
                    ? "text-cc-green"
                    : "text-amber";
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 px-3 py-2 text-xs"
                >
                  <Icon className={cn("size-3.5 shrink-0", tone)} />
                  <Link href={`/tasks/${e.id ? "" : ""}`} className="font-medium">
                    {stageLabel(e.stage)}
                  </Link>
                  <span className="text-[10px] text-muted-foreground">
                    فُتح {fmt(e.openedAt)}
                  </span>
                  {answered ? (
                    <span className="text-[10px] text-muted-foreground">
                      · أُنجز {fmt(e.answeredAt)}
                      {e.answeredKind && ` (${ANSWER_KIND[e.answeredKind] ?? e.answeredKind})`}
                    </span>
                  ) : open ? (
                    <span className="text-[10px] text-amber">· مفتوح</span>
                  ) : null}
                  {e.slaMinutes != null && (
                    <span
                      className={cn(
                        "ms-auto rounded-full border px-2 py-0.5 text-[10px] tabular-nums",
                        e.withinSla === false
                          ? "border-cc-red/40 text-cc-red"
                          : e.withinSla === true
                            ? "border-cc-green/40 text-cc-green"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {e.responseMinutes != null ? `${e.responseMinutes}د` : NA} / SLA {e.slaMinutes}د
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
