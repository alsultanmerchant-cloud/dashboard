import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Hourglass, RefreshCw, ChevronLeft } from "lucide-react";
import { MetricInfo } from "@/components/metric-info";
import type { WorkflowIndicators } from "@/lib/data/executive";
import { cn } from "@/lib/utils";

// Two "full indicators" promoted out of the hero row (team feedback 2026-06-28):
// the REVIEW backlog (specialist_review + manager_review) and CLIENT-CHANGES.
// Each shows the open count plus how long work is waiting (oldest + avg dwell),
// and drills to the matching filtered task list — not the generic open list the
// old hero cards used. Rendered alongside the executive indicators.

// review = open tasks in specialist_review OR manager_review (two stage facets on
// the same field → OR, per the tasks bundle RPC). client-changes = one stage.
const REVIEW_HREF = `/tasks?view=list&sf=${encodeURIComponent(
  JSON.stringify([
    { field: "stage", value: "specialist_review" },
    { field: "stage", value: "manager_review" },
  ]),
)}`;
const CHANGES_HREF = `/tasks?view=list&sf=${encodeURIComponent(
  JSON.stringify([{ field: "stage", value: "client_changes" }]),
)}`;

export async function WorkflowIndicatorsSection({ data }: { data: WorkflowIndicators }) {
  const t = await getTranslations("Executive.workflow");
  return (
    <section className="mb-8 grid gap-3 sm:grid-cols-2">
      <IndicatorCard
        icon={<Hourglass className="size-4" />}
        label={t("reviewLabel")}
        desc={t("reviewDesc")}
        count={data.review.count}
        oldestDays={data.review.oldestDays}
        avgDwellDays={data.review.avgDwellDays}
        href={REVIEW_HREF}
        tip={t("metricTooltips.dashboard_reviewIndicator")}
        t={t}
      />
      <IndicatorCard
        icon={<RefreshCw className="size-4" />}
        label={t("changesLabel")}
        desc={t("changesDesc")}
        count={data.clientChanges.count}
        oldestDays={data.clientChanges.oldestDays}
        avgDwellDays={data.clientChanges.avgDwellDays}
        href={CHANGES_HREF}
        tip={t("metricTooltips.dashboard_changesIndicator")}
        t={t}
      />
    </section>
  );
}

function IndicatorCard({
  icon,
  label,
  desc,
  count,
  oldestDays,
  avgDwellDays,
  href,
  tip,
  t,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  count: number;
  oldestDays: number | null;
  avgDwellDays: number | null;
  href: string;
  tip: React.ReactNode;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const tone = count === 0 ? "neutral" : count > 30 ? "danger" : "warning";
  const valueTone =
    tone === "danger" ? "text-cc-red" : tone === "warning" ? "text-amber" : "text-foreground";
  const iconTone =
    tone === "danger"
      ? "text-cc-red bg-red-dim"
      : tone === "warning"
        ? "text-amber bg-amber-dim"
        : "text-muted-foreground bg-soft-2";
  const days = (n: number | null) => (n === null ? "—" : t("daysValue", { n }));

  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-soft bg-card p-5 transition-all hover:shadow-[0_0_30px_rgba(0,212,255,0.06)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex size-8 items-center justify-center rounded-lg", iconTone)}>
            {icon}
          </span>
          <div>
            <div className="text-sm font-semibold">{label}</div>
            <p className="text-[11px] text-muted-foreground">{desc}</p>
          </div>
        </div>
        <MetricInfo text={tip} />
      </div>

      <div className="mt-4 flex items-end gap-4">
        <span className={cn("text-5xl font-bold tabular-nums leading-none", valueTone)}>
          {count}
        </span>
        <dl className="mb-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <dt>{t("oldest")}:</dt>
            <dd className="font-semibold tabular-nums text-foreground">{days(oldestDays)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>{t("avgDwell")}:</dt>
            <dd className="font-semibold tabular-nums text-foreground">{days(avgDwellDays)}</dd>
          </div>
        </dl>
      </div>

      <span className="mt-auto flex items-center gap-1 pt-4 text-[11px] text-cyan opacity-0 transition-opacity group-hover:opacity-100">
        {t("openTasks")}
        <ChevronLeft className="size-3" />
      </span>
    </Link>
  );
}
