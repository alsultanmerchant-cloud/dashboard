"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { History, Loader2, TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { EmployeeTrend, TrendPoint } from "@/lib/data/performance-trend";

type RangeKey = "weekly" | "monthly" | "yearly";
type MetricKey = "onTime" | "completed" | "dwell";

const RANGES: { key: RangeKey; label: string; grain: "week" | "month"; take: number }[] = [
  { key: "weekly", label: "آخر ١٢ أسبوع", grain: "week", take: 12 },
  { key: "monthly", label: "آخر ٦ أشهر", grain: "month", take: 6 },
  { key: "yearly", label: "كل الفترة", grain: "month", take: 99 },
];

interface MetricMeta {
  key: MetricKey;
  label: string; // plain name
  explain: string; // what it means, in plain words
  unit: string;
  higherIsBetter: boolean;
}
const METRICS: MetricMeta[] = [
  {
    key: "onTime",
    label: "التسليم في الموعد",
    explain: "من كل ١٠٠ مهمة، كم واحدة سلّمها في وقتها. الأعلى أفضل.",
    unit: "٪",
    higherIsBetter: true,
  },
  {
    key: "completed",
    label: "عدد المهام المنجزة",
    explain: "كم مهمة أنهى خلال الفترة. الأعلى أفضل.",
    unit: " مهمة",
    higherIsBetter: true,
  },
  {
    key: "dwell",
    label: "متوسط وقت الإنجاز",
    explain: "كم ساعة عمل يستغرق لإنهاء المهمة الواحدة. الأقل أفضل.",
    unit: " ساعة",
    higherIsBetter: false,
  },
];

function metricValue(p: TrendPoint, m: MetricKey): number | null {
  if (m === "onTime") return p.onTimePct;
  if (m === "completed") return p.completed;
  return p.avgDwell != null ? Math.round((p.avgDwell / 60) * 10) / 10 : null; // → hours
}

