import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getAccountabilityOverview,
  getAccountabilityReviewers,
  getEmployeeAccountabilityEvidence,
} from "@/lib/data/accountability";
import { resolveRange } from "@/lib/dashboard-range";
import { getAccountabilityCases } from "@/lib/data/accountability-cases";
import { getAccountabilityRoster } from "@/lib/data/accountability-roster";
import { syncAndGetCaseMeta } from "@/lib/data/accountability-cases-store";
import { getClientFinanceMap } from "@/lib/data/client-finance";
import { PageHeader } from "@/components/page-header";
import { AccountabilityShell } from "./accountability-shell";

// Accountability Engine — CEO/department-head scorecard built on the Odoo
// stage-history mirror. Every aggregate opens its evidence list; AI-derived
// (Tier-B) signals are always labeled and never feed the Tier-A scores.
// Gated to people.analytics.view (owner/admin/manager only — this is a
// management evidence tool, not a team page; see migration 0162).
export default async function AccountabilityPage({
  searchParams,
}: {
  searchParams: Promise<{
    emp?: string;
    employee?: string;
    view?: string;
    preset?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await requirePagePermission("people.analytics.view");
  const t = await getTranslations("AccountabilityPage");
  const params = await searchParams;
  const { emp, employee, view } = params;
  const reviewerRange = resolveRange(params);
  const selectedId = emp ?? employee ?? null;
  const initialView =
    view === "scorecard" || selectedId
      ? "scorecard"
      : view === "cases"
        ? "cases"
        : "team";

  const needsScorecard = initialView === "scorecard";
  // Default /accountability opens on the team lens, so keep the initial payload
  // to what that lens needs. Scorecard-only data (full overview serialization,
  // finance badges, selected employee evidence) is loaded only for direct
  // scorecard links: ?view=scorecard or ?emp=...
  const [cases, roster, caseMeta, reviewers, scorecardData] = await Promise.all([
    getAccountabilityCases(session.orgId),
    getAccountabilityRoster(session.orgId, reviewerRange.from, reviewerRange.to),
    syncAndGetCaseMeta(session.orgId),
    getAccountabilityReviewers(session.orgId, reviewerRange.from, reviewerRange.to),
    needsScorecard
      ? Promise.all([
          getAccountabilityOverview(session.orgId, reviewerRange.from, reviewerRange.to),
          selectedId
            ? getEmployeeAccountabilityEvidence(session.orgId, selectedId)
            : Promise.resolve(null),
          getClientFinanceMap(session.orgId),
        ]).then(([overview, evidence, financeMap]) => ({ overview, evidence, financeMap }))
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AccountabilityShell
        roster={roster}
        cases={cases}
        caseMeta={caseMeta}
        overview={scorecardData?.overview ?? null}
        evidence={scorecardData?.evidence ?? null}
        selectedId={selectedId}
        financeMap={scorecardData?.financeMap ?? null}
        initialView={initialView}
        reviewers={reviewers}
        reviewerRange={reviewerRange}
      />
    </div>
  );
}
