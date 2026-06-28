import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  gradeFor,
  type ExecutiveScores,
  type ScoreGrade,
} from "@/lib/data/executive-scores";
import { cn } from "@/lib/utils";
import { Explained } from "@/components/metric-info";

// Executive index band: one big Operational Stability hero + the four
// contributing indices. Each index is a 0-100 composite with a grade,
// a period delta, and the sub-metrics that feed it.

type Tone = "good" | "warn" | "bad" | "neutral" | "na";

interface Metric {
  label: string;
  value: string;
  tone: Tone;
  hint?: string;
}

function toneByScore(score: number): {
  text: string;
  ring: string;
  border: string;
  chip: string;
} {
  if (score >= 70)
    return {
      text: "text-cc-green",
      ring: "text-cc-green",
      border: "border-cc-green/30",
      chip: "bg-green-dim text-cc-green",
    };
  if (score >= 55)
    return {
      text: "text-amber",
      ring: "text-amber",
      border: "border-amber/30",
      chip: "bg-amber-dim text-amber",
    };
  return {
    text: "text-cc-red",
    ring: "text-cc-red",
    border: "border-cc-red/30",
    chip: "bg-red-dim text-cc-red",
  };
}

function metricTone(tone: Tone): string {
  switch (tone) {
    case "good":
      return "text-cc-green";
    case "warn":
      return "text-amber";
    case "bad":
      return "text-cc-red";
    case "na":
      return "text-muted-foreground/60";
    default:
      return "text-foreground";
  }
}