function fmtLabel(iso: string, grain: "week" | "month"): string {
  const d = new Date(iso + "T00:00:00Z");
  if (grain === "month")
    return d.toLocaleDateString("ar-EG", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

export function CompareTrendModal({
  employeeId,
  fullName,
  className,
}: {
  employeeId: string;
  fullName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EmployeeTrend | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("monthly");
  const [metric, setMetric] = useState<MetricKey>("onTime");

  useEffect(() => {
    if (!open || data || loading) return;
    setLoading(true);
    setError(null);
    fetch(`/api/performance-trend?emp=${employeeId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: EmployeeTrend) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, data, loading, employeeId]);

  const cfg = RANGES.find((r) => r.key === range)!;
  const mcfg = METRICS.find((m) => m.key === metric)!;

  const empSeries = (cfg.grain === "week" ? data?.weekly : data?.monthly) ?? [];
  const benchSeries = (cfg.grain === "week" ? data?.benchWeekly : data?.benchMonthly) ?? [];
  const emp = empSeries.slice(-cfg.take);
  const benchByStart = new Map(benchSeries.map((b) => [b.periodStart, b]));

  const teamLabel = "بقية زملائه في القسم";
  const chartData = emp.map((p) => {
    const b = benchByStart.get(p.periodStart);
    return {
      label: fmtLabel(p.periodStart, cfg.grain),
      [fullName]: metricValue(p, metric),
      [teamLabel]: b ? metricValue(b, metric) : null,
    } as Record<string, string | number | null>;
  });

  // First vs last measurable point for the employee in this view.
  const measurable = emp.map((p) => metricValue(p, metric)).filter((v): v is number => v != null);
  const first = measurable[0] ?? null;
  const last = measurable[measurable.length - 1] ?? null;
  const delta = first != null && last != null ? last - first : null;
  // Direction of "good" depends on the metric (dwell: lower is better).
  const better = delta == null ? 0 : (mcfg.higherIsBetter ? delta : -delta);

  // Latest team value for the "vs his peers" comparison.
  const benchVals = emp
    .map((p) => {
      const b = benchByStart.get(p.periodStart);
      return b ? metricValue(b, metric) : null;
    })
    .filter((v): v is number => v != null);
  const benchLast = benchVals[benchVals.length - 1] ?? null;
  const aheadOfTeam =
    last != null && benchLast != null
      ? mcfg.higherIsBetter
        ? last - benchLast
        : benchLast - last
      : null;

  const verb = better > 0 ? "تحسّن" : better < 0 ? "تراجع" : "ثبت";
  const fmt = (v: number | null) => (v == null ? "—" : `${v}${mcfg.unit}`);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            title="شاهد كيف كان أداؤه سابقًا"
            className={cn(
              "inline-flex items-center gap-1 text-[11px] text-cyan hover:underline",
              className,
            )}
          />
        }
      >
        <History className="size-3.5" />
        قارن بالسابق
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-right">
            كيف يتطوّر أداء {fullName}؟
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground">
          اختر المؤشّر الذي يهمّك ثم الفترة الزمنية. الخط الملوّن = {fullName}، والخط المتقطّع =
          متوسّط بقية زملائه في نفس القسم للمقارنة.
        </p>

        {/* Step 1: pick the indicator (plain language + what it means) */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            ١ — المؤشّر
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
                  metric === m.key
                    ? "border-cyan bg-cyan/10 font-medium text-cyan"
                    : "border-border text-muted-foreground hover:bg-soft-1",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0 text-cyan" />
            {mcfg.explain}
          </p>
        </div>

        {/* Step 2: pick the period */}
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            ٢ — الفترة الزمنية
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  range === r.key
                    ? "border-cyan bg-cyan/10 text-cyan"
                    : "border-border text-muted-foreground hover:bg-soft-1",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {error && (
          <div className="flex h-64 items-center justify-center text-sm text-cc-red">
            تعذّر تحميل البيانات: {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Plain-language verdict */}
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3",
                better > 0
                  ? "border-cc-green/30 bg-cc-green/5"
                  : better < 0
                    ? "border-cc-red/30 bg-cc-red/5"
                    : "border-border bg-soft-1",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 shrink-0",
                  better > 0 ? "text-cc-green" : better < 0 ? "text-cc-red" : "text-muted-foreground",
                )}
              >
                {better > 0 ? (
                  <TrendingUp className="size-5" />
                ) : better < 0 ? (
                  <TrendingDown className="size-5" />
                ) : (
                  <Minus className="size-5" />
                )}
              </div>
              <div className="text-sm leading-relaxed">
                {measurable.length === 0 ? (
                  <span className="text-muted-foreground">
                    لا توجد بيانات كافية لهذا المؤشّر في هذه الفترة.
                  </span>
                ) : (
                  <>
                    <span className="font-semibold">{mcfg.label}</span> {verb} من{" "}
                    <span className="font-semibold">{fmt(first)}</span> إلى{" "}
                    <span className="font-semibold">{fmt(last)}</span>
                    {delta != null && delta !== 0 && (
                      <>
                        {" "}
                        (
                        <span
                          className={cn(
                            "font-bold",
                            better > 0 ? "text-cc-green" : "text-cc-red",
                          )}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}
                          {mcfg.unit}
                        </span>
                        )
                      </>
                    )}
                    .
                    {aheadOfTeam != null && (
                      <>
                        {" "}
                        وهو حاليًا{" "}
                        <span
                          className={cn(
                            "font-semibold",
                            aheadOfTeam >= 0 ? "text-cc-green" : "text-cc-red",
                          )}
                        >
                          {aheadOfTeam > 0 ? "أفضل من" : aheadOfTeam < 0 ? "أقل من" : "مماثل ل"}
                        </span>{" "}
                        متوسّط زملائه ({fmt(benchLast)}).
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {chartData.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                لا توجد بيانات كافية في هذه الفترة
              </div>
            ) : (
              <>
                <div className="h-60 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: -8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="var(--muted-foreground)"
                        domain={metric === "onTime" ? [0, 100] : [0, "auto"]}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "var(--foreground)" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey={fullName}
                        stroke="#00e5ff"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        connectNulls
                        isAnimationActive
                        animationDuration={600}
                      />
                      <Line
                        type="monotone"
                        dataKey={teamLabel}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        dot={false}
                        connectNulls
                        isAnimationActive
                        animationDuration={600}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  {mcfg.higherIsBetter
                    ? "↑ كلّما ارتفع الخط كان الأداء أفضل"
                    : "↓ كلّما انخفض الخط كان الأداء أفضل"}
                </p>
              </>
            )}

            <p className="text-[10px] text-muted-foreground">
              المصدر: سجلّ مراحل المهام في النظام (Odoo). «التسليم في الموعد» يُحتسب فقط على المهام
              التي يمكن الحكم عليها. «كل الفترة» تبدأ من أكتوبر ٢٠٢٥ (بداية البيانات).
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
