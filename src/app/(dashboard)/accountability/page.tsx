import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getAccountabilityOverview,
  getEmployeeAccountabilityEvidence,
} from "@/lib/data/accountability";
import { PageHeader } from "@/components/page-header";
import { AccountabilityWorkspace } from "./accountability-workspace";

// Accountability Engine — CEO/department-head scorecard built on the Odoo
// stage-history mirror. Every aggregate opens its evidence list; AI-derived
// (Tier-B) signals are always labeled and never feed the Tier-A scores.
// Gated to people.analytics.view (owner/admin/manager only — this is a
// management evidence tool, not a team page; see migration 0162).
export default async function AccountabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string }>;
}) {
  const session = await requirePagePermission("people.analytics.view");
  const t = await getTranslations("AccountabilityPage");
  const { emp } = await searchParams;
  const selectedId = emp ?? null;

  const [overview, evidence] = await Promise.all([
    getAccountabilityOverview(session.orgId),
    selectedId
      ? getEmployeeAccountabilityEvidence(session.orgId, selectedId)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AccountabilityWorkspace
        overview={overview}
        evidence={evidence}
        selectedId={selectedId}
      />
    </div>
  );
}
