import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getAccountabilityOverview,
  getEmployeeAccountabilityEvidence,
} from "@/lib/data/accountability";
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
  searchParams: Promise<{ emp?: string; employee?: string; view?: string }>;
}) {
  const session = await requirePagePermission("people.analytics.view");
  const t = await getTranslations("AccountabilityPage");
  const { emp, employee, view } = await searchParams;
  const selectedId = emp ?? employee ?? null;
  const initialView =
    view === "scorecard" || selectedId
      ? "scorecard"
      : view === "cases"
        ? "cases"
        : "team";

  // getAccountabilityCases / getAccountabilityRoster reuse getAccountabilityOverview
  // via React cache(), so these calls dedupe to a single overview compute.
  const [overview, cases, roster, caseMeta, evidence, financeMap] = await Promise.all([
    getAccountabilityOverview(session.orgId),
    getAccountabilityCases(session.orgId),
    getAccountabilityRoster(session.orgId),
    syncAndGetCaseMeta(session.orgId),
    selectedId
      ? getEmployeeAccountabilityEvidence(session.orgId, selectedId)
      : Promise.resolve(null),
    getClientFinanceMap(session.orgId),
  ]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AccountabilityShell
        roster={roster}
        cases={cases}
        caseMeta={caseMeta}
        overview={overview}
        evidence={evidence}
        selectedId={selectedId}
        financeMap={financeMap}
        initialView={initialView}
      />
    </div>
  );
}
