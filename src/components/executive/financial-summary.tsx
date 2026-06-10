import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Wallet, TrendingUp, ArrowUpRight } from "lucide-react";
import type { CeoDashboardData } from "@/lib/data/ceo-dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// CEO home → financial summary band. The IMPORTANT numbers from the monthly
// CEO dashboard (the sheet's "second section"): expected vs actual income +
// achievement, the two department targets, and the headline client counts.
// The full breakdown lives at /finance — this is the at-a-glance version.

function pct(actual: number, expected: number): number {
  return expected > 0 ? Math.round((actual / expected) * 100) : 0;
}

export async function FinancialSummary({ data }: { data: CeoDashboardData }) {
  const t = await getTranslations("Executive.financial");
  const locale = await getLocale();
  const sar = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
      maximumFractionDigits: 0,
    }).format(n);
  const currency = locale === "ar" ? "ر.س" : "SAR";

  const { income, account, sales, today } = data;
  const achievement = pct(income.actual, income.expected);

  return (
    <section className="mb-8">
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <Wallet className="size-4 text-cc-green" />
              {t("title")}
              <span className="font-normal text-muted-foreground">· {data.window.monthLabel}</span>
            </p>
            <Link href="/finance" className="text-xs text-cyan hover:underline">
              {t("full")}
            </Link>
          </div>

          {/* Headline: expected vs actual income + achievement bar */}
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-cyan/25 bg-cyan-dim/10 p-3.5">
                <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <TrendingUp className="size-3.5 text-cyan" /> {t("expected")}
                </p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-cyan">
                  {sar(income.expected)} <span className="text-sm text-muted-foreground">{currency}</span>
                </p>
              </div>
              <div className="rounded-xl border border-cc-green/25 bg-green-dim/10 p-3.5">
                <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <Wallet className="size-3.5 text-cc-green" /> {t("actual")}
                </p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-cc-green">
                  {sar(income.actual)} <span className="text-sm text-muted-foreground">{currency}</span>
                </p>
              </div>
            </div>

            {/* Achievement */}
            <div className="rounded-xl border border-soft-2 bg-card/60 p-3.5">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t("achievement")}
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    achievement >= 80 ? "text-cc-green" : achievement >= 40 ? "text-amber" : "text-cc-red",
                  )}
                >
                  {achievement}%
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-soft-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    achievement >= 80 ? "bg-cc-green" : achievement >= 40 ? "bg-amber" : "bg-cc-red",
                  )}
                  style={{ width: `${Math.min(100, achievement)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
                {t("ofExpected", { pct: achievement })}
              </p>
            </div>
          </div>

          {/* Department targets + client counts */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label={t("accountTarget")} value={`${sar(account.totalExpected)} ${currency}`} />
            <MiniStat label={t("salesTarget")} value={`${sar(sales.totalExpectedFromInstallments)} ${currency}`} />
            <MiniStat
              label={t("revenueGap")}
              value={`${sar(account.revenueGap + sales.gap)} ${currency}`}
              tone="warning"
            />
            <MiniStat label={t("totalClients")} value={today.totalClients} />
            <MiniStat label={t("onTarget")} value={account.onTarget} tone="success" />
            <MiniStat label={t("overdue")} value={account.overdue} tone="destructive" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="rounded-xl border border-soft bg-soft-1/40 p-2.5">
      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm font-bold tabular-nums",
          tone === "success" && "text-cc-green",
          tone === "warning" && "text-amber",
          tone === "destructive" && "text-cc-red",
        )}
      >
        {value}
        {tone === "success" && typeof value === "number" && value > 0 && (
          <ArrowUpRight className="ms-0.5 inline size-3" />
        )}
      </p>
    </div>
  );
}
