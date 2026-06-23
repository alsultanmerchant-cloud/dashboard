import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";
import type { UpcomingDeadlineDay } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

const WEEKDAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function loadTone(count: number) {
  if (count >= 15) return { ring: "border-cc-red/50", bar: "bg-cc-red", text: "text-cc-red" };
  if (count >= 6) return { ring: "border-amber/45", bar: "bg-amber", text: "text-amber" };
  if (count > 0) return { ring: "border-cyan/30", bar: "bg-cyan", text: "text-cyan" };
  return { ring: "border-border", bar: "bg-muted-foreground/30", text: "text-muted-foreground" };
}

export async function UpcomingDeadlinesSection({ days }: { days: UpcomingDeadlineDay[] }) {
  const t = await getTranslations("Executive.deadlines");
  const total = days.reduce((acc, d) => acc + d.count, 0);
  const max = Math.max(...days.map((d) => d.count), 1);

  return (
    <section className="mb-10">
      <SectionTitle
        title={t("title")}
        description={t("description", { total })}
        actions={
          <Link href="/tasks?f=due_week" className="text-xs text-cyan hover:underline">
            {t("viewAll")}
          </Link>
        }
      />
      <Card>
        <CardContent className="grid grid-cols-7 gap-2 p-3">
          {days.map((d, i) => {
            const dayName = WEEKDAY_AR[Number(d.weekday)] ?? d.weekday;
            const tone = loadTone(d.count);
            const heightPct = (d.count / max) * 100;
            const isToday = i === 0;
            return (
              <Link
                key={d.date}
                href={isToday ? `/tasks?f=due_today` : `/tasks?f=due_week`}
                className={cn(
                  "group relative flex flex-col rounded-xl border bg-card p-2 transition-colors hover:bg-soft-1",
                  tone.ring,
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={cn("text-[10px] font-medium uppercase tracking-wide", isToday ? "text-cyan" : "text-muted-foreground")}>
                    {isToday ? t("today") : dayName}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {d.date.slice(5)}
                  </span>
                </div>

                <div className={cn("mt-2 text-2xl font-bold tabular-nums leading-none", tone.text)}>
                  {d.count}
                </div>

                {/* Mini intensity bar */}
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-soft-2">
                  <div
                    className={cn("h-full transition-all", tone.bar)}
                    style={{ width: `${heightPct}%` }}
                  />
                </div>

                {/* Highlights */}
                <div className="mt-2 space-y-0.5 min-h-[36px]">
                  {d.highlights.slice(0, 2).map((h) => (
                    <p
                      key={h.taskId}
                      className="truncate text-[10px] text-muted-foreground"
                      title={h.title}
                    >
                      {h.title}
                    </p>
                  ))}
                  {d.count === 0 && (
                    <p className="text-[10px] text-muted-foreground/60">—</p>
                  )}
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}
