import { FileSignature } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import {
  listContractsGrid,
  listContractTypes,
  listPackages,
  type GridContract,
} from "@/lib/data/contracts";
import { listAccountManagers } from "@/lib/data/employees";
import { listClientOptions } from "@/lib/data/clients";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ContractsGrid } from "./contracts-grid";
import { NewContractButton } from "./new-contract-dialog";

// Sheet-parity contracts page. Replaces the old paginated DataTable with a
// single sticky-header grid that mirrors the Skylight "Client's Contracts"
// sheet column-for-column. All filtering is client-side over the full
// dataset (capped at 1000 rows) so the team gets instant feedback on
// every chip/search keystroke. The 4-color row rule
// (NO=red, Hold=yellow, Closed=gray) lives in `contracts-grid.tsx` as
// derived CSS — no schema change needed.
//
// Source of truth: dashboard. The Google Sheet has been archived; all
// edits happen here. Inline-edit (Phase 3b) is gated on `contract.manage`;
// viewers with `contract.view` get the same grid in read-only mode.

export default async function ContractsPage() {
  const session = await requirePagePermission("contract.view");
  const canEdit = hasPermission(session, "contract.manage");

  const [rows, types, ams, packages, clients] = await Promise.all([
    listContractsGrid(session.orgId),
    listContractTypes(session.orgId),
    listAccountManagers(session.orgId),
    listPackages(session.orgId),
    listClientOptions(session.orgId),
  ]);

  const typeOptions = types.map((t) => ({
    id: t.id,
    key: t.key,
    label: t.name_ar,
  }));
  const amOptions = ams.map((a) => ({
    id: a.id,
    full_name: a.full_name,
  }));
  const packageOptions = packages.map((p) => ({
    id: p.id,
    name_ar: p.name_ar,
  }));
  const clientOptions = clients.map((c) => ({
    id: c.id,
    name: c.name,
    external_id: c.external_id,
  }));

  return (
    <div>
      <PageHeader
        title="العقود"
        description="المصدر الرسمي للعقود. السكاي شيت أصبح مؤرشفًا — كل التعديلات تتم هنا، وكل تغيير محفوظ في سجل المراجعة."
        actions={
          canEdit ? (
            <NewContractButton
              clients={clientOptions}
              packages={packageOptions}
              contractTypes={typeOptions}
              accountManagers={amOptions}
            />
          ) : null
        }
      />

      {(rows as GridContract[]).length === 0 ? (
        <EmptyState
          icon={<FileSignature className="size-6" />}
          title="لا توجد عقود بعد"
          description="ابدأ بإنشاء عقد جديد من زر «+ عقد جديد»."
        />
      ) : (
        <ContractsGrid
          rows={rows}
          meEmployeeId={session.employeeId ?? null}
          canEdit={canEdit}
          contractTypes={typeOptions}
          accountManagers={amOptions}
        />
      )}
    </div>
  );
}
