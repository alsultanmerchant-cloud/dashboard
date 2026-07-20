import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { FileText, Printer } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { DateRangePicker } from "@/components/executive/date-range-picker";
import { resolveRange } from "@/lib/dashboard-range";
import {
  getCurrentExecutiveReport,
  listRecentExecutiveReports,
} from "@/lib/executive-report-generate";
import { GenerateReportButton } from "@/components/reports/generate-report-button";
import { ReportDocument } from "@/components/reports/report-document";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// مركز التقارير — pick a period, generate a frozen executive report (facts
// computed from the verified loaders + an AI analyst narrative), read it like
// a document, print it. The same stored run feeds /reports/print.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const session = await requirePagePermission("reports.view");
  const t = await getTranslations("ReportsPage");
  const locale = await getLocale();
  const sp = (await searchParams) ?? {};
  const range = resolveRange(sp);
  const canFinance = hasPermission(session, "finance.view");

  const [run, recent] = await Promise.all([
    getCurrentExecutiveReport(session.orgId, { from: range.from, to: range.to }),
    listRecentExecutiveReports(session.orgId),
  ]);

  const printHref = `/reports/print?from=${range.from}&to=${range.to}`;
  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(
      locale === "ar" ? "ar-SA-u-nu-latn" : "en-US",
      { day: "numeric", month: "short", year: "numeric" },
    );

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          run ? (
            <Link
              href={printHref}
              target="_blank"
              className="inline-flex items-center gap-2 rounded-xl border border-soft bg-card px-4 py-2 text-sm font-semibold transition-colors hover:bg-soft-1"
            >
              <Printer className="size-4" />
              {t("print.button")}
            </Link>
          ) : undefined
        }
      />

      <DateRangePicker range={range} />

      {/* Generation toolbar — the report is a frozen artifact per period. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan/20 bg-card p-4">
        <div className="text-sm">
          <p className="font-semibold">
            {t("toolbar.period")}{" "}
            <span className="tabular-nums" dir="ltr">
              {range.from} → {range.to}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {run?.completedAt
              ? t("toolbar.generatedAt", {
                  date: new Date(run.completedAt).toLocaleString(
                    locale === "ar" ? "ar-SA-u-nu-latn" : "en-US",
                    { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" },
                  ),
                })
              : t("toolbar.notGenerated")}
          </p>
        </div>
        <GenerateReportButton
          from={range.from}
          to={range.to}
          preset={range.preset}
          hasRun={Boolean(run)}
        />
      </div>

      {run?.facts ? (
        <ReportDocument
          facts={run.facts}
          result={run.result}
          canFinance={canFinance}
          completedAt={run.completedAt}
          aiWarning={run.errorMessage}
        />
      ) : (
        <div className="mb-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-soft bg-card/40 px-6 py-16 text-center">
          <FileText className="size-10 text-cyan" />
          <p className="text-base font-semibold">{t("empty.title")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("empty.body")}</p>
        </div>
      )}

      {recent.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("recent.title")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => {
              const isCurrent = r.rangeFrom === range.from && r.rangeTo === range.to;
              return (
                <Link
                  key={r.id}
                  href={`/reports?preset=custom&from=${r.rangeFrom}&to=${r.rangeTo}`}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs tabular-nums transition-colors",
                    isCurrent
                      ? "border-cyan/40 bg-cyan-dim/30 text-foreground"
                      : "border-soft bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {fmtDate(r.rangeFrom)} — {fmtDate(r.rangeTo)}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
