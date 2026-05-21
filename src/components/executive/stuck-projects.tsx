import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, ShieldAlert } from "lucide-react";
import type { StuckProjectRow } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

function slipBucket(pct: number): { tone: string; label: string } {
  if (pct >= 50) return { tone: "text-cc-red", label: "critical" };
  if (pct >= 25) return { tone: "text-amber", label: "severe" };
  if (pct >= 10) return { tone: "text-amber/80", label: "moderate" };
  return { tone: "text-muted-foreground", label: "minor" };
}

export async function StuckProjectsSection({ rows }: { rows: StuckProjectRow[] }) {
  const t = await getTranslations("Executive.stuckProjects");
  return (
    <section className="mb-10">
      <SectionTitle
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/projects" className="text-xs text-cyan hover:underline">
            {t("viewAll")}
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<ShieldAlert className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
          {rows.map((p, idx) => {
            const slip = slipBucket(p.worstSlipPercent);
            const isWorst = idx === 0;
            return (
              <Link
                key={p.projectId}
                href={`/projects/${p.projectId}`}
                className={cn(
                  "group relative rounded-2xl border bg-card p-4 transition-all hover:bg-soft-1",
                  isWorst ? "border-cc-red/35 shadow-[0_0_24px_rgba(239,68,68,0.08)]" : "border-cyan/15",
                )}
              >
                {isWorst && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-cc-red/30 animate-pulse"
                  />
                )}
                <div className="relative">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      {p.projectCode ?? "—"}
                    </span>
                    <ArrowRight className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold">{p.projectName}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {p.clientName ?? "—"}
                  </p>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <div>
                      <div className="text-2xl font-bold tabular-nums leading-none text-cc-red">
                        {p.overdueTasks}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                        {t("overdue")} / {p.openTasks}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className={cn("text-sm font-bold tabular-nums leading-none", slip.tone)}>
                        +{p.worstSlipPercent}%
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                        {t("worstSlip")}
                      </div>
                    </div>
                  </div>
                  {p.daysSinceActivity !== null && p.daysSinceActivity > 3 && (
                    <p className="mt-2 text-[10px] text-amber">
                      ⏳ {t("idleDays", { days: p.daysSinceActivity })}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
