import Link from "next/link";
import { FileSignature } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listContractsGrid, type GridContract } from "@/lib/data/contracts";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ContractsGrid } from "./contracts-grid";

// Sheet-parity contracts page. Replaces the old paginated DataTable with a
// single sticky-header grid that mirrors the Skylight "Client's Contracts"
// sheet column-for-column. All filtering is client-side over the full
// dataset (capped at 1000 rows — currently 197) so the team gets instant
// feedback on every chip/search keystroke. The 4-color row rule
// (NO=red, Hold=yellow, Closed=gray) lives in `contracts-grid.tsx` as
// derived CSS, no schema change needed.

export default async function ContractsPage() {
  const session = await requirePagePermission("contract.view");
  const rows: GridContract[] = await listContractsGrid(session.orgId);

  return (
    <div>
      <PageHeader
        title="العقود"
        description="كل العقود التجارية مع الحالة، المُسوّق المسؤول، الباقة، والقيمة المتبقّية — بنفس ترتيب وألوان شيت سكاي لايت."
        actions={
          <Link
            href="/contracts/import"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan-dim px-3 text-xs font-medium text-cyan hover:bg-cyan-dim/80 transition-colors"
          >
            استيراد من Excel
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileSignature className="size-6" />}
          title="لا توجد عقود بعد"
          description="بمجرد استيراد ورقة Acc-Sheet ستظهر هنا كل عقود الوكالة مع الدفعات ودورات المتابعة."
        />
      ) : (
        <ContractsGrid rows={rows} meEmployeeId={session.employeeId ?? null} />
      )}
    </div>
  );
}
