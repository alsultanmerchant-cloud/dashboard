import Link from "next/link";
import { Activity, ArrowLeft, AlertTriangle, Target, Gauge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TeamPulseOverview, PulseStatus } from "@/lib/data/team-pulse";

const NA = "—";

const STATUS_TONE: Record<PulseStatus, string> = {
  good: "text-cc-green",
  watch: "text-amber",
  risk: "text-cc-red",
  na: "text-muted-foreground",
};
const STATUS_DOT: Record<PulseStatus, string> = {
  good: "bg-cc-green",
  watch: "bg-amber",
  risk: "bg-cc-red",
  na: "bg-muted-foreground",
};

function scoreTone(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 75) return "text-cc-green";
  if (v >= 60) return "text-amber";
  return "text-cc-red";
}
const pct = (v: number | null): string => (v == null ? NA : `${v}%`);

// Compact dashboard band: org-level health + the 3 worst teams, linking into
// the full /team-activity board. Fed by the team-pulse fusion layer (Odoo
// delivery + contract targets), replacing the dead activity-instrumentation
// band.
export function TeamPulseBand({ data }: { data: TeamPulseOverview }) {
  const t = data.totals;
  const worst = data.rows
    .filter((r) => r.status === "risk" || r.status === "watch")
    .slice(0, 3);

  const stats = [
    { icon: Gauge, label: "أقسام مُقاسة", value: `${t.measuredDepartments}/${t.departments}`, tone: "text-cyan" },
    { icon: Activity, label: "الالتزام بالموعد", value: pct(t.onTimeRate), tone: scoreTone(t.onTimeRate) },
    { icon: AlertTriangle, label: "متأخرة", value: String(t.overdueOwned), tone: "text-cc-red" },
    {
      icon: Target,
      label: "مقابل الهدف",
      value: pct(t.commAttainmentPct),
      tone:
        t.commAttainmentPct == null
          ? "text-muted-foreground"
          : t.commAttainmentPct >= 90
            ? "text-cc-green"
            : t.commAttainmentPct >= 70
              ? "text-amber"
              : "text-cc-red",
    },
  ];

  return (
    <Card className="mb-8">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="size-5 text-cyan" />
            <div>
              <p className="text-sm font-semibold">نبض الفريق</p>
              <p className="text-[11px] text-muted-foreground">
                أداء الأقسام مقابل المعيار التشغيلي وأهداف العقود
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
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
              يحتاج انتباهك
            </span>
            {worst.map((r) => (
              <Link
                key={r.departmentId}
                href={`/team-activity?dept=${r.departmentId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-soft-1 px-2.5 py-1 text-[11px] hover:bg-soft-2"
              >
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[r.status])} />
                <span className="font-medium">{r.departmentName}</span>
                <span className={cn("tabular-nums", scoreTone(r.deliveryScore))}>
                  {r.deliveryScore ?? NA}
                </span>
                {r.overdueOwned > 0 && (
                  <span className="text-cc-red tabular-nums">· {r.overdueOwned} متأخرة</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
