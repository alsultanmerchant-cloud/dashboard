import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RefreshCw } from "lucide-react";
import type { RevisedTaskRow } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { SectionTitle } from "@/components/section-title";
import { TaskStageBadge } from "@/components/status-badges";
import { relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

function revTone(n: number) {
  if (n >= 8) return "text-cc-red bg-red-dim";
  if (n >= 4) return "text-amber bg-amber-dim";
  return "text-cyan bg-cyan-dim";
}

export async function TopRevisedTasksSection({ rows }: { rows: RevisedTaskRow[] }) {
  const t = await getTranslations("Executive.topRevised");
  return (
    <section className="mb-10">
      <SectionTitle title={t("title")} description={t("description")} />
      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<RefreshCw className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <Card>
          <CardContent className="grid divide-y divide-border/40 p-0">
            {rows.map((r, i) => (
              <Link
                key={r.taskId}
                href={`/tasks/${r.taskId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-soft-1"
              >
                <div
                  className={cn(
                    "flex shrink-0 size-12 flex-col items-center justify-center rounded-xl",
                    revTone(r.revisionCount),
                    i === 0 && r.revisionCount >= 8 && "ring-1 ring-cc-red/30",
                  )}
                >
                  <span className="text-lg font-bold tabular-nums leading-none">
                    {r.revisionCount}
                  </span>
                  <span className="text-[8px] uppercase tracking-wider opacity-80 mt-0.5">
                    {t("revisions")}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {r.clientName ? `${r.clientName} · ` : ""}{r.projectName ?? "—"}
                  </p>
                </div>

                <div className="hidden shrink-0 flex-col items-end gap-1 md:flex">
                  <TaskStageBadge stage={r.stage} />
                  <span className="text-[10px] text-muted-foreground">
                    {relativeTimeAr(r.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
