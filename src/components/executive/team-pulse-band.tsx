import Link from "next/link";
import { Activity, ArrowLeft, Zap, Gauge, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TeamPulseOverview, PulseStatus } from "@/lib/data/team-pulse";

const STATUS_DOT: Record<PulseStatus, string> = {
  good: "bg-cc-green",
  watch: "bg-amber",
  risk: "bg-cc-red",
  na: "bg-muted-foreground",
};

// Compact dashboard band: org-level activity + the teams that have stalled,
// linking into the full /team-activity board. Movement/activity only — SLA
// quality lives on the المساءلة page.
export function TeamPulseBand({ data }: { data: TeamPulseOverview }) {
  const t = data.totals;
  const worst = data.rows.filter((r) => r.status === "risk" || r.status === "watch").slice(0, 3);

  const stats = [
    { icon: Zap, label: "يعمل الآن", value: String(t.activeCount), tone: "text-cc-green", hint: "موظفون قاموا بإجراء اليوم" },
    { icon: Activity, label: "إجراء اليوم", value: String(t.actionsToday), tone: "text-cyan", hint: "إجراءات رواسم اليوم" },
    { icon: Gauge, label: "محمّل زائد", value: String(t.overloadedCount), tone: "text-cc-red", hint: "موظفون يتجاوز عدد مشاريعهم النشطة الحد المسموح" },
    // مُعلقة متأخرة: tasks on desks that have breached their STAGE SLA (not the
    // ordinary deadline-overdue). Only the 5 SLA-configured stages qualify.
    { icon: AlertTriangle, label: "معلّقة متأخرة", value: String(t.pendingLate), tone: "text-cc-red", hint: "مهام على المكاتب تجاوزت زمن SLA لمرحلتها الحالية" },
  ];

  return (
    <Card className="mb-8">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="size-5 text-cyan" />
            <div>
              <p className="text-sm font-semibold">نبض الفريق</p>
              <p className="text-[11px] text-muted-foreground">حركة العمل ونشاط الفرق — من يتحرّك ومن توقّف</p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {stats.map((s) => (
              <div key={s.label} className="text-center" title={s.hint}>
                <p className={cn("text-xl font-bold tabular-nums", s.tone)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
            <Link
              href="/team-activity"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-soft-1"
            >
              التفاصيل <ArrowLeft className="size-3.5" />
            </Link>
          </div>
        </div>

        {worst.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              فرق متوقّفة
            </span>
            {worst.map((r) => (
              <Link
                key={r.departmentId}
                href={`/team-activity?dept=${r.departmentId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-soft-1 px-2.5 py-1 text-[11px] hover:bg-soft-2"
              >
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[r.status])} />
                <span className="font-medium">{r.departmentName}</span>
                {r.stuckTasks > 0 && (
                  <span className="text-cc-red tabular-nums">{r.stuckTasks} متوقّفة</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
