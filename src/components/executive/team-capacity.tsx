import { getTranslations } from "next-intl/server";
import { Trophy, TrendingDown } from "lucide-react";
import type {
  SpecialistLoadRow,
  PerformerRow,
} from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

function LoadBar({ row, max }: { row: SpecialistLoadRow; max: number }) {
  const pct = max > 0 ? Math.max(2, (row.openCount / max) * 100) : 0;
  const heavy = row.openCount >= max * 0.75;
  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="truncate text-xs font-medium">{row.fullName}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {row.allocatedHours > 0 ? `${row.allocatedHours}h` : ""}
        </span>
      </div>
      <div className="relative h-5 rounded-md bg-soft-2 overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 right-0 transition-all",
            heavy ? "bg-cc-red/55" : "bg-cyan/45",
          )}
          style={{ width: `${pct}%` }}
        />
        <div className="relative flex h-full items-center justify-end px-2 text-[11px] font-bold tabular-nums">
          {row.openCount}
        </div>
      </div>
    </div>
  );
}

function PerformerPill({ row, mode }: { row: PerformerRow; mode: "top" | "bottom" }) {
  const tone = mode === "top" ? "text-cc-green" : "text-cc-red";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-soft-1">
      <span className="truncate text-xs font-medium">{row.fullName}</span>
      <div className="text-left">
        <div className={cn("text-sm font-bold tabular-nums", tone)}>
          {row.onTimePct}%
        </div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
          n={row.delivered30d}
        </div>
      </div>
    </div>
  );
}

export async function TeamCapacitySection({
  specialists,
  performers,
}: {
  specialists: SpecialistLoadRow[];
  performers: { top: PerformerRow[]; bottom: PerformerRow[] };
}) {
  const t = await getTranslations("Executive.team");
  const maxLoad = Math.max(...specialists.map((s) => s.openCount), 1);

  return (
    <section className="mb-10">
      <SectionTitle title={t("title")} description={t("description")} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground px-3">
              {t("loadTitle")}
            </div>
            {specialists.length === 0 ? (
              <EmptyState
                variant="compact"
                title={t("loadEmpty")}
                description=""
              />
            ) : (
              <div className="space-y-0.5">
                {specialists.map((s) => (
                  <LoadBar key={s.employeeId} row={s} max={maxLoad} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-rows-2 gap-3">
          <Card className="border-cc-green/15">
            <CardContent className="p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cc-green">
                <Trophy className="size-3.5" />
                {t("topTitle")}
              </div>
              {performers.top.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t("emptyLeaderboard")}</p>
              ) : (
                <div className="space-y-1">
                  {performers.top.map((p) => (
                    <PerformerPill key={p.employeeId} row={p} mode="top" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-cc-red/15">
            <CardContent className="p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cc-red">
                <TrendingDown className="size-3.5" />
                {t("bottomTitle")}
              </div>
              {performers.bottom.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t("emptyLeaderboard")}</p>
              ) : (
                <div className="space-y-1">
                  {performers.bottom.map((p) => (
                    <PerformerPill key={p.employeeId} row={p} mode="bottom" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
