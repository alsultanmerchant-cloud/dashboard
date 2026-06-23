import { CheckCircle2, MessageSquareWarning, Plus, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { PulseStats } from "@/lib/data/executive";
import { Card, CardContent } from "@/components/ui/card";
import { MetricInfo } from "@/components/metric-info";
import { SectionTitle } from "@/components/section-title";
import { cn } from "@/lib/utils";

function pct(curr: number, prev: number): { sign: string; tone: string; Dir: React.ElementType } {
  if (prev === 0) {
    if (curr === 0) return { sign: "0%", tone: "text-muted-foreground", Dir: TrendingUp };
    return { sign: "new", tone: "text-cyan", Dir: TrendingUp };
  }
  const d = Math.round(((curr - prev) / prev) * 100);
  if (d === 0) return { sign: "0%", tone: "text-muted-foreground", Dir: TrendingUp };
  return {
    sign: `${d > 0 ? "+" : ""}${d}%`,
    tone: d > 0 ? "text-cc-green" : "text-cc-red",
    Dir: d > 0 ? TrendingUp : TrendingDown,
  };
}

// Reverse: for metrics where rising = worse (client changes, etc.)
function pctReverse(curr: number, prev: number) {
  const base = pct(curr, prev);
  return {
    ...base,
    tone:
      base.tone === "text-cc-green"
        ? "text-cc-red"
        : base.tone === "text-cc-red"
          ? "text-cc-green"
          : base.tone,
  };
}

interface CellProps {
  label: string;
  value: number;
  prev: number;
  Icon: React.ElementType;
  iconTone: string;
  reverse?: boolean;
  tip?: React.ReactNode;
}

function Cell({ label, value, prev, Icon, iconTone, reverse, tip }: CellProps) {
  const d = reverse ? pctReverse(value, prev) : pct(value, prev);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", iconTone)}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
          {tip ? <MetricInfo text={tip} /> : null}
        </p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", d.tone)}>
            <d.Dir className="size-3" />
            {d.sign}
          </span>
        </div>
      </div>
    </div>
  );
}

export async function PulseStrip({ data }: { data: PulseStats }) {
  const t = await getTranslations("Executive.pulse");
  return (
    <section className="mb-8">
      <SectionTitle title={t("title")} description={t("description")} />
      <Card className="border-cyan/15 bg-gradient-to-r from-card to-card/60">
        <CardContent className="grid grid-cols-2 divide-x divide-border/40 p-0 md:grid-cols-4 rtl:divide-x-reverse">
          <Cell
            label={t("completed")}
            value={data.completed.current}
            prev={data.completed.previous}
            Icon={CheckCircle2}
            iconTone="bg-green-dim text-cc-green"
            tip={t("metricTooltips.dashboard_pulseCompleted")}
          />
          <Cell
            label={t("tasksAdded")}
            value={data.tasksAdded.current}
            prev={data.tasksAdded.previous}
            Icon={Plus}
            iconTone="bg-cyan-dim text-cyan"
            tip={t("metricTooltips.dashboard_pulseTasksAdded")}
          />
          <Cell
            label={t("clientChanges")}
            value={data.newClientChanges.current}
            prev={data.newClientChanges.previous}
            Icon={MessageSquareWarning}
            iconTone="bg-amber-dim text-amber"
            reverse
            tip={t("metricTooltips.dashboard_pulseClientChanges")}
          />
          <Cell
            label={t("approvals")}
            value={data.approvalsResolved.current}
            prev={data.approvalsResolved.previous}
            Icon={ShieldCheck}
            iconTone="bg-purple-dim text-cc-purple"
            tip={t("metricTooltips.dashboard_pulseApprovals")}
          />
        </CardContent>
      </Card>
    </section>
  );
}
