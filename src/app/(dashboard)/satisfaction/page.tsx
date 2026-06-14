import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { listClientOptions } from "@/lib/data/clients";
import {
  getSatisfactionRows,
  getClientSatisfactionDetail,
  getClientExecutionSnapshot,
} from "@/lib/data/satisfaction";
import { getClientFinanceMap } from "@/lib/data/client-finance";
import { PageHeader } from "@/components/page-header";
import { SatisfactionWorkspace } from "./satisfaction-workspace";

export default async function SatisfactionPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; analysis?: string }>;
}) {
  const session = await requirePagePermission("clients.view");
  const t = await getTranslations("SatisfactionPage");
  const sp = await searchParams;
  const selectedId = sp.client ?? null;
  const selectedAnalysisId = sp.analysis ?? null;

  const [clients, rows, detail, execution, financeMap] = await Promise.all([
    listClientOptions(session.orgId),
    getSatisfactionRows(session.orgId),
    selectedId
      ? getClientSatisfactionDetail(session.orgId, selectedId, selectedAnalysisId)
      : Promise.resolve(null),
    selectedId ? getClientExecutionSnapshot(session.orgId, selectedId) : Promise.resolve(null),
    getClientFinanceMap(session.orgId),
  ]);

  const options = clients.map((c) => ({ value: c.id as string, label: c.name as string }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SatisfactionWorkspace
        options={options}
        rows={rows}
        detail={detail}
        financeMap={financeMap}
        execution={execution}
        selectedId={selectedId}
        selectedAnalysisId={selectedAnalysisId}
      />
    </div>
  );
}
