import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { resolveRange } from "@/lib/dashboard-range";
import { getCurrentExecutiveReport } from "@/lib/executive-report-generate";
import { ReportDocument } from "@/components/reports/report-document";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

// Paper view of the SAME frozen run /reports shows — never regenerates, so
// the printout always matches the screen.
export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams?: Promise<{ preset?: string; from?: string; to?: string; auto?: string }>;
}) {
  const session = await requirePagePermission("reports.view");
  const t = await getTranslations("ReportsPage");
  const sp = (await searchParams) ?? {};
  const range = resolveRange(sp);
  const canFinance = hasPermission(session, "finance.view");

  const run = await getCurrentExecutiveReport(session.orgId, {
    from: range.from,
    to: range.to,
  });

  if (!run?.facts) {
    return (
      <div className="py-16 text-center">
        <p className="text-base font-semibold">{t("print.noRunTitle")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("print.noRunBody")}</p>
        <Link href="/reports" className="mt-4 inline-block text-sm text-cyan hover:underline">
          {t("print.backToReports")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PrintTrigger auto={sp.auto === "1"} />
      <ReportDocument
        facts={run.facts}
        result={run.result}
        canFinance={canFinance}
        completedAt={run.completedAt}
        aiWarning={run.errorMessage}
      />
    </div>
  );
}
