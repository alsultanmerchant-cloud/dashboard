import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountabilityPeriodTrend as PeriodTrendValue } from "@/lib/data/accountability";

export function AccountabilityPeriodTrend({
  trend,
  prominent = false,
  showRates = false,
}: {
  trend: PeriodTrendValue;
  prominent?: boolean;
  showRates?: boolean;
}) {
  const Icon =
    trend.direction === "increase"
      ? TrendingUp
      : trend.direction === "decrease"
        ? TrendingDown
        : Minus;
  const tone =
    trend.direction === "increase"
      ? "text-cc-green"
      : trend.direction === "decrease"
        ? "text-cc-red"
        : "text-muted-foreground";
  const value =
    trend.difference === null
      ? "—"
      : trend.difference > 0
        ? `+${trend.difference}`
        : String(trend.difference);
  const title =
    trend.difference === null
      ? "لا توجد عينة قابلة للمقارنة في الفترتين"
      : `الفترة الحالية ${trend.currentRate}% (${trend.currentSampleSize} حدث) · السابقة ${trend.previousRate}% (${trend.previousSampleSize} حدث)`;

  return (
    <span className="inline-flex flex-col items-center" title={title} aria-label={title}>
      <span
        className={cn(
          "inline-flex items-center justify-center gap-1 font-semibold tabular-nums",
          prominent ? "text-base" : "text-[11px]",
          tone,
        )}
        dir="ltr"
      >
        <Icon className={prominent ? "size-4" : "size-3.5"} />
        {value}{trend.difference === null ? "" : " نقطة"}
      </span>
      {showRates && trend.difference !== null && (
        <span className="mt-0.5 text-[9px] tabular-nums text-muted-foreground" dir="ltr">
          {trend.previousRate}% → {trend.currentRate}%
        </span>
      )}
    </span>
  );
}
