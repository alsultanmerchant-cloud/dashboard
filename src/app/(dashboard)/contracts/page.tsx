import Link from "next/link";
import { FileSignature } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listContracts, getContractsSummary } from "@/lib/data/contracts";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicShortDate } from "@/lib/utils-format";

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  hold: "مُعلَّق",
  lost: "مفقود",
  closed: "مغلق",
  renewed: "مُجدَّد",
};

const TARGET_LABEL: Record<string, string> = {
  "On-Target": "ضمن الهدف",
  Overdue: "متأخر",
  Lost: "مفقود",
  Renewed: "مُجدَّد",
};

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(value);
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePagePermission("contract.view");
  const sp = await searchParams;
  // `am=me` resolves to the caller's employee_id (only AMs/team_leads with
  // an employee profile can use it). Lets a head/admin cycle between "كل
  // العقود" and "عقودي". RLS in 0028 already enforces the per-AM scope at
  // the DB layer for non-privileged callers — this is the UI knob.
  const amParam = typeof sp.am === "string" ? sp.am : undefined;
  const isMine = amParam === "me" && !!session.employeeId;
  const filters = {
    status: typeof sp.status === "string" ? sp.status : undefined,
    target: typeof sp.target === "string" ? sp.target : undefined,
    amEmployeeId: isMine ? session.employeeId : amParam,
    startFrom: typeof sp.from === "string" ? sp.from : undefined,
    startTo: typeof sp.to === "string" ? sp.to : undefined,
  };

  const [contracts, summary] = await Promise.all([
    listContracts(session.orgId, filters),
    getContractsSummary(session.orgId),
  ]);

  return (
    <div>
      <PageHeader
        title="العقود"
        description="كل العقود التجارية مع الحالة، المُسوّق المسؤول، الباقة، والقيمة المتبقّية."
        actions={
          <Link
            href="/contracts/import"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 transition-colors"
          >
            استيراد من Excel
          </Link>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="إجمالي العقود" value={summary.count} icon={<FileSignature className="size-5" />} tone="default" />
        <MetricCard label="نشط" value={summary.active} tone="info" />
        <MetricCard label="القيمة الإجمالية" value={formatCurrency(summary.totalValue)} tone="default" />
        <MetricCard label="المتبقّي" value={formatCurrency(summary.outstanding)} tone="warning" />
      </div>

      {/* Filters (link-based for now; richer client-form in a follow-up) */}
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {session.employeeId && (
          <FilterChip href="/contracts?am=me" label="عقودي" active={isMine} />
        )}
        <FilterChip href="/contracts" label="الكل" active={!filters.status && !filters.target && !isMine} />
        <FilterChip href="/contracts?status=active" label="نشط" active={filters.status === "active"} />
        <FilterChip href="/contracts?status=hold" label="مُعلَّق" active={filters.status === "hold"} />
        <FilterChip href="/contracts?target=Overdue" label="متأخر" active={filters.target === "Overdue"} />
        <FilterChip href="/contracts?status=renewed" label="مُجدَّد" active={filters.status === "renewed"} />
      </div>

      {contracts.length === 0 ? (
        <EmptyState
          icon={<FileSignature className="size-6" />}
          title="لا توجد عقود بعد"
          description="بمجرد استيراد ورقة Acc-Sheet ستظهر هنا كل عقود الوكالة مع الدفعات ودورات المتابعة."
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>المسوّق</DataTableHeaderCell>
                <DataTableHeaderCell>النوع</DataTableHeaderCell>
                <DataTableHeaderCell>الباقة</DataTableHeaderCell>
                <DataTableHeaderCell>تاريخ البدء</DataTableHeaderCell>
                <DataTableHeaderCell>المدة</DataTableHeaderCell>
                <DataTableHeaderCell>القيمة</DataTableHeaderCell>
                <DataTableHeaderCell>المدفوع</DataTableHeaderCell>
                <DataTableHeaderCell>الهدف</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {contracts.map((c: Record<string, unknown>) => {
                const client = c.client as { id?: string; name?: string } | null;
                const am = c.am as { full_name?: string } | null;
                const type = c.type as { name_ar?: string } | null;
                const pkg = c.package as { name_ar?: string } | null;
                return (
                  <DataTableRow key={c.id as string}>
                    <DataTableCell className="font-medium">
                      <Link href={`/contracts/${c.id as string}`} className="hover:underline">
                        {client?.name ?? "—"}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">{am?.full_name ?? "—"}</DataTableCell>
                    <DataTableCell>{type?.name_ar ?? "—"}</DataTableCell>
                    <DataTableCell>{pkg?.name_ar ?? "—"}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {formatArabicShortDate(c.start_date as string)}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">
                      {(c.duration_months as number) ?? "—"}
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{formatCurrency(Number(c.total_value))}</DataTableCell>
                    <DataTableCell className="tabular-nums">{formatCurrency(Number(c.paid_value))}</DataTableCell>
                    <DataTableCell>{TARGET_LABEL[c.target as string] ?? (c.target as string)}</DataTableCell>
                    <DataTableCell>{STATUS_LABEL[c.status as string] ?? (c.status as string)}</DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={
        "rounded-full border px-3 py-1 text-xs " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:bg-accent")
      }
    >
      {label}
    </Link>
  );
}
