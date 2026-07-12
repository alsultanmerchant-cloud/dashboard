import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowUpLeft,
  Layers3,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ClientEditsMetrics } from "@/lib/data/executive";
import { SectionTitle } from "@/components/section-title";
import { WindowLabel } from "./window-label";
import { cn } from "@/lib/utils";

const DRILL_HREF = `/tasks?sf=${encodeURIComponent(JSON.stringify([{ field: "stage", value: "client_changes" }]))}`;

function getServiceTone(slug: string) {
  if (slug.includes("social-media")) {
    return {
      icon: "bg-cc-purple/15 text-cc-purple",
      bar: "bg-cc-purple",
    };
  }
  if (slug.includes("seo")) {
    return {
      icon: "bg-cyan-dim text-cyan",
      bar: "bg-cyan",
    };
  }
  if (slug.includes("media-buying")) {
    return {
      icon: "bg-amber-dim text-amber",
      bar: "bg-amber",
    };
  }
  return {
    icon: "bg-soft-2 text-muted-foreground",
    bar: "bg-muted-foreground/60",
  };
}

export async function TopRevisedTasksSection({ rows: m, windowLabel }: { rows: ClientEditsMetrics; windowLabel?: string }) {
  const t = await getTranslations("Executive.topRevised");

  const weekDelta = m.enteredThisWeek - m.enteredLastWeek;
  const TrendIcon = weekDelta > 0 ? TrendingUp : weekDelta < 0 ? TrendingDown : Minus;
  const trendTone = weekDelta > 0 ? "text-cc-red" : weekDelta < 0 ? "text-cc-green" : "text-muted-foreground";
  const trendSign = weekDelta > 0 ? "+" : "";
  const serviceTotal = m.byService.reduce((sum, service) => sum + service.count, 0);

  return (
    <section className="mb-10">
      <SectionTitle title={t("indicatorTitle")} description={t("indicatorDesc")} actions={windowLabel ? <WindowLabel label={windowLabel} /> : undefined} />

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[var(--surface-elev)]">
        <div className="grid lg:grid-cols-[minmax(260px,0.7fr)_minmax(0,2fr)]">
          <Link
            href={DRILL_HREF}
            className="group relative flex min-h-52 flex-col justify-between overflow-hidden border-b border-border/60 bg-amber/[0.045] p-5 transition-colors hover:bg-amber/[0.075] lg:border-b-0 lg:border-s"
          >
            <div
              aria-hidden="true"
              className="absolute -start-10 -top-14 size-40 rounded-full bg-amber/10 blur-3xl"
            />

            <div className="relative flex items-start justify-between gap-4">
              <span className="flex size-10 items-center justify-center rounded-xl border border-amber/20 bg-amber-dim text-amber">
                <RefreshCw className="size-5" />
              </span>
              <ArrowUpLeft className="size-4 text-muted-foreground transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
            </div>

            <div className="relative mt-6">
              <p className="text-xs font-semibold text-muted-foreground">
                {t("activeNow")}
              </p>
              <div className="mt-1 flex items-end gap-3">
                <span className="text-6xl font-black tabular-nums leading-none tracking-tight text-amber">
                  {m.activeNow}
                </span>
                <span className="pb-1 text-xs text-muted-foreground">
                  {t("affectedTasks")}
                </span>
              </div>
            </div>

            <div className="relative mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-2">
                <p className="text-[10px] font-medium text-muted-foreground">{t("thisWeek")}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{m.enteredThisWeek}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-2">
                <p className="text-[10px] font-medium text-muted-foreground">{t("weeklyChange")}</p>
                <div className={cn("mt-0.5 flex items-center gap-1 text-lg font-bold tabular-nums", trendTone)}>
                  <TrendIcon className="size-4" />
                  <span>{trendSign}{weekDelta}</span>
                </div>
              </div>
            </div>
          </Link>

          <div className="p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{t("byService")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("serviceDistributionHint")}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-soft-1 px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
                <Layers3 className="size-3.5" />
                {serviceTotal}
              </span>
            </div>

          {m.byService.length === 0 ? (
            <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              {t("emptyDescription")}
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {m.byService.map((s) => {
                const tone = getServiceTone(s.slug);
                const pct = serviceTotal > 0 ? Math.round((s.count / serviceTotal) * 100) : 0;
                return (
                  <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone.icon)}>
                        <Layers3 className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" title={s.name}>
                          {s.name}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft-2">
                          <div
                            className={cn("h-full rounded-full", tone.bar)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="text-end">
                      <p className="text-lg font-bold tabular-nums leading-none">{s.count}</p>
                      <p className="mt-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {pct}%
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
