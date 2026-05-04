import Link from "next/link";
import { UserSearch, Phone, Mail, Clock } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { listLeadsPaged } from "@/lib/data/leads";
import { Pagination } from "@/components/pagination";
import {
  LEAD_STATUSES, LEAD_STATUS_LABEL, type LeadStatus,
} from "@/lib/data/lead-statuses";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicShortDate, relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import { NewLeadDialog } from "../new-lead-dialog";

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(n);

const STATUS_BADGE: Record<LeadStatus, string> = {
  new: "border-cyan/40 bg-cyan-dim text-cyan",
  contacted: "border-cc-blue/40 bg-blue-dim text-cc-blue",
  qualified: "border-cc-purple/40 bg-purple-dim text-cc-purple",
  proposal: "border-amber/40 bg-amber-dim text-amber",
  won: "border-cc-green/40 bg-green-dim text-cc-green",
  lost: "border-cc-red/40 bg-red-dim text-cc-red",
};

const FILTERS = [
  { key: "open", label: "مفتوحة" },
  { key: "all", label: "الكل" },
  ...LEAD_STATUSES.map((s) => ({ key: s, label: LEAD_STATUS_LABEL[s] })),
] as const;

const PAGE_SIZE = 25;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const session = await requirePagePermission("sales.view");
  const canManage = hasPermission(session, "sales.manage");
  const sp = await searchParams;

  const filter = (sp.filter ?? "open") as (typeof FILTERS)[number]["key"];
  const statusOpt: "open" | LeadStatus | undefined =
    filter === "all"
      ? undefined
      : filter === "open"
        ? "open"
        : (filter as LeadStatus);

  const page = Math.max(1, Number(sp.page) || 1);
  const { rows: leads, total } = await listLeadsPaged(session.orgId, {
    status: statusOpt,
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="العملاء المحتملون"
        description="قائمة كل العملاء المحتملين مع المرحلة، المصدر، والقيمة التقديرية."
        actions={canManage ? <NewLeadDialog /> : undefined}
      />

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-card/60 px-3 py-2.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/sales/leads?filter=${f.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-cyan/30 bg-cyan-dim text-cyan"
                : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">
          {total} عميل محتمل
        </span>
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={<UserSearch className="size-6" />}
          title="لا توجد عملاء محتملون"
          description="لا توجد عملاء يطابقون هذا الفلتر حالياً."
          action={canManage ? <NewLeadDialog /> : undefined}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>التواصل</DataTableHeaderCell>
                <DataTableHeaderCell>المرحلة</DataTableHeaderCell>
                <DataTableHeaderCell>المصدر</DataTableHeaderCell>
                <DataTableHeaderCell>القيمة</DataTableHeaderCell>
                <DataTableHeaderCell>الخطوة التالية</DataTableHeaderCell>
                <DataTableHeaderCell>منذ</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {leads.map((l) => (
                <DataTableRow key={l.id}>
                  <DataTableCell className="font-medium">
                    <div>{l.name}</div>
                    {l.contact_name && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {l.contact_name}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    <div className="flex flex-col gap-1 text-xs">
                      {l.phone && (
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <Phone className="size-3" /> {l.phone}
                        </span>
                      )}
                      {l.email && (
                        <span className="inline-flex items-center gap-1.5" dir="ltr">
                          <Mail className="size-3" /> {l.email}
                        </span>
                      )}
                      {!l.phone && !l.email && "—"}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        STATUS_BADGE[l.status],
                      )}
                    >
                      {LEAD_STATUS_LABEL[l.status]}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {l.source ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums">
                    {l.estimated_value > 0 ? sar(l.estimated_value) : "—"}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground" dir="ltr">
                    {l.next_step_at ? formatArabicShortDate(l.next_step_at) : "—"}
                  </DataTableCell>
                  <DataTableCell className="text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {relativeTimeAr(l.created_at)}
                    </span>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}

      {leads.length > 0 && (
        <Pagination
          total={total}
          pageSize={PAGE_SIZE}
          currentPage={page}
        />
      )}
    </div>
  );
}
