"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Scale, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";
import type { DashboardRange } from "@/lib/dashboard-range";
import type { AccountabilityOverview, ReviewerRigorRow } from "@/lib/data/accountability";
import { AccountabilityRangePicker } from "./accountability-range-picker";

const NA = "—";

function formatMinutes(min: number | null, t: ReturnType<typeof useTranslations>): string {
  if (min == null) return NA;
  const m = Math.round(min);
  if (m < 60) return t("fmt.minutes", { n: m });
  const h = m / 60;
  if (h < 8) return t("fmt.hours", { n: Math.round(h * 10) / 10 });
  return t("fmt.workdays", { n: Math.round((h / 8) * 10) / 10 });
}

export function ReviewerRigorSection({
  reviewers,
  range,
  onSelect,
  showRangePicker = true,
}: {
  reviewers: AccountabilityOverview["reviewers"];
  range: DashboardRange;
  onSelect?: (id: string) => void;
  showRangePicker?: boolean;
}) {
  const t = useTranslations("AccountabilityPage");
  const [open, setOpen] = useState(true);
  const total = reviewers.managerReview.length + reviewers.specialistReview.length;

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-start"
        >
          <Scale className="size-4 text-cyan" />
          <span className="text-sm font-semibold">{t("reviewers.title")}</span>
          <span className="rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {total}
          </span>
          <ChevronDown className={cn("ms-auto size-4 transition-transform", open && "rotate-180")} />
        </button>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("reviewers.hint")}</p>

        {open && (
          <div className="mt-3 space-y-5">
            {showRangePicker && <AccountabilityRangePicker range={range} />}
            <ReviewerStageBlock
              title={t("reviewers.managerReviewTitle")}
              subtitle={t("reviewers.managerReviewSubtitle")}
              rows={reviewers.managerReview}
              onSelect={onSelect}
              t={t}
            />
            <ReviewerStageBlock
              title={t("reviewers.specialistReviewTitle")}
              subtitle={t("reviewers.specialistReviewSubtitle")}
              rows={reviewers.specialistReview}
              onSelect={onSelect}
              t={t}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewerStageBlock({
  title,
  subtitle,
  rows,
  onSelect,
  t,
}: {
  title: string;
  subtitle: string;
  rows: ReviewerRigorRow[];
  onSelect?: (id: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-foreground/90">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
      <p className="mt-2 rounded-[var(--radius-sm)] border border-cyan/20 bg-cyan/5 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
        {t("reviewers.attributedNote")}
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-md)] bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {t("reviewers.empty")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="p-2 text-start font-medium">{t("reviewers.col.reviewer")}</th>
                <th className="p-2 text-center font-medium">{t("reviewers.col.reviews")}</th>
                <th className="p-2 text-center font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t("reviewers.col.medianTime")}
                    <MetricInfo text={t("metricTooltips.accountability_reviewerMedianTime")} label={t("reviewers.col.medianTime")} />
                  </span>
                </th>
                <th className="p-2 text-center font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t("reviewers.col.fastShare")}
                    <MetricInfo text={t("metricTooltips.accountability_reviewerFastShare")} label={t("reviewers.col.fastShare")} />
                  </span>
                </th>
                <th className="p-2 text-center font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t("reviewers.col.rework")}
                    <MetricInfo text={t("metricTooltips.accountability_reviewerRework")} label={t("reviewers.col.rework")} />
                  </span>
                </th>
                <th className="p-2 text-center font-medium">{t("reviewers.col.pending")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const low = row.confidence === "low";
                return (
                  <tr
                    key={row.employeeId}
                    onClick={onSelect ? () => onSelect(row.employeeId) : undefined}
                    className={cn(
                      "border-b border-border/50 transition-colors",
                      onSelect && "cursor-pointer hover:bg-soft-1",
                    )}
                    title={onSelect ? t("evidenceRule") : undefined}
                  >
                    <td className="p-2">
                      <span className="font-medium">{row.fullName}</span>
                      {low && (
                        <span className="ms-1.5 rounded border border-border bg-soft-1 px-1 py-0.5 text-[10px] text-muted-foreground">
                          {t("lowSample", { n: row.sampleSize })}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center tabular-nums">{row.reviewsCompleted}</td>
                    <td className="p-2 text-center tabular-nums text-muted-foreground">
                      {formatMinutes(row.medianReviewBusinessMinutes, t)}
                    </td>
                    <td className="p-2 text-center">
                      <span className={cn("inline-flex items-center gap-1 tabular-nums", row.fastReviewCount > 0 ? "font-semibold text-amber" : "text-muted-foreground")}>
                        {row.fastReviewCount > 0 && <Timer className="size-3" />}
                        <span dir="ltr">{row.fastReviewCount}</span>
                      </span>
                      <div className="text-[10px] text-muted-foreground">من {row.reviewsCompleted} تاسك</div>
                    </td>
                    <td className="p-2 text-center">
                      <span className={cn("tabular-nums", row.clientChangesAfterReviewCount > 0 ? "font-semibold text-amber" : "text-muted-foreground")} dir="ltr">
                        {row.clientChangesAfterReviewCount}
                      </span>
                      {row.clientChangesAfterReviewRate !== null && (
                        <div className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">
                          {row.clientChangesAfterReviewRate}% من المراجَع
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <span className="tabular-nums">{row.pendingReviews}</span>
                      {row.oldestPendingBusinessMinutes !== null && row.pendingReviews > 0 && (
                        <div className="text-[10px] tabular-nums text-muted-foreground">
                          {t("reviewers.oldestPending", { v: formatMinutes(row.oldestPendingBusinessMinutes, t) })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
