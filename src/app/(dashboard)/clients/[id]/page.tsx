import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowUpLeft, FileSignature, FileText } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getClient } from "@/lib/data/clients";
import { listClientContracts } from "@/lib/data/contracts";
import { listEntityActivity } from "@/lib/data/entity-activity";
import { listMentionableEmployees } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatShortDate } from "@/lib/utils-format";
import { EntityActivityFeed } from "@/components/activity/entity-activity-feed";
import { EntityCommentComposer } from "@/components/activity/entity-comment-composer";

const CLOSED_STATUSES = new Set(["lost", "closed"]);

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(value);
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("clients.view");
  const t = await getTranslations("ClientDetailPage");
  const locale = await getLocale();
  const { id } = await params;

  const client = await getClient(session.orgId, id);
  if (!client) notFound();

  const [contracts, activity, mentionable] = await Promise.all([
    listClientContracts(session.orgId, id),
    listEntityActivity(session.orgId, { entityType: "client", entityId: id }),
    listMentionableEmployees(session.orgId),
  ]);

  const clientName = (client.name as string | null) ?? "—";
  const activeCount = contracts.filter((c) => !CLOSED_STATUSES.has(c.status)).length;
  const totalValue = contracts.reduce((sum, c) => sum + Number(c.total_value || 0), 0);

  return (
    <div className="pb-32">
      <PageHeader
        title={clientName}
        actions={
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-xs text-cyan hover:underline"
          >
            <ArrowUpLeft className="size-3 icon-flip-rtl" />
            {t("back")}
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricCard
          label={t("metrics.contracts")}
          value={contracts.length}
          icon={<FileSignature className="size-5" />}
          tone="default"
        />
        <MetricCard
          label={t("metrics.active")}
          value={activeCount}
          tone="success"
        />
        <MetricCard
          label={t("metrics.totalValue")}
          value={formatCurrency(totalValue)}
          tone="info"
        />
      </div>

      <SectionTitle title={t("contractsTitle")} />
      <div className="mb-8">
        {contracts.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title={t("noContracts")}
          />
        ) : (
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>الكود</DataTableHeaderCell>
                  <DataTableHeaderCell>النوع</DataTableHeaderCell>
                  <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                  <DataTableHeaderCell>القيمة</DataTableHeaderCell>
                  <DataTableHeaderCell>تاريخ البدء</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {contracts.map((c) => (
                  <DataTableRow key={c.id}>
                    <DataTableCell className="font-medium">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="font-mono hover:text-cyan transition-colors"
                      >
                        {c.contract_code ?? "—"}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {c.type_label ?? "—"}
                    </DataTableCell>
                    <DataTableCell>{c.status}</DataTableCell>
                    <DataTableCell className="tabular-nums">
                      {formatCurrency(Number(c.total_value || 0))}
                    </DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatShortDate(c.start_date, locale)}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </DataTableShell>
        )}
      </div>

      <SectionTitle title={t("activityTitle")} />
      <EntityActivityFeed items={activity} />

      <EntityCommentComposer
        entityType="client"
        entityId={id}
        mentionable={mentionable}
        floating
      />
    </div>
  );
}
