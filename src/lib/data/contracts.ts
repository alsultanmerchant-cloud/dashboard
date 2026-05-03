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

// ---------------------------------------------------------------------------
// T7.5-finish — detail loaders + per-AM dashboard + CEO commercial tiles.
// All read through supabaseAdmin and do an explicit org-scope check, mirroring
// the rest of the data layer. RLS policies (0026b + 0028) are enforced when
// the caller eventually moves to a user-scoped client.
// ---------------------------------------------------------------------------

export async function getContractById(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select(
      `id, organization_id, start_date, end_date, duration_months,
       total_value, paid_value, target, status, notes,
       project_id, account_manager_id, contract_type_id, package_id,
       client:clients(id, name),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types(id, key, name_ar),
       package:packages(id, key, name_ar, grace_days),
       project:projects(id, name)`,
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getContractInstallments(orgId: string, contractId: string) {
  const { data, error } = await supabaseAdmin
    .from("installments")
    .select(
      "id, sequence, expected_date, expected_amount, actual_date, actual_amount, status",
    )
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .order("sequence");
  if (error) throw error;
  return data ?? [];
}

export async function getContractCycles(orgId: string, contractId: string) {
  const { data, error } = await supabaseAdmin
    .from("monthly_cycles")
    .select(
      `id, cycle_no, month, state, start_date, grace_days,
       expected_meeting_date, actual_meeting_date,
       meeting_status, meeting_delay_days,
       expected_cycle_add_date, actual_cycle_add_date`,
    )
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getContractEvents(
  orgId: string,
  contractId: string,
  limit = 50,
) {
  const { data, error } = await supabaseAdmin
    .from("contract_events")
    .select(
      `id, event_type, occurred_at, payload,
       actor:employee_profiles!contract_events_actor_id_fkey(id, full_name)`,
    )
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

function monthBoundsUtc(reference: Date) {
  const y = reference.getUTCFullYear();
  const m = reference.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { first, last };
}

export async function getAmDashboard(employeeId: string, monthIso?: string) {
  // monthIso = YYYY-MM-01. Defaults to current month.
  const ref = monthIso ? new Date(`${monthIso}T00:00:00.000Z`) : new Date();
  const { first, last } = monthBoundsUtc(ref);
  const monthStart = first;

  const [{ data: target }, { data: contracts }, { data: overdue }, { data: cyclesThisWeek }] =
    await Promise.all([
      supabaseAdmin
        .from("am_targets")
        .select(
          "expected_total, achieved_total, achievement_pct, breakdown_json, month",
        )
        .eq("account_manager_id", employeeId)
        .eq("month", monthStart)
        .maybeSingle(),
      supabaseAdmin
        .from("contracts")
        .select(
          `id, start_date, total_value, paid_value, status, target,
           type:contract_types(key, name_ar),
           client:clients(id, name)`,
        )
        .eq("account_manager_id", employeeId)
        .gte("start_date", first)
        .lte("start_date", last),
      supabaseAdmin
        .from("installments")
        .select(
          `id, expected_date, expected_amount, status,
           contract:contracts!inner(id, account_manager_id, client:clients(id, name))`,
        )
        .eq("contract.account_manager_id", employeeId)
        .in("status", ["pending", "overdue"])
        .lte("expected_date", new Date().toISOString().slice(0, 10))
        .order("expected_date")
        .limit(50),
      supabaseAdmin
        .from("monthly_cycles")
        .select(
          `id, cycle_no, month, expected_meeting_date, state,
           contract:contracts!inner(id, account_manager_id, client:clients(id, name))`,
        )
        .eq("contract.account_manager_id", employeeId)
        .gte("expected_meeting_date", new Date().toISOString().slice(0, 10))
        .lte(
          "expected_meeting_date",
          new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
        )
        .order("expected_meeting_date")
        .limit(50),
    ]);

  const rows = contracts ?? [];
  const byType: Record<string, { count: number; value: number }> = {};
  for (const c of rows as Array<Record<string, unknown>>) {
    const t = c.type as { key?: string; name_ar?: string } | null;
    const key = t?.key ?? "—";
    byType[key] = byType[key] ?? { count: 0, value: 0 };
    byType[key].count += 1;
    byType[key].value += Number(c.total_value || 0);
  }

  return {
    month: monthStart,
    target: target ?? null,
    contracts: rows,
    contractsByType: byType,
    overdueInstallments: overdue ?? [],
    cyclesNeedingMeetingThisWeek: cyclesThisWeek ?? [],
  };
}

export async function getCeoCommercialTiles(orgId: string, monthIso?: string) {
  const ref = monthIso ? new Date(`${monthIso}T00:00:00.000Z`) : new Date();
  const { first, last } = monthBoundsUtc(ref);

  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select(
      `total_value, status,
       type:contract_types(key)`,
    )
    .eq("organization_id", orgId)
    .gte("start_date", first)
    .lte("start_date", last);
  if (error) throw error;

  const byType: Record<string, { count: number; value: number }> = {
    New: { count: 0, value: 0 },
    Renew: { count: 0, value: 0 },
    Hold: { count: 0, value: 0 },
    UPSELL: { count: 0, value: 0 },
    WinBack: { count: 0, value: 0 },
  };
  let totalCount = 0;
  let totalValue = 0;
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const t = r.type as { key?: string } | null;
    const key = t?.key ?? "—";
    if (!byType[key]) byType[key] = { count: 0, value: 0 };
    byType[key].count += 1;
    byType[key].value += Number(r.total_value || 0);
    totalCount += 1;
    totalValue += Number(r.total_value || 0);
  }
  return { month: first, byType, totalCount, totalValue };
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
