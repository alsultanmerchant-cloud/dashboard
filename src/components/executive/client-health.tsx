import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ClientHealthRow } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

function pctTone(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 85) return "text-cc-green";
  if (pct >= 70) return "text-amber";
  return "text-cc-red";
}

function whyWorst(row: ClientHealthRow): string {
  const parts: string[] = [];
  if (row.overdueTaskCount > 0) parts.push(`${row.overdueTaskCount} متأخّرة`);
  if (row.onTimePct30d !== null && row.onTimePct30d < 50) parts.push(`${row.onTimePct30d}% التزام`);
  if (row.totalRevisionComments > 30) parts.push(`${row.totalRevisionComments} مراجعة`);
  return parts.join(" · ");
}

function HealthRow({
  row,
  mode,
  isLead,
}: {
  row: ClientHealthRow;
  mode: "worst" | "best";
  isLead?: boolean;
}) {
  const tone = mode === "worst" ? "border-cc-red/20" : "border-cc-green/20";
  return (
    <Link
      href={`/clients/${row.clientId}`}
      className={cn(
        "relative flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-soft-1",
        tone,
        isLead && mode === "worst" && "border-cc-red/45 shadow-[0_0_24px_rgba(239,68,68,0.08)]",
      )}
    >
      {isLead && mode === "worst" && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-cc-red/30 animate-pulse"
        />
      )}
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{row.clientName}</p>
        {isLead && mode === "worst" ? (
          <p className="mt-0.5 text-[11px] text-cc-red truncate">{whyWorst(row)}</p>
        ) : (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {row.activeProjectCount} مشاريع · {row.openTaskCount} مهام
          </p>
        )}
      </div>
      <div className="flex items-center gap-4 text-left">
        <div className="w-12">
          <div className={cn("text-sm font-bold tabular-nums", pctTone(row.onTimePct30d))}>
            {row.onTimePct30d === null ? "—" : `${Math.round(row.onTimePct30d)}%`}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
            on-time
          </div>
        </div>
        <div className="w-10">
          <div className={cn(
            "text-sm font-bold tabular-nums",
            row.overdueTaskCount > 0 ? "text-cc-red" : "text-muted-foreground",
          )}>
            {row.overdueTaskCount}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
            late
          </div>
        </div>
      </div>
    </Link>
  );
}

export async function ClientHealthSection({
  worst,
  best,
}: {
  worst: ClientHealthRow[];
  best: ClientHealthRow[];
}) {
  const t = await getTranslations("Executive.clientHealth");
  return (
    <section className="mb-10">
      <SectionTitle
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/clients" className="text-xs text-cyan hover:underline">
            {t("viewAll")}
          </Link>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {/* Worst */}
        <Card className="border-cc-red/15">
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cc-red">
              <AlertCircle className="size-3.5" />
              {t("worstTitle")}
            </div>
            {worst.length === 0 ? (
              <EmptyState
                variant="compact"
                title={t("worstEmpty")}
                description=""
              />
            ) : (
              <div className="space-y-1.5">
                {worst.map((r, i) => (
                  <HealthRow key={r.clientId} row={r} mode="worst" isLead={i === 0} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Best */}
        <Card className="border-cc-green/15">
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cc-green">
              <CheckCircle2 className="size-3.5" />
              {t("bestTitle")}
            </div>
            {best.length === 0 ? (
              <EmptyState
                variant="compact"
                title={t("bestEmpty")}
                description={t("bestEmptyDescription")}
              />
            ) : (
              <div className="space-y-1.5">
                {best.map((r) => (
                  <HealthRow key={r.clientId} row={r} mode="best" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
