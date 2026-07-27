import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { riyadhTodayIso } from "@/lib/tz";

// =========================================================================
// Client finance badges — the two indicators the CEO wants beside ANY
// client mention (complaints, satisfaction, client lists): the client's
// target standing from the Acc sheet (`contracts.target`: On Target /
// Overdue / Sales Deposit) and whether they have unpaid installments past
// their expected date. One cached org-wide map per request so every
// surface can join by clientId without extra queries.
// =========================================================================

export type ClientTargetStatus = "on_target" | "overdue" | "sales_deposit" | null;

export interface ClientFinanceBadge {
  clientId: string;
  // From the client's current contract (active preferred, else latest).
  targetStatus: ClientTargetStatus;
  paymentStatus: "complete" | "installments" | null;
  // Across ALL the client's contracts: unpaid installments past due.
  overdueInstallments: number;
  overdueAmount: number;
  // Contract codes (e.g. C40-1) the overdue installments belong to —
  // provenance for any surface that shows overdueAmount as a number.
  overdueContractCodes: string[];
  // Unpaid installments still AHEAD of us inside the current Riyadh month —
  // "money we will collect this month", distinct from overdue (already late).
  monthDueInstallments: number;
  monthDueAmount: number;
  monthDueContractCodes: string[];
}

export type ClientFinanceMap = Record<string, ClientFinanceBadge>;

function normalizeTarget(raw: string | null): ClientTargetStatus {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "on target":
      return "on_target";
    case "overdue":
      return "overdue";
    case "sales deposit":
      return "sales_deposit";
    default:
      return null;
  }
}

function normalizePayment(raw: string | null): "complete" | "installments" | null {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "complete":
      return "complete";
    case "installments":
      return "installments";
    default:
      return null;
  }
}

