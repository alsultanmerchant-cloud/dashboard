import Link from "next/link";
import { Activity, AlertTriangle, MoonStar, HelpCircle, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { gradeFor } from "@/lib/data/executive-scores";
import type { TeamActivityOverview, ActivityRow, ActivityStatus } from "@/lib/data/activity-scores";

const NA = "—";

const STATUS_META: Record<ActivityStatus, { label: string; tone: string; dot: string }> = {
  active: { label: "نشط", tone: "text-cc-green", dot: "bg-cc-green" },
  at_risk: { label: "معرّض للخطر", tone: "text-amber", dot: "bg-amber" },
  idle: { label: "خامل (لديه واجبات)", tone: "text-cc-red", dot: "bg-cc-red" },
  not_instrumented: { label: "غير مُقاس", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};

function pct(v: number | null): string {
  return v == null ? NA : `${v}%`;
}

function MiniBar({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-4 text-[9px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-soft-2">
        {v != null && (
          <div
            className={cn("h-full", v >= 70 ? "bg-cc-green/60" : v >= 40 ? "bg-amber/60" : "bg-cc-red/60")}
            style={{ width: `${Math.max(2, v)}%` }}
          />
        )}
      </div>
      <span className="w-8 text-[9px] tabular-nums text-muted-foreground">{v == null ? NA : v}</span>
    </div>
  );
}

function Row({ row }: { row: ActivityRow }) {
  const meta = STATUS_META[row.status];
  const grade = row.activityPct != null ? gradeFor(row.activityPct) : null;
  return (
    <tr className="border-b border-border/50 hover:bg-soft-1">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", meta.dot)} />
          <div>
            <Link href={`/team-activity?emp=${row.employeeId}`} className="font-medium hover:text-cyan hover:underline">
              {row.fullName}
            </Link>
            {row.jobTitle && <div className="text-[10px] text-muted-foreground">{row.jobTitle}</div>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("text-lg font-bold tabular-nums", meta.tone)}>{pct(row.activityPct)}</span>
          {grade && <span className="rounded border border-border px-1.5 text-[10px] font-semibold">{grade}</span>}
          {row.confidence === "low" && (
            <span className="text-[9px] text-amber" title="ثقة منخفضة (لا يوجد SLA)">~</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 w-44">
        <div className="space-y-1">
          <MiniBar label="استجابة" v={row.responsiveness} />
          <MiniBar label="إنجاز" v={row.throughput} />
          <MiniBar label="حداثة" v={row.freshness} />
        </div>
      </td>
      <td className="px-3 py-2.5 tabular-nums text-center">{row.ownedEpisodes}</td>
      <td className="px-3 py-2.5 tabular-nums text-center text-cc-green">{row.answeredEpisodes}</td>
      <td className={cn("px-3 py-2.5 tabular-nums text-center", row.staleOpen > 0 && "text-cc-red font-semibold")}>{row.staleOpen}</td>
      <td className={cn("px-3 py-2.5 text-xs", meta.tone)}>{meta.label}</td>
    </tr>
  );
}

export function TeamActivityBoard({ data }: { data: TeamActivityOverview }) {
  const headStats = [
    { icon: Activity, label: "وسيط النشاط", value: pct(data.median), tone: "text-cyan" },
    { icon: Activity, label: "نشط", value: String(data.counts.active), tone: "text-cc-green" },
    { icon: AlertTriangle, label: "معرّض للخطر", value: String(data.counts.atRisk), tone: "text-amber" },
    { icon: MoonStar, label: "خامل", value: String(data.counts.idle), tone: "text-cc-red" },
    { icon: HelpCircle, label: "بدون واجبات", value: String(data.noDutyCount), tone: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-4">
      {/* Honesty banner */}
      <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/5 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-cyan" />
        <p>
          القياس يبدأ من{" "}
          <span className="font-semibold text-foreground">{data.cutoverDate ?? "—"}</span> (نافذة{" "}
          {data.windowWorkingDays} أيام عمل). المهام السابقة لهذا التاريخ تظهر «غير مُقاس» ولا تُحتسب.
          نسبة النشاط = استجابة ٥٥٪ + إنجاز ٢٥٪ + حداثة ٢٠٪، وتُسقَط أي مكوّن غير متوفر.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {headStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <s.icon className={cn("size-4", s.tone)} />
              <p className={cn("mt-2 text-2xl font-bold tabular-nums", s.tone)}>{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {data.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                variant="compact"
                title="لا توجد بيانات نشاط بعد"
                description="تتراكم البيانات تلقائيًا مع حركة المهام. عُد لاحقًا."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">الموظف</th>
                    <th className="px-3 py-2.5 font-medium">نسبة النشاط</th>
                    <th className="px-3 py-2.5 font-medium">المكوّنات</th>
                    <th className="px-3 py-2.5 font-medium text-center">واجبات</th>
                    <th className="px-3 py-2.5 font-medium text-center">مُنجزة</th>
                    <th className="px-3 py-2.5 font-medium text-center">متعثّرة</th>
                    <th className="px-3 py-2.5 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <Row key={r.employeeId} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
