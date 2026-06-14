import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
  const today = new Date().toISOString().slice(0, 10);

  const [contractsRes, installmentsRes] = await Promise.all([
    supabaseAdmin
      .from("contracts")
      .select("id, client_id, target, payment_status, status, start_date")
      .eq("organization_id", orgId)
      .not("client_id", "is", null),
    supabaseAdmin
      .from("installments")
      .select("contract_id, expected_amount, actual_amount, expected_date")
      .eq("organization_id", orgId)
      .lt("expected_date", today),
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
    target: string | null;
    payment_status: string | null;
    status: string | null;
    start_date: string | null;
  };
  const contracts = (contractsRes.data ?? []) as ContractRow[];

  // Representative contract per client: active preferred, then latest start.
  const repByClient = new Map<string, ContractRow>();
  for (const c of contracts) {
    const cur = repByClient.get(c.client_id);
    if (!cur) {
      repByClient.set(c.client_id, c);
      continue;
    }
    const curActive = cur.status === "active";
    const newActive = c.status === "active";
    if (newActive !== curActive) {
      if (newActive) repByClient.set(c.client_id, c);
      continue;
    }
    if ((c.start_date ?? "") > (cur.start_date ?? "")) repByClient.set(c.client_id, c);
  }

  const clientByContract = new Map<string, string>();
  for (const c of contracts) clientByContract.set(c.id, c.client_id);

  const overdueByClient = new Map<string, { n: number; amount: number }>();
  for (const i of installmentsRes.data ?? []) {
    const actual = Number(i.actual_amount) || 0;
    if (actual > 0) continue; // paid
    const clientId = clientByContract.get(i.contract_id as string);
    if (!clientId) continue;
    const agg = overdueByClient.get(clientId) ?? { n: 0, amount: 0 };
    agg.n += 1;
    agg.amount += Number(i.expected_amount) || 0;
    overdueByClient.set(clientId, agg);
  }

  const map: ClientFinanceMap = {};
  for (const [clientId, rep] of repByClient) {
    const od = overdueByClient.get(clientId);
    map[clientId] = {
      clientId,
      targetStatus: normalizeTarget(rep.target),
      paymentStatus: normalizePayment(rep.payment_status),
      overdueInstallments: od?.n ?? 0,
      overdueAmount: Math.round(od?.amount ?? 0),
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
