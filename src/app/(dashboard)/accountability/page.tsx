import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getAccountabilityReviewers,
  getClientEditsRigor,
} from "@/lib/data/accountability";
import { resolveRange } from "@/lib/dashboard-range";
import { getAccountabilityCases } from "@/lib/data/accountability-cases";
import { getAccountabilityRoster } from "@/lib/data/accountability-roster";
import {
  getProblemHistorySummary,
  getReopenByEmployee,
  syncAndGetProblemMeta,
} from "@/lib/data/accountability-problems-store";
import { attachAskProjects, buildCaseBrief } from "@/lib/data/accountability-case-brief";
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
    preset?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await requirePagePermission("people.analytics.view");
  const t = await getTranslations("AccountabilityPage");
  const params = await searchParams;
  const reviewerRange = resolveRange(params);

  const [cases, roster, problemMeta, history, reopenByEmployee, reviewers, clientEdits] = await Promise.all([
    getAccountabilityCases(session.orgId),
    getAccountabilityRoster(session.orgId, reviewerRange.from, reviewerRange.to),
    syncAndGetProblemMeta(session.orgId),
    getProblemHistorySummary(session.orgId, reviewerRange).catch(() => null),
    getReopenByEmployee(session.orgId).catch(() => ({})),
    getAccountabilityReviewers(session.orgId, reviewerRange.from, reviewerRange.to),
    getClientEditsRigor(session.orgId, reviewerRange.from, reviewerRange.to).catch((e) => {
      console.error("[accountability] client edits failed:", e);
      return [];
    }),
  ]);

  // The CEO band over the case feed: a pure fold over data already loaded,
  // then the Rawasm project names the heads actually recognize are attached
  // beside each ask's clients (a handful of cached lookups).
  const brief = await attachAskProjects(
    session.orgId,
    buildCaseBrief(cases, history, reopenByEmployee),
    cases,
  );

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AccountabilityShell
        roster={roster}
        cases={cases}
        problemMeta={problemMeta}
        brief={brief}
        reviewers={reviewers}
        clientEdits={clientEdits}
        reviewerRange={reviewerRange}
      />
    </div>
  );
}
