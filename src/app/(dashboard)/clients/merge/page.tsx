import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getClientMergeData } from "@/lib/data/clients";
import { bestClientMatch } from "@/lib/match/client-match";
import { PageHeader } from "@/components/page-header";
import { MergeWorkspace, type SheetCandidate } from "./merge-workspace";

// Client de-duplication workbench. The team folds each sheet-imported client
// (which carries contracts + WhatsApp groups but no project) into its
// canonical Odoo client (which carries the delivery project). We pre-compute a
// best-name-match suggestion per sheet client server-side; the team confirms,
// overrides via search, or skips. Gated read on clients.view; merge on
// clients.manage.

export default async function ClientMergePage() {
  const session = await requirePagePermission("clients.view");
  const canManage = hasPermission(session, "clients.manage");

  const { sheetClients, odooClients } = await getClientMergeData(session.orgId);

  const candidates: SheetCandidate[] = sheetClients.map((s) => {
    const { best } = bestClientMatch(s, odooClients);
    const m = best ? odooClients.find((o) => o.id === best.client.id) ?? null : null;
    return {
      sheet: s,
      suggestion: best && best.score >= 0.6 ? m : null,
      score: best ? Math.round(best.score * 100) / 100 : 0,
    };
  });
  // Highest-confidence + most-linked first so the team clears the big ones.
  candidates.sort((a, b) => b.score - a.score);

  const odooOptions = odooClients.map((o) => ({
    value: o.id,
    label: o.projects > 0 ? `${o.name} · ${o.projects} مشروع` : o.name,
  }));

  return (
    <div>
      <PageHeader
        title="دمج العملاء المكررين"
        description="نفس الشركة موجودة مرتين — نسخة من الشيت (عقود + جروبات) ونسخة من Odoo (المشاريع). ادمج كل نسخة شيت في نسختها الرسمية ليتوحّد العميل."
      />
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-1 text-xs text-cyan hover:underline"
      >
        <ArrowRight className="size-3.5 rtl:rotate-180" />
        العملاء
      </Link>
      <MergeWorkspace
        candidates={candidates}
        odooOptions={odooOptions}
        odooById={Object.fromEntries(odooClients.map((o) => [o.id, o]))}
        canManage={canManage}
      />
    </div>
  );
}
