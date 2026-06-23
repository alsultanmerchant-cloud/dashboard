import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import type { ServiceHealthRow } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { SectionTitle } from "@/components/section-title";
import { Sparkline } from "./sparkline";
import { cn } from "@/lib/utils";

function pctTone(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 85) return "text-cc-green";
  if (pct >= 70) return "text-amber";
  return "text-cc-red";
}

const SERVICE_ICON_TONE: Record<string, string> = {
  "social-media": "bg-cc-purple/15 text-cc-purple",
  "seo": "bg-cyan-dim text-cyan",
  "media-buying": "bg-amber-dim text-amber",
  "web": "bg-green-dim text-cc-green",
};

export async function ServiceHealthSection({ rows }: { rows: ServiceHealthRow[] }) {
  const t = await getTranslations("Executive.services");
  if (rows.length === 0) {
    return (
      <section className="mb-10">
        <SectionTitle title={t("title")} description={t("description")} />
        <EmptyState variant="compact" title={t("empty")} description="" />
      </section>
    );
  }

  return (
    <section className="mb-10">
      <SectionTitle title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="grid gap-0 divide-y divide-border/40 p-0">
          {rows.map((s) => {
            const tone = SERVICE_ICON_TONE[s.slug] ?? "bg-soft-2 text-muted-foreground";
            const pct = s.onTimePct30d;
            return (
              <Link
                key={s.serviceId}
                href={`/tasks?service=${s.serviceId}`}
                className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-soft-1 md:grid-cols-[1.4fr_1fr_auto_auto_auto]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", tone)}>
                    <Activity className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{s.name}</p>
                      {s.includesRenewals && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium bg-soft-2 text-muted-foreground">
                          + تجديد
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {s.openCount} {t("openTasks")} · {s.delivered30d} {t("delivered")}
                    </p>
                  </div>
                </div>

                <div className="hidden items-center gap-2 md:flex">
                  <div className={cn("w-full", pctTone(pct))}>
                    <Sparkline
                      data={s.trend}
                      width={160}
                      height={28}
                      stroke="currentColor"
                      fill="currentColor"
                      reference={85}
                    />
                  </div>
                </div>

                <div className="text-left tabular-nums">
                  <div className={cn("text-lg font-bold leading-none", pctTone(pct))}>
                    {pct === null ? "—" : `${pct}%`}
                  </div>
                  <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                    {t("onTime")}
                  </div>
                </div>

                <div className="hidden items-center gap-1 md:flex">
                  <AlertTriangle className={cn("size-3.5", s.overdueCount > 0 ? "text-cc-red" : "text-muted-foreground opacity-40")} />
                  <span className={cn("text-sm font-semibold tabular-nums", s.overdueCount > 0 ? "text-cc-red" : "text-muted-foreground")}>
                    {s.overdueCount}
                  </span>
                </div>

                <div className="hidden items-center gap-1 md:flex">
                  <RefreshCw className={cn("size-3.5", s.avgRevisions >= 1 ? "text-amber" : "text-muted-foreground opacity-40")} />
                  <span className="text-sm font-semibold tabular-nums">
                    {s.avgRevisions.toFixed(1)}
                  </span>
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}
