import "server-only";
import { cache } from "react";
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

export async function listContractsPaged(
  orgId: string,
  filters: ContractListFilters = {},
  paging: { page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.max(1, Math.min(100, paging.pageSize ?? 25));
  const page = Math.max(1, paging.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabaseAdmin
    .from("contracts")
    .select(
      `id, start_date, end_date, total_value, paid_value, target, status, duration_months,
       client:clients(id, name),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types(id, key, name_ar),
       package:packages(id, key, name_ar)`,
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .order("start_date", { ascending: false })
    .range(from, to);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.target) q = q.eq("target", filters.target);
  if (filters.amEmployeeId) q = q.eq("account_manager_id", filters.amEmployeeId);
  if (filters.startFrom) q = q.gte("start_date", filters.startFrom);
  if (filters.startTo) q = q.lte("start_date", filters.startTo);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

// ---------------------------------------------------------------------------
// Monthly target engine readers (the CEO dashboard + per-AM breakdown).
// Past months are frozen (source='sheet_import' or 'computed_frozen') and
// returned as-is; the current month is recomputed live via the RPC before
// reading so the numbers are always fresh until the month-end freeze cron
// locks them.
// ---------------------------------------------------------------------------

export type MonthlyDashboard = {
  month: string;
  expected_renewals: number;
  expected_installments: number;
  total_expected: number;
  actual_renewals: number;
  actual_installments: number;
  total_actual: number;
  achievement_pct: number;
  mov_new: number;
  mov_renewed: number;
  mov_lost: number;
  mov_upsell: number;
  mov_winback: number;
  mov_closed: number;
  mov_hold: number;
  cnt_total_clients: number;
  cnt_on_target: number;
  cnt_overdue: number;
  cnt_sales_deposit: number;
  is_frozen: boolean;
  source: string;
};

function monthStartIso(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Returns the dashboard totals for a month. If the month is NOT frozen
 * (current/future), recomputes live first so the figures are fresh.
 */
export async function getMonthlyDashboard(
  orgId: string,
  monthIso?: string,
): Promise<MonthlyDashboard | null> {
  const month = monthIso ?? monthStartIso(new Date());

  // Recompute live (the RPC is a no-op for frozen months).
  await supabaseAdmin.rpc("compute_monthly_dashboard", {
    p_org: orgId,
    p_month: month,
  });

  const { data, error } = await supabaseAdmin
    .from("monthly_dashboard_totals")
    .select("*")
    .eq("organization_id", orgId)
    .eq("month", month)
    .maybeSingle();
  if (error) throw error;
  return (data as MonthlyDashboard) ?? null;
}

/** All months we have totals for, newest first — for the month picker. */
export async function listDashboardMonths(orgId: string): Promise<
  Array<{ month: string; is_frozen: boolean; source: string }>
> {
  const { data, error } = await supabaseAdmin
    .from("monthly_dashboard_totals")
    .select("month, is_frozen, source")
    .eq("organization_id", orgId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type AmTargetRow = {
  account_manager_id: string;
  account_manager_name: string | null;
  expected_total: number;
  achieved_total: number;
  achievement_pct: number;
  breakdown: {
    expected_renewals?: number;
    expected_installments?: number;
    achieved_renewals?: number;
    achieved_installments?: number;
  } | null;
};

/** Per-AM target rollup for a month. Recomputes live for non-frozen months. */
export async function getAmTargets(
  orgId: string,
  monthIso?: string,
): Promise<AmTargetRow[]> {
  const month = monthIso ?? monthStartIso(new Date());

  // Only recompute when the month isn't frozen.
  const { data: mdt } = await supabaseAdmin
    .from("monthly_dashboard_totals")
    .select("is_frozen")
    .eq("organization_id", orgId)
    .eq("month", month)
    .maybeSingle();
  if (!mdt?.is_frozen) {
    await supabaseAdmin.rpc("compute_am_monthly_targets", {
      p_org: orgId,
      p_month: month,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("am_targets")
    .select(
      `account_manager_id, expected_total, achieved_total, achievement_pct, breakdown_json,
       am:employee_profiles!am_targets_account_manager_id_fkey(full_name)`,
    )
    .eq("organization_id", orgId)
    .eq("month", month)
    .order("expected_total", { ascending: false });
  if (error) throw error;

  type Row = {
    account_manager_id: string;
    expected_total: number | string;
    achieved_total: number | string;
    achievement_pct: number | string;
    breakdown_json: AmTargetRow["breakdown"];
    am: { full_name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    account_manager_id: r.account_manager_id,
    account_manager_name: r.am?.full_name ?? null,
    expected_total: Number(r.expected_total),
    achieved_total: Number(r.achieved_total),
    achievement_pct: Number(r.achievement_pct),
    breakdown: r.breakdown_json,
  }));
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

/**
 * Sheet-parity grid fetcher.
 *
 * Pulls every column the Skylight "Client's Contracts" sheet exposes so the
 * new editable grid can render identically (4-color row rule, sticky
 * dropdowns, multi-package chips). Single round-trip with PostgREST embeds:
 * contract row + client + AM + type + (primary) package + all linked
 * packages from the junction. Sorted to match the team's sheet (newest
 * Client ID first; client numeric on prefix).
 *
 * Returned shape is intentionally flat so the client component can do its
 * own filtering/grouping without re-deriving from nested rows.
 */
export type GridContract = {
  id: string;
  external_id: string | null;
  client_id: string;
  client_name: string | null;
  client_external_id: string | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  contract_type_key: string | null;
  contract_type_label: string | null;
  primary_package_name: string | null;
  package_names: string[];
  start_date: string;
  end_date: string | null;
  actual_end_date: string | null;
  duration_months: number | null;
  total_value: number;
  paid_value: number;
  next_contract_value: number | null;
  renewal_paid_value: number | null;
  repeated_services_value: number | null;
  payment_status: string | null;
  target: string;
  status: string;
  contract_status_label: string | null;
  renewed_status: string | null;
  extension_days: number | null;
  delay_days: number | null;
  total_days_computed: number | null;
  notes: string | null;
};

export async function listContractsGrid(
  orgId: string,
  filters: ContractListFilters = {},
): Promise<GridContract[]> {
  let q = supabaseAdmin
    .from("contracts")
    .select(
      `id, external_id, start_date, end_date, actual_end_date, duration_months,
       total_value, paid_value, next_contract_value, renewal_paid_value,
       repeated_services_value, payment_status, target, status,
       contract_status_label, renewed_status, extension_days, delay_days,
       total_days_computed, notes, account_manager_id, account_manager_name,
       client:clients(id, name, external_id),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types(key, name_ar),
       package:packages!contracts_package_id_fkey(name_ar),
       packages:contract_packages(sort_order, package:packages(name_ar))`,
    )
    .eq("organization_id", orgId)
    .order("start_date", { ascending: false })
    .limit(1000);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.target) q = q.eq("target", filters.target);
  if (filters.amEmployeeId) q = q.eq("account_manager_id", filters.amEmployeeId);
  if (filters.startFrom) q = q.gte("start_date", filters.startFrom);
  if (filters.startTo) q = q.lte("start_date", filters.startTo);

  const { data, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    external_id: string | null;
    start_date: string;
    end_date: string | null;
    actual_end_date: string | null;
    duration_months: number | null;
    total_value: number | string | null;
    paid_value: number | string | null;
    next_contract_value: number | string | null;
    renewal_paid_value: number | string | null;
    repeated_services_value: number | string | null;
    payment_status: string | null;
    target: string;
    status: string;
    contract_status_label: string | null;
    renewed_status: string | null;
    extension_days: number | null;
    delay_days: number | null;
    total_days_computed: number | null;
    notes: string | null;
    account_manager_id: string | null;
    account_manager_name: string | null;
    client: { id: string; name: string | null; external_id: string | null } | null;
    am: { id: string; full_name: string } | null;
    type: { key: string; name_ar: string } | null;
    package: { name_ar: string } | null;
    packages: Array<{ sort_order: number; package: { name_ar: string } | null }>;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const pkgs = [...(r.packages ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => p.package?.name_ar)
      .filter((x): x is string => !!x);
    return {
      id: r.id,
      external_id: r.external_id,
      client_id: r.client?.id ?? "",
      client_name: r.client?.name ?? null,
      client_external_id: r.client?.external_id ?? null,
      account_manager_id: r.account_manager_id,
      // Prefer the resolved employee name; fall back to the raw string when
      // the AM couldn't be matched (1 contract today: مدى الجميري).
      account_manager_name: r.am?.full_name ?? r.account_manager_name,
      contract_type_key: r.type?.key ?? null,
      contract_type_label: r.type?.name_ar ?? null,
      primary_package_name: r.package?.name_ar ?? null,
      package_names: pkgs,
      start_date: r.start_date,
      end_date: r.end_date,
      actual_end_date: r.actual_end_date,
      duration_months: r.duration_months,
      total_value: Number(r.total_value ?? 0),
      paid_value: Number(r.paid_value ?? 0),
      next_contract_value:
        r.next_contract_value == null ? null : Number(r.next_contract_value),
      renewal_paid_value:
        r.renewal_paid_value == null ? null : Number(r.renewal_paid_value),
      repeated_services_value:
        r.repeated_services_value == null
          ? null
          : Number(r.repeated_services_value),
      payment_status: r.payment_status,
      target: r.target,
      status: r.status,
      contract_status_label: r.contract_status_label,
      renewed_status: r.renewed_status,
      extension_days: r.extension_days,
      delay_days: r.delay_days,
      total_days_computed: r.total_days_computed,
      notes: r.notes,
    };
  });
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

export const getCeoCommercialTiles = cache(_getCeoCommercialTiles);
async function _getCeoCommercialTiles(orgId: string, monthIso?: string) {
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
