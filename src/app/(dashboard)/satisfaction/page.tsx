import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listContractClientOptions, getClientSearchKeywords } from "@/lib/data/clients";
import {
  getSatisfactionRows,
  getClientSatisfactionDetail,
  getClientExecutionSnapshot,
  getClientMediaExchange,
} from "@/lib/data/satisfaction";
import { getClientFinanceMap } from "@/lib/data/client-finance";
import { listNonConnectedWaAccounts } from "@/lib/data/wa-accounts";
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

  const [clients, keywords, rows, detail, execution, media, financeMap, nonConnectedAccounts] = await Promise.all([
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
    selectedId ? getClientMediaExchange(session.orgId, selectedId) : Promise.resolve(null),
    getClientFinanceMap(session.orgId),
    listNonConnectedWaAccounts(session.orgId),
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

  // The whole page is scoped to the CONTRACT BOOK. The board/table only shows
  // clients connected to a contract (the same set the picker lists) — no-contract
  // Odoo/lead rows are dropped even if they carry WhatsApp chats. This mirrors the
  // picker so a client can never appear here with its raw project name.
  const contractClientIds = new Set(clients.map((c) => c.id as string));
  const boardRows = rows.filter((r) => contractClientIds.has(r.clientId));

  // Same keyword blob, but as a plain record so the overview board/table search
  // can match a client by ANY identifier (project / group / contract), not just
  // its display name — mirroring the top picker. See [[project_clients_centralization]].
  const searchKeywords: Record<string, string> = Object.fromEntries(keywords);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {nonConnectedAccounts.length > 0 && (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-3 rounded-xl border border-cc-red/30 bg-red-dim px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-cc-red/10 text-cc-red">
              <AlertTriangle className="size-4" />
            </span>
            <div>
              <p className="font-semibold text-cc-red">{t("connectionBanner.title")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("connectionBanner.body", {
                  names: nonConnectedAccounts.map((account) => account.displayName).join("، "),
                })}
              </p>
            </div>
          </div>
          {session.permissions.has("clients.manage") ? (
            <Link
              href="/satisfaction/connect"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cc-red/30 bg-card px-3 py-2 text-xs font-semibold text-cc-red transition-colors hover:bg-red-dim"
            >
              {t("connectionBanner.action")}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          ) : (
            <p className="shrink-0 text-xs font-medium text-cc-red">
              {t("connectionBanner.contactAdmin")}
            </p>
          )}
        </div>
      )}
      <SatisfactionWorkspace
        canManageClients={session.permissions.has("clients.manage")}
        options={options}
        searchKeywords={searchKeywords}
        rows={boardRows}
        detail={detail}
        financeMap={financeMap}
        execution={execution}
        media={media}
        selectedId={selectedId}
        selectedAnalysisId={selectedAnalysisId}
        initialRisk={initialRisk}
      />
    </div>
  );
}