function ScoreRing({ score, className }: { score: number; className?: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg viewBox="0 0 64 64" className={cn("size-16 -rotate-90", className)}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-border" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}

function DeltaChip({ delta, label }: { delta: number | null; label: string }) {
  if (delta === null) return null;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone =
    delta > 0 ? "text-cc-green" : delta < 0 ? "text-cc-red" : "text-muted-foreground";
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[10px] font-medium", tone)}
      title={label}
    >
      <Icon className="size-3" />
      {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}

function IndexCard({
  icon,
  name,
  desc,
  score,
  delta,
  deltaLabel,
  gradeLabel,
  metrics,
  href,
  scoreHelp,
}: {
  icon: ReactNode;
  name: string;
  desc: string;
  score: number;
  delta: number | null;
  deltaLabel: string;
  gradeLabel: string;
  metrics: Metric[];
  href: string;
  scoreHelp?: string;
}) {
  const tone = toneByScore(score);
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-2xl border bg-card p-4 transition-all hover:border-cyan/35",
        tone.border,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-soft-2 text-cyan">
          {icon}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", tone.chip)}>
          {gradeLabel}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Explained text={scoreHelp ?? ""}>
          <div className={cn("relative shrink-0", tone.ring)}>
            <ScoreRing score={score} />
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums",
                tone.text,
              )}
            >
              {score}
            </span>
          </div>
        </Explained>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
            {desc}
          </p>
          <div className="mt-1">
            <DeltaChip delta={delta} label={deltaLabel} />
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
        {metrics.map((m) => (
          <li key={m.label} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-muted-foreground" title={m.hint ?? m.label}>
              {m.label}
            </span>
            <span className={cn("shrink-0 font-semibold tabular-nums", metricTone(m.tone))}>
              {m.value}
            </span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

export async function ExecutiveScoresBand({ data }: { data: ExecutiveScores }) {
  const t = await getTranslations("Executive.scores");
  const grade = (g: ScoreGrade) => t(`grades.${g}`);
  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
  const rate = (n: number) => `${Math.round(n * 100)}%`;

  const { quality, discipline, productivity, stability } = data;
  const stabilityTone = toneByScore(stability.score);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-cyan" />
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <span className="text-[11px] text-muted-foreground">— {t("subtitle")}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.15fr_2fr]">
        {/* Operational Stability — hero */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-card/40 p-5",
            stabilityTone.border,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-cyan" />
                {t("stability.name")}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
                {t("stability.desc")}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                stabilityTone.chip,
              )}
            >
              {grade(gradeFor(stability.score))}
            </span>
          </div>

          <div className="mt-4 flex items-end gap-2">
            <Explained text={t("scoreTooltips.stability")}>
              <span className={cn("text-6xl font-bold tabular-nums leading-none", stabilityTone.text)}>
                {stability.score}
              </span>
            </Explained>
            <span className="mb-1 text-base font-medium text-muted-foreground">/100</span>
            <span className="mb-1.5 ms-auto">
              <DeltaChip delta={stability.delta} label={t("vsPrev")} />
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-center sm:grid-cols-4">
            <Link
              href="/projects?atRisk=1"
              className="group rounded-xl p-1.5 transition-colors hover:bg-soft-2"
            >
              <p className="text-base font-semibold tabular-nums text-amber group-hover:underline">
                {stability.riskProjects}
              </p>
              <p className="text-[9px] text-muted-foreground">{t("stability.riskProjects")}</p>
            </Link>
            <Link
              href="/satisfaction?risk=1"
              className="group rounded-xl p-1.5 transition-colors hover:bg-soft-2"
            >
              <p
                className={cn(
                  "text-base font-semibold tabular-nums group-hover:underline",
                  stability.atRiskClients > 0 ? "text-cc-red" : "text-muted-foreground",
                )}
              >
                {stability.atRiskClients}
              </p>
              <p className="text-[9px] text-muted-foreground">{t("stability.atRiskClients")}</p>
            </Link>
            <Link
              href="/escalations"
              className="group rounded-xl p-1.5 transition-colors hover:bg-soft-2"
            >
              <p
                className={cn(
                  "text-base font-semibold tabular-nums group-hover:underline",
                  stability.unackEscalations > 0 ? "text-cc-red" : "text-muted-foreground",
                )}
              >
                {stability.unackEscalations}
              </p>
              <p className="text-[9px] text-muted-foreground">{t("stability.escalations")}</p>
            </Link>
            <Link
              href="/tasks?f=critical"
              className="group rounded-xl p-1.5 transition-colors hover:bg-soft-2"
            >
              <p
                className={cn(
                  "text-base font-semibold tabular-nums group-hover:underline",
                  stability.criticalOverdue > 0 ? "text-cc-red" : "text-muted-foreground",
                )}
              >
                {stability.criticalOverdue}
              </p>
              <p className="text-[9px] text-muted-foreground">{t("stability.critical")}</p>
            </Link>
          </div>

          <Link
            href="/reports"
            className="mt-3 flex items-center justify-end gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
          >
            {t("stability.fullReport")}
            <ChevronLeft className="size-3 ltr:rotate-180" />
          </Link>
        </div>

        {/* Three contributing indices. Delivery Commitment was removed here
            (team feedback 2026-06-28) — its on-time / overdue numbers already
            live in the sections above (نبض الفريق + delivery flow), so the card
            was duplicate. Delivery still feeds the الاستقرار composite (30%). */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <IndexCard
            icon={<Sparkles className="size-4" />}
            name={t("quality.name")}
            desc={t("quality.desc")}
            score={quality.score}
            delta={quality.delta}
            deltaLabel={t("vsPrev")}
            gradeLabel={grade(gradeFor(quality.score))}
            scoreHelp={t("scoreTooltips.quality")}
            href="/satisfaction"
            metrics={[
              {
                label: t("quality.rework"),
                value: rate(quality.reworkRate),
                tone: quality.reworkRate > 0.25 ? "bad" : quality.reworkRate > 0.1 ? "warn" : "good",
              },
              {
                label: t("quality.rejection"),
                value: rate(quality.rejectionRate),
                tone:
                  quality.rejectionRate > 0.2 ? "bad" : quality.rejectionRate > 0.05 ? "warn" : "good",
              },
              quality.satisfactionScore === null
                ? {
                    label: t("quality.satisfaction"),
                    value: t("na"),
                    tone: "na",
                    hint: t("naSourceSatisfaction"),
                  }
                : {
                    label: t("quality.satisfaction"),
                    value: String(quality.satisfactionScore),
                    tone:
                      quality.satisfactionScore >= 70
                        ? "good"
                        : quality.satisfactionScore >= 50
                          ? "warn"
                          : "bad",
                    hint: t("analyzedClients", { n: quality.analyzedClients }),
                  },
              // Brief-adherence row removed (team feedback 2026-06-28): the AI
              // rarely has the real brief doc, so the metric is unreliable — it
              // no longer counts toward the score nor shows as a stat here.
            ]}
          />

          <IndexCard
            icon={<Activity className="size-4" />}
            name={t("discipline.name")}
            desc={t("discipline.desc")}
            score={discipline.score}
            delta={discipline.delta}
            deltaLabel={t("vsPrev")}
            gradeLabel={grade(gradeFor(discipline.score))}
            scoreHelp={t("scoreTooltips.discipline")}
            href="/tasks?f=behind"
            metrics={[
              discipline.activeMembers === null
                ? { label: t("discipline.active"), value: t("na"), tone: "na", hint: t("naSource") }
                : {
                    label: t("discipline.active"),
                    value: `${discipline.activeMembers}/${discipline.totalMembers}`,
                    tone:
                      discipline.totalMembers > 0 &&
                      discipline.activeMembers / discipline.totalMembers >= 0.6
                        ? "good"
                        : discipline.activeMembers > 0
                          ? "warn"
                          : "bad",
                  },
              {
                label: t("discipline.actions"),
                value: String(discipline.actions7d),
                tone: "neutral",
              },
              {
                label: t("discipline.stale"),
                value: String(discipline.staleTasks),
                tone:
                  discipline.openCount > 0 && discipline.staleTasks / discipline.openCount > 0.4
                    ? "bad"
                    : discipline.staleTasks > 0
                      ? "warn"
                      : "good",
              },
              {
                label: t("discipline.sla"),
                value: pct(discipline.slaCompliancePct),
                tone:
                  discipline.slaCompliancePct === null
                    ? "neutral"
                    : discipline.slaCompliancePct >= 80
                      ? "good"
                      : discipline.slaCompliancePct >= 50
                        ? "warn"
                        : "bad",
              },
            ]}
          />

          <IndexCard
            icon={<AlertTriangle className="size-4" />}
            name={t("productivity.name")}
            desc={t("productivity.desc")}
            score={productivity.score}
            delta={productivity.delta}
            deltaLabel={t("vsPrev")}
            gradeLabel={grade(gradeFor(productivity.score))}
            scoreHelp={t("scoreTooltips.productivity")}
            href="/reports"
            metrics={[
              {
                label: t("productivity.completed"),
                value: String(productivity.completed30d),
                tone: "neutral",
              },
              productivity.utilizationPct === null
                ? {
                    label: t("productivity.utilization"),
                    value: t("na"),
                    tone: "na",
                    hint: t("naSource"),
                  }
                : {
                    label: t("productivity.utilization"),
                    value: pct(productivity.utilizationPct),
                    tone:
                      productivity.utilizationPct >= 60 && productivity.utilizationPct <= 100
                        ? "good"
                        : "warn",
                  },
              {
                label: t("productivity.overloaded"),
                value: String(productivity.overloaded),
                tone: productivity.overloaded > 0 ? "warn" : "good",
              },
              {
                label: t("productivity.underutilized"),
                value: String(productivity.underutilized),
                tone: productivity.underutilized > 0 ? "warn" : "good",
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
