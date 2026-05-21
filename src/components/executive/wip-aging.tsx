import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Layers } from "lucide-react";
import type { WipAgingRow, WipAgeBucket } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

const AGE_TONE: Record<WipAgeBucket, { bar: string; ring: string; text: string }> = {
  "0-7": { bar: "bg-cc-green/55", ring: "border-cc-green/25", text: "text-cc-green" },
  "8-14": { bar: "bg-cyan/55", ring: "border-cyan/25", text: "text-cyan" },
  "15-30": { bar: "bg-amber/55", ring: "border-amber/25", text: "text-amber" },
  "31-90": { bar: "bg-cc-red/45", ring: "border-cc-red/25", text: "text-cc-red" },
  "90+": { bar: "bg-cc-red/65", ring: "border-cc-red/40", text: "text-cc-red" },
};

export async function WipAgingSection({ rows }: { rows: WipAgingRow[] }) {
  const t = await getTranslations("Executive.aging");
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const stale = rows.filter((r) => r.bucket === "31-90" || r.bucket === "90+").reduce((acc, r) => acc + r.count, 0);
  const stalePct = total > 0 ? Math.round((stale / total) * 100) : 0;
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <section className="mb-10">
      <SectionTitle
        title={t("title")}
        description={t("description", { total, stalePct })}
      />
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-5 gap-3">
            {rows.map((r) => {
              const tone = AGE_TONE[r.bucket];
              const heightPct = (r.count / max) * 100;
              const overduePct = r.count > 0 ? Math.round((r.overdueCount / r.count) * 100) : 0;
              return (
                <Link
                  key={r.bucket}
                  href={`/tasks?age=${r.bucket}`}
                  className={cn(
                    "group relative flex flex-col rounded-2xl border bg-card p-3 transition-colors hover:bg-soft-1",
                    tone.ring,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      {r.label}
                    </span>
                    <Layers className={cn("size-3.5", tone.text)} />
                  </div>

                  {/* Bar takes ~80px; sized by count share of max */}
                  <div className="relative mt-3 flex h-[88px] items-end overflow-hidden rounded-lg bg-soft-2">
                    <div
                      className={cn("w-full transition-all", tone.bar)}
                      style={{ height: `${Math.max(8, heightPct)}%` }}
                    />
                  </div>

                  <div className="mt-3">
                    <div className={cn("text-2xl font-bold tabular-nums leading-none", tone.text)}>
                      {r.count}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {r.overdueCount > 0 ? (
                        <span className="text-cc-red">
                          {r.overdueCount} {t("overdue")} · {overduePct}%
                        </span>
                      ) : (
                        <span>{t("noOverdue")}</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
