import Link from "next/link";
import { Activity, AlertTriangle, Gauge, Target, Info, ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { gradeFor } from "@/lib/data/executive-scores";
import type { TeamPulseOverview, TeamPulseRow, PulseStatus } from "@/lib/data/team-pulse";

const NA = "—";

const STATUS_META: Record<PulseStatus, { label: string; tone: string; dot: string }> = {
  good: { label: "ضمن المسار", tone: "text-cc-green", dot: "bg-cc-green" },
  watch: { label: "يحتاج متابعة", tone: "text-amber", dot: "bg-amber" },
  risk: { label: "متعثّر", tone: "text-cc-red", dot: "bg-cc-red" },
  na: { label: "غير مُقاس", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};

const pct = (v: number | null): string => (v == null ? NA : `${v}%`);
const sar = (v: number | null): string =>
  v == null ? NA : new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(v);

function scoreTone(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 75) return "text-cc-green";
  if (v >= 60) return "text-amber";
  return "text-cc-red";
}

function DeptRow({ row }: { row: TeamPulseRow }) {
  const meta = STATUS_META[row.status];
  const grade = row.deliveryScore != null ? gradeFor(row.deliveryScore) : null;
  const overduePct = row.openTasks > 0 ? Math.round((row.overdueOwned / row.openTasks) * 100) : null;
  return (
    <tr className="border-b border-border/50 hover:bg-soft-1">
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", meta.dot)} />
          <div>
            <Link
              href={`/team-activity?dept=${row.departmentId}`}
              className="font-medium hover:text-cyan hover:underline"
            >
              {row.departmentName}
            </Link>
            <div className="text-[10px] text-muted-foreground">
              {row.headName ? `يقودها ${row.headName}` : "بدون مسؤول"} · {row.measuredCount}/
              {row.headcount} مُقاس
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("text-lg font-bold tabular-nums", scoreTone(row.deliveryScore))}>
            {row.deliveryScore ?? NA}
          </span>
          {grade && (
            <span className="rounded border border-border px-1.5 text-[10px] font-semibold">
              {grade}
            </span>
          )}
        </div>
      </td>
      <td className={cn("px-3 py-3 tabular-nums", scoreTone(row.onTimeRate))}>{pct(row.onTimeRate)}</td>
      <td className="px-3 py-3 tabular-nums text-center">{row.openTasks}</td>
      <td
        className={cn(
          "px-3 py-3 tabular-nums text-center",
          overduePct != null && overduePct >= 40 && "font-semibold text-cc-red",
        )}
      >
        {row.overdueOwned}
        {overduePct != null && (
          <span className="ms-1 text-[10px] text-muted-foreground">({overduePct}%)</span>
        )}
      </td>
      <td className="px-3 py-3">
        {row.commAttainmentPct == null ? (
          <span className="text-muted-foreground">{NA}</span>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "tabular-nums font-semibold",
                row.commAttainmentPct >= 90
                  ? "text-cc-green"
                  : row.commAttainmentPct >= 70
                    ? "text-amber"
                    : "text-cc-red",
              )}
            >
              {row.commAttainmentPct}%
            </span>
            <span className="text-[10px] text-muted-foreground">
              {sar(row.commAchieved)} / {sar(row.commExpected)}
            </span>
          </div>
        )}
      </td>
      <td
        className={cn(
          "px-3 py-3 tabular-nums text-center",
          row.atRiskMembers > 0 && "text-cc-red",
        )}
      >
        {row.atRiskMembers}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-xs", meta.tone)}>{meta.label}</span>
          <ChevronLeft className="size-3.5 text-muted-foreground" />
        </div>
      </td>
    </tr>
  );
}

export function TeamPulseBoard({ data }: { data: TeamPulseOverview }) {
  const t = data.totals;
  const headStats = [
    { icon: Gauge, label: "الأقسام المُقاسة", value: `${t.measuredDepartments}/${t.departments}`, tone: "text-cyan" },
    { icon: Activity, label: "الالتزام بالموعد", value: pct(t.onTimeRate), tone: scoreTone(t.onTimeRate) },
    { icon: AlertTriangle, label: "مهام متأخرة", value: String(t.overdueOwned), tone: "text-cc-red" },
    {
      icon: Target,
      label: "الإنجاز مقابل الهدف",
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
    <div className="space-y-4">
      {/* Honesty banner */}
      <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/5 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-cyan" />
        <p>
          محوران: <span className="font-semibold text-foreground">الأداء التشغيلي</span> (النتيجة = ٦٠٪
          الالتزام بمواعيد المراحل + ٤٠٪ نسبة المهام غير المتأخرة، من سجل مراحل Odoo خلال آخر ٣٠ يومًا)،
          و<span className="font-semibold text-foreground">الإنجاز مقابل الهدف</span> (الدخل المُحقّق ÷
          المستهدف من العقود{data.targetMonth ? ` — شهر ${data.targetMonth}` : ""}). أهداف الدخل تخص
          مديري الحسابات فقط؛ فرق التنفيذ تُقاس بالمعيار التشغيلي. القيم غير المتوفرة تظهر «—».
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
                title="لا توجد بيانات فرق بعد"
                description="تتراكم البيانات تلقائيًا مع حركة المهام والعقود. عُد لاحقًا."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">القسم</th>
                    <th className="px-3 py-2.5 font-medium">النتيجة</th>
                    <th className="px-3 py-2.5 font-medium">الالتزام بالموعد</th>
                    <th className="px-3 py-2.5 font-medium text-center">مهام مفتوحة</th>
                    <th className="px-3 py-2.5 font-medium text-center">متأخرة</th>
                    <th className="px-3 py-2.5 font-medium">الإنجاز مقابل الهدف</th>
                    <th className="px-3 py-2.5 font-medium text-center">أعضاء متعثّرون</th>
                    <th className="px-3 py-2.5 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <DeptRow key={r.departmentId} row={r} />
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
