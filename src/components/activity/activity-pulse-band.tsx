import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TeamActivityOverview } from "@/lib/data/activity-scores";

const NA = "—";

export function ActivityPulseBand({ data }: { data: TeamActivityOverview }) {
  const cells = [
    { label: "نشط", value: data.counts.active, tone: "text-cc-green" },
    { label: "معرّض", value: data.counts.atRisk, tone: "text-amber" },
    { label: "خامل", value: data.counts.idle, tone: "text-cc-red" },
  ];
  return (
    <Card className="mb-8">
      <CardContent className="flex items-center justify-between gap-4 p-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Activity className="size-5 text-cyan" />
          <div>
            <p className="text-sm font-semibold">نبض الفريق</p>
            <p className="text-[11px] text-muted-foreground">وسيط نشاط الموظفين مقابل واجباتهم</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-cyan">
              {data.median == null ? NA : `${data.median}%`}
            </p>
            <p className="text-[10px] text-muted-foreground">الوسيط</p>
          </div>
          {cells.map((c) => (
            <div key={c.label} className="text-center">
              <p className={cn("text-xl font-bold tabular-nums", c.tone)}>{c.value}</p>
              <p className="text-[10px] text-muted-foreground">{c.label}</p>
            </div>
          ))}
          <Link
            href="/team-activity"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-soft-1"
          >
            التفاصيل <ArrowLeft className="size-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
