import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { listContractClientOptions, getClientSearchKeywords } from "@/lib/data/clients";
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
  searchParams: Promise<{ client?: string; analysis?: string; risk?: string }>;
}) {
  const session = await requirePagePermission("clients.view");
  const t = await getTranslations("SatisfactionPage");
  const sp = await searchParams;
  const selectedId = sp.client ?? null;
  const selectedAnalysisId = sp.analysis ?? null;
  // When linked from the dashboard "at-risk clients" stat, open straight to the
  // at-risk-only view. See [[project_ceo_insights_panel]].
  const initialRisk = sp.risk === "1";

  const [clients, keywords, rows, detail, execution, financeMap] = await Promise.all([
    // Picker lists CONTRACT clients only — the agency's actual client book,
    // named from the contract sheet. No-contract Odoo/lead rows (tests,
    // placeholders, un-signed leads) are excluded. See [[project_clients_centralization]].
    listContractClientOptions(session.orgId),
    getClientSearchKeywords(session.orgId),
    getSatisfactionRows(session.orgId),
    selectedId
      ? getClientSatisfactionDetail(session.orgId, selectedId, selectedAnalysisId)
      : Promise.resolve(null),
    selectedId ? getClientExecutionSnapshot(session.orgId, selectedId) : Promise.resolve(null),
    getClientFinanceMap(session.orgId),
  ]);

  // Each option is findable by client name (label) OR any linked identifier —
  // project / group / contract names (keywords). See [[project_clients_centralization]].
  const options = clients.map((c) => ({
    value: c.id as string,
    label: c.name as string,
    keywords: keywords.get(c.id as string) ?? null,
  }));

  // The picker lists contract clients only, but a no-contract client can still be
  // reached from the board (e.g. an analyzed WhatsApp-only client). Keep the
  // current selection visible in the dropdown so its name shows as selected.
  if (selectedId && detail && !options.some((o) => o.value === selectedId)) {
    options.push({
      value: selectedId,
      label: detail.clientName,
      keywords: keywords.get(selectedId) ?? null,
    });
  }

  // Same keyword blob, but as a plain record so the overview board/table search
  // can match a client by ANY identifier (project / group / contract), not just
  // its display name — mirroring the top picker. See [[project_clients_centralization]].
  const searchKeywords: Record<string, string> = Object.fromEntries(keywords);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SatisfactionWorkspace
        options={options}
        searchKeywords={searchKeywords}
        rows={rows}
        detail={detail}
        financeMap={financeMap}
        execution={execution}
        selectedId={selectedId}
        selectedAnalysisId={selectedAnalysisId}
        initialRisk={initialRisk}
      />
    </div>
  );
}