async function _getClientFinanceMap(orgId: string): Promise<ClientFinanceMap> {
  // Riyadh calendar day — UTC "today" under-counts due/overdue around
  // midnight (see [[project_riyadh_today_timezone]]).
  const today = riyadhTodayIso();
  // Last day of the current Riyadh month, for the "collect this month" bucket.
  const [y, m] = today.split("-").map(Number);
  const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const [contractsRes, installmentsRes, mergeRes] = await Promise.all([
    supabaseAdmin
      .from("contracts")
      .select("id, client_id, contract_code, target, payment_status, status, start_date")
      .eq("organization_id", orgId)
      .not("client_id", "is", null),
    supabaseAdmin
      .from("installments")
      .select("contract_id, expected_amount, actual_amount, expected_date")
      .eq("organization_id", orgId)
      .lte("expected_date", monthEnd),
    // Twin→canonical map: a merged client's contracts sit on its sheet twin,
    // but every consuming surface (satisfaction cards, /clients) keys on the
    // canonical row. Fold contract client_id to canonical so the badge is
    // reachable there. Mirrors getClientIdentityIds. See
    // [[project_satisfaction_contract_bridge]].
    supabaseAdmin
      .from("clients")
      .select("id, merged_into_client_id")
      .eq("organization_id", orgId)
      .not("merged_into_client_id", "is", null),
  ]);

  if (contractsRes.error) {
    console.error("[clientFinance.contracts]", contractsRes.error.message);
    return {};
  }
  if (installmentsRes.error) {
    console.error("[clientFinance.installments]", installmentsRes.error.message);
  }

  type ContractRow = {
    id: string;
    client_id: string;
    contract_code: string | null;
    target: string | null;
    payment_status: string | null;
    status: string | null;
    start_date: string | null;
  };
  const contracts = (contractsRes.data ?? []) as ContractRow[];

  // Fold each contract's client_id up to its canonical row (one hop), so a
  // merged client's twin-attached contracts land on the id the UI keys on.
  const parentOf = new Map<string, string>();
  for (const r of (mergeRes.data ?? []) as Array<{ id: string; merged_into_client_id: string | null }>) {
    if (r.merged_into_client_id) parentOf.set(r.id, r.merged_into_client_id);
  }
  const canonicalOf = (id: string) => parentOf.get(id) ?? id;

  // Representative contract per client: active preferred, then latest start.
  const repByClient = new Map<string, ContractRow>();
  for (const c of contracts) {
    const key = canonicalOf(c.client_id);
    const cur = repByClient.get(key);
    if (!cur) {
      repByClient.set(key, c);
      continue;
    }
    const curActive = cur.status === "active";
    const newActive = c.status === "active";
    if (newActive !== curActive) {
      if (newActive) repByClient.set(key, c);
      continue;
    }
    if ((c.start_date ?? "") > (cur.start_date ?? "")) repByClient.set(key, c);
  }

  const clientByContract = new Map<string, string>();
  const codeByContract = new Map<string, string>();
  for (const c of contracts) {
    clientByContract.set(c.id, canonicalOf(c.client_id));
    if (c.contract_code) codeByContract.set(c.id, c.contract_code);
  }

  // Two buckets over the same unpaid installments: already LATE (expected
  // before today) vs still ahead inside the current month (collect now).
  type Agg = { n: number; amount: number; codes: Set<string> };
  const newAgg = (): Agg => ({ n: 0, amount: 0, codes: new Set<string>() });
  const overdueByClient = new Map<string, Agg>();
  const monthDueByClient = new Map<string, Agg>();
  for (const i of installmentsRes.data ?? []) {
    const actual = Number(i.actual_amount) || 0;
    if (actual > 0) continue; // paid
    const clientId = clientByContract.get(i.contract_id as string);
    if (!clientId) continue;
    const bucket = (i.expected_date as string) < today ? overdueByClient : monthDueByClient;
    const agg = bucket.get(clientId) ?? newAgg();
    agg.n += 1;
    agg.amount += Number(i.expected_amount) || 0;
    const code = codeByContract.get(i.contract_id as string);
    if (code) agg.codes.add(code);
    bucket.set(clientId, agg);
  }

  const map: ClientFinanceMap = {};
  for (const [clientId, rep] of repByClient) {
    const od = overdueByClient.get(clientId);
    const md = monthDueByClient.get(clientId);
    map[clientId] = {
      clientId,
      targetStatus: normalizeTarget(rep.target),
      paymentStatus: normalizePayment(rep.payment_status),
      overdueInstallments: od?.n ?? 0,
      overdueAmount: Math.round(od?.amount ?? 0),
      overdueContractCodes: [...(od?.codes ?? [])],
      monthDueInstallments: md?.n ?? 0,
      monthDueAmount: Math.round(md?.amount ?? 0),
      monthDueContractCodes: [...(md?.codes ?? [])],
    };
  }
  return map;
}

export const getClientFinanceMap = cache(_getClientFinanceMap);

export async function getClientFinanceBadge(
  orgId: string,
  clientId: string,
): Promise<ClientFinanceBadge | null> {
  const map = await getClientFinanceMap(orgId);
  return map[clientId] ?? null;
}

// The /clients page lists LIVE Odoo clients keyed by odoo id — re-key the
// finance map through clients.external_id (odoo importer, migration 0011).
async function _getClientFinanceMapByOdooId(orgId: string): Promise<ClientFinanceMap> {
  const [map, clientsRes] = await Promise.all([
    getClientFinanceMap(orgId),
    supabaseAdmin
      .from("clients")
      .select("id, external_id")
      .eq("organization_id", orgId)
      .eq("external_source", "odoo")
      .not("external_id", "is", null),
  ]);
  if (clientsRes.error) {
    console.error("[clientFinance.byOdooId]", clientsRes.error.message);
    return {};
  }
  const out: ClientFinanceMap = {};
  for (const c of clientsRes.data ?? []) {
    const badge = map[c.id as string];
    if (badge && c.external_id) out[String(c.external_id)] = badge;
  }
  return out;
}

export const getClientFinanceMapByOdooId = cache(_getClientFinanceMapByOdooId);
