import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ContractRow = {
  id: string;
  organization_id: string;
  client_id: string;
  account_manager_id: string | null;
  contract_type_id: string | null;
  package_id: string | null;
  project_id: string | null;
  start_date: string;
  end_date: string | null;
  duration_months: number | null;
  total_value: number;
  paid_value: number;
  target: "On-Target" | "Overdue" | "Lost" | "Renewed";
  status: "active" | "hold" | "lost" | "closed" | "renewed";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractListFilters = {
  status?: string;
  target?: string;
  contractTypeKey?: string;
  packageKey?: string;
  amEmployeeId?: string;
  startFrom?: string;
  startTo?: string;
};

export async function listContracts(orgId: string, filters: ContractListFilters = {}) {
  let q = supabaseAdmin
    .from("contracts")
    .select(
      `id, start_date, end_date, total_value, paid_value, target, status, duration_months,
       client:clients(id, name),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types(id, key, name_ar),
       package:packages(id, key, name_ar)`,
    )
    .eq("organization_id", orgId)
    .order("start_date", { ascending: false })
    .limit(500);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.target) q = q.eq("target", filters.target);
  if (filters.amEmployeeId) q = q.eq("account_manager_id", filters.amEmployeeId);
  if (filters.startFrom) q = q.gte("start_date", filters.startFrom);
  if (filters.startTo) q = q.lte("start_date", filters.startTo);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listContractTypes(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("contract_types")
    .select("id, key, name_ar, sort_order")
    .eq("organization_id", orgId)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function listPackages(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("packages")
    .select("id, key, name_ar, included_service_ids, grace_days, active")
    .eq("organization_id", orgId)
    .eq("active", true)
    .order("name_ar");
  if (error) throw error;
  return data ?? [];
}

export async function getContractsSummary(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select("status, target, total_value, paid_value")
    .eq("organization_id", orgId);
  if (error) throw error;
  const rows = data ?? [];
  const totalValue = rows.reduce((s, r) => s + Number(r.total_value || 0), 0);
  const paidValue = rows.reduce((s, r) => s + Number(r.paid_value || 0), 0);
  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    count: rows.length,
    totalValue,
    paidValue,
    outstanding: totalValue - paidValue,
    active: byStatus.active ?? 0,
    hold: byStatus.hold ?? 0,
    lost: byStatus.lost ?? 0,
    renewed: byStatus.renewed ?? 0,
  };
}
