import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getClientMergeData, type MergeClient } from "@/lib/data/clients";
import { PageHeader } from "@/components/page-header";
import { MergeWorkspace, type SheetCandidate } from "./merge-workspace";

// Client de-duplication workbench. The team folds each sheet-imported client
// (which carries contracts + WhatsApp groups but no project) into its
// canonical Odoo client (which carries the delivery project). We pre-compute a
// best-name-match suggestion per sheet client server-side; the team confirms,
// overrides via search, or skips. Gated read on clients.view; merge on
// clients.manage.

// ---- Arabic-aware name matching (mirrors the contract/group matchers) ----
const AR_DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
function norm(s: string): string {
  let x = (s || "").trim().toLowerCase();
  x = x.replace(AR_DIAC, "").replace(/ـ/g, "");
  x = x.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  x = x.replace(/\(.*?\)/g, "").replace(/\s*[-–]\s*.*$/g, "");
  return x.replace(/[^\w\s؀-ۿ]/g, " ").replace(/\s+/g, " ").trim();
}
function latins(s: string): Set<string> {
  return new Set(
    (s.match(/[A-Za-z][A-Za-z0-9 .&\-]{2,}/g) ?? []).map((t) => t.trim().toLowerCase()),
  );
}
function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Simple Dice-coefficient on bigrams — cheap and good enough for a hint.
  const big = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = big(a), B = big(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size || 1);
}

function bestMatch(sheet: MergeClient, odoo: MergeClient[]) {
  const sn = norm(sheet.name);
  const sl = latins(sheet.name);
  let best: { client: MergeClient; score: number } | null = null;
  for (const o of odoo) {
    const on = norm(o.name);
    let score = ratio(sn, on);
    const ol = latins(o.name);
    for (const l of sl) if (ol.has(l)) score = Math.max(score, 0.95);
    if (!best || score > best.score) best = { client: o, score };
  }
  return best;
}

export default async function ClientMergePage() {
  const session = await requirePagePermission("clients.view");
  const canManage = hasPermission(session, "clients.manage");

  const { sheetClients, odooClients } = await getClientMergeData(session.orgId);

  const candidates: SheetCandidate[] = sheetClients.map((s) => {
    const m = bestMatch(s, odooClients);
    return {
      sheet: s,
      suggestion: m && m.score >= 0.6 ? m.client : null,
      score: m ? Math.round(m.score * 100) / 100 : 0,
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
