import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

function splitPackageNames(packageName: string | null | undefined): string[] {
  if (!packageName) return [];
  const seen = new Set<string>();
  return packageName
    .split(/[,،]/)
    .map((p) => p.trim())
    .filter((p) => p !== "#")
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
}

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

export type SheetLog = {
  id: string;
  contract_key: string;
  contract_id: string | null;
  client_external_id: string | null;
  client_name: string | null;
  account_manager: string | null;
  log_type: string;
  log_time: string | null;
  notes: string | null;
  snapshot: Record<string, unknown>;
};

export type SheetLogFilters = {
  logTypes?: string[];
  accountManager?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
};

export async function listContracts(orgId: string, filters: ContractListFilters = {}) {
  let q = supabaseAdmin
    .from("contracts")
    .select(
      `id, start_date, end_date, total_value, paid_value, target, status, duration_months,
       client:clients(id, name),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types!contracts_contract_type_id_fkey(id, key, name_ar),
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
       type:contract_types!contracts_contract_type_id_fkey(id, key, name_ar),
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
  cnt_roster_new: number;
  cnt_roster_renew: number;
  cnt_roster_hold: number;
  cnt_roster_upsell: number;
  cnt_roster_winback: number;
  cnt_on_target: number;
  cnt_overdue: number;
  cnt_sales_deposit: number;
  // Account department (sheet "Account M. section") — 0168
  acc_exp_overdue_inst: number;
  acc_exp_inst: number;
  acc_exp_ontarget: number;
  acc_exp_overdue_clients: number;
  acc_expected: number;
  acc_act_inst: number;
  acc_act_ontarget: number;
  acc_act_overdue_clients: number;
  acc_act_sd_renewed: number;
  acc_upsell: number;
  acc_winback: number;
  acc_actual: number;
  acc_achievement_pct: number;
  acc_gap: number;
  // Sales department (sheet "Sales section") — 0168
  sales_exp_overdue_inst: number;
  sales_exp_inst: number;
  sales_expected: number;
  sales_act_inst: number;
  sales_upsell: number;
  sales_new_income: number;
  sales_total_income: number;
  sales_gap: number;
  sales_achievement_pct: number;
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

/**
 * Live, month-INDEPENDENT snapshot of the current client roster by contract
 * type. Powers the top "current client status" strip on the CEO dashboard —
 * mirrors the sheet's general overview, which tracks the live roster, not the
 * selected month. "Current client" = status not in ('closed','lost').
 */
export type ContractsRoster = {
  total: number;
  cnt_new: number;
  cnt_renew: number;
  cnt_upsell: number;
  cnt_winback: number;
  cnt_hold: number;
  cnt_switch: number;
  cnt_untyped: number;
};

export async function getContractsRoster(
  orgId: string,
): Promise<ContractsRoster> {
  const { data, error } = await supabaseAdmin
    .rpc("get_contracts_roster", { p_org: orgId })
    .maybeSingle();
  if (error) throw error;
  return (
    (data as ContractsRoster) ?? {
      total: 0,
      cnt_new: 0,
      cnt_renew: 0,
      cnt_upsell: 0,
      cnt_winback: 0,
      cnt_hold: 0,
      cnt_switch: 0,
      cnt_untyped: 0,
    }
  );
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
  // Team rollup (sheet TEAM_TARGET) — set only for team leaders / dept manager.
  team_expected: number | null;
  team_achieved: number | null;
  team_role: "team_lead" | "dept_manager" | null;
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
      `account_manager_id, expected_total, achieved_total, achievement_pct,
       team_expected, team_achieved, team_role, breakdown_json,
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
    team_expected: number | string | null;
    team_achieved: number | string | null;
    team_role: "team_lead" | "dept_manager" | null;
    breakdown_json: AmTargetRow["breakdown"];
    am: { full_name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    account_manager_id: r.account_manager_id,
    account_manager_name: r.am?.full_name ?? null,
    expected_total: Number(r.expected_total),
    achieved_total: Number(r.achieved_total),
    achievement_pct: Number(r.achievement_pct),
    team_expected: r.team_expected == null ? null : Number(r.team_expected),
    team_achieved: r.team_achieved == null ? null : Number(r.team_achieved),
    team_role: r.team_role,
    breakdown: r.breakdown_json,
  }));
}

// ---------------------------------------------------------------------------
// Per-client target breakdown (the sheet's Acc_Target_Breakdown tab).
// For a given month, lists which clients fall into each bucket — On-Target,
// Overdue, Renewed, Lost — plus the installments due that month. This is the
// CEO drill-down behind the dashboard aggregate numbers.
// ---------------------------------------------------------------------------

export type BucketClient = {
  contract_id: string;
  client_name: string | null;
  client_code: string | null;
  account_manager_name: string | null;
  value: number;
};
export type InstallmentDue = {
  contract_id: string;
  client_name: string | null;
  account_manager_name: string | null;
  expected_amount: number;
  status: string;
  // Contract type recorded on the installment row (col D of the tracker).
  // Drives the collecting DEPARTMENT: 'New' → Sales; Renew/WinBack/UPSELL →
  // Account. Null on a handful of legacy rows.
  source_type_key: string | null;
};
export type MonthBuckets = {
  on_target: BucketClient[];
  overdue: BucketClient[];
  renewed: BucketClient[];
  lost: BucketClient[];
  installments_due: InstallmentDue[];
  // Overdue installments per collecting department, mirrored verbatim from the
  // sheet's "Clients with Installments" lists (TARGET_CONTRACTS). Account rows
  // carry an amount; Sales rows are name-only (value 0).
  acc_inst_overdue: BucketClient[];
  sales_inst_overdue: BucketClient[];
  // True when the per-client lists come from the frozen monthly_target_snapshot.
  // False = a LIVE recompute (current month, or a frozen month captured before a
  // snapshot existed). For a frozen month, false means the lists have drifted vs
  // the sheet (contracts renewed → end_date moved) and shouldn't be trusted — the
  // dashboard hides them and asks for a fresh sheet pull.
  from_snapshot: boolean;
};

export type CeoClientInsight = {
  client_id: string;
  client_name: string | null;
  client_code: string | null;
  account_manager_name: string | null;
  active_contracts: number;
  total_contract_value: number;
  month_expected: number;
  month_collected: number;
  overdue_installments: number;
  renewal_value_due: number;
  next_renewal_date: string | null;
  satisfaction_score: number | null;
  sentiment: string | null;
  satisfaction_summary: string | null;
  top_risk: string | null;
  open_task_count: number;
  overdue_task_count: number;
  on_time_pct_30d: number | null;
  health_score: number;
  health_label: "healthy" | "watch" | "risk";
};

export async function getMonthTargetBuckets(
  orgId: string,
  monthIso?: string,
): Promise<MonthBuckets> {
  const month = monthIso ?? monthStartIso(new Date());
  const start = month;
  const endDate = new Date(
    Date.UTC(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      0,
    ),
  )
    .toISOString()
    .slice(0, 10);

  const on_target: BucketClient[] = [];
  const overdue: BucketClient[] = [];
  const renewed: BucketClient[] = [];
  const lost: BucketClient[] = [];
  const acc_inst_overdue: BucketClient[] = [];
  const sales_inst_overdue: BucketClient[] = [];

  type BucketRow = {
    bucket: string;
    contract_id: string;
    client_name: string | null;
    client_code: string | null;
    account_manager_name: string | null;
    value: number | string | null;
  };
  const place = (r: BucketRow) => {
    const row: BucketClient = {
      contract_id: r.contract_id,
      client_name: r.client_name,
      client_code: r.client_code,
      account_manager_name: r.account_manager_name,
      value: Number(r.value ?? 0),
    };
    if (r.bucket === "on_target") on_target.push(row);
    else if (r.bucket === "overdue") overdue.push(row);
    else if (r.bucket === "renewed") renewed.push(row);
    else if (r.bucket === "lost") lost.push(row);
    else if (r.bucket === "acc_inst_overdue") acc_inst_overdue.push(row);
    else if (r.bucket === "sales_inst_overdue") sales_inst_overdue.push(row);
  };

  // Prefer the frozen snapshot (captured at month-close, immune to end_date
  // drift). Fall back to a live recompute via the RPC, which mirrors migration
  // 0172's count-tile predicates so the bucket lists agree with the funnel.
  const { data: snap, error: snapErr } = await supabaseAdmin
    .from("monthly_target_snapshot")
    .select(
      "bucket, contract_id, client_name, client_code, account_manager_name, value",
    )
    .eq("organization_id", orgId)
    .eq("month", month);
  if (snapErr) throw snapErr;

  const from_snapshot = !!(snap && snap.length > 0);
  if (from_snapshot) {
    for (const r of snap as unknown as BucketRow[]) place(r);
  } else {
    const { data: live, error } = await supabaseAdmin.rpc(
      "get_month_target_buckets",
      { p_org: orgId, p_month: month },
    );
    if (error) throw error;
    for (const r of (live ?? []) as unknown as BucketRow[]) place(r);
  }

  // Installments due in the month. Exclude sequence 1 — the first payment is
  // the contract-confirmation down-payment, already counted as New-client
  // Income (Sales) / renewal collection (Account), NOT as an installment. Every
  // income bucket in 0172 filters sequence >= 2; the due-list now mirrors that.
  const { data: insts, error: instErr } = await supabaseAdmin
    .from("installments")
    .select(
      `expected_amount, status, source_type_key,
       contract:contracts!inner(id, organization_id,
         client:clients(name),
         am:employee_profiles!contracts_account_manager_id_fkey(full_name))`,
    )
    .eq("contract.organization_id", orgId)
    .gte("sequence", 2)
    .gte("expected_date", start)
    .lte("expected_date", endDate)
    .order("expected_amount", { ascending: false });
  if (instErr) throw instErr;

  type IRow = {
    expected_amount: number | string;
    status: string;
    source_type_key: string | null;
    contract: {
      id: string;
      client: { name: string | null } | null;
      am: { full_name: string } | null;
    } | null;
  };
  const installments_due: InstallmentDue[] = (
    (insts ?? []) as unknown as IRow[]
  ).map((i) => ({
    contract_id: i.contract?.id ?? "",
    client_name: i.contract?.client?.name ?? null,
    account_manager_name: i.contract?.am?.full_name ?? null,
    expected_amount: Number(i.expected_amount),
    status: i.status,
    source_type_key: i.source_type_key ?? null,
  }));

  const byValue = (a: BucketClient, b: BucketClient) => b.value - a.value;
  on_target.sort(byValue);
  overdue.sort(byValue);
  acc_inst_overdue.sort(byValue);
  return {
    on_target,
    overdue,
    renewed,
    lost,
    installments_due,
    acc_inst_overdue,
    sales_inst_overdue,
    from_snapshot,
  };
}

export async function getCeoClientInsights(
  orgId: string,
  monthIso?: string,
  limit = 12,
): Promise<CeoClientInsight[]> {
  const month = monthIso ?? monthStartIso(new Date());
  const { data, error } = await supabaseAdmin.rpc("get_ceo_client_insights", {
    p_org: orgId,
    p_month: month,
    p_limit: limit,
  });
  if (error) throw error;

  type Row = Omit<
    CeoClientInsight,
    | "active_contracts"
    | "total_contract_value"
    | "month_expected"
    | "month_collected"
    | "overdue_installments"
    | "renewal_value_due"
    | "open_task_count"
    | "overdue_task_count"
    | "on_time_pct_30d"
    | "health_score"
  > & {
    active_contracts: number | string | null;
    total_contract_value: number | string | null;
    month_expected: number | string | null;
    month_collected: number | string | null;
    overdue_installments: number | string | null;
    renewal_value_due: number | string | null;
    open_task_count: number | string | null;
    overdue_task_count: number | string | null;
    on_time_pct_30d: number | string | null;
    health_score: number | string | null;
  };

  return ((data ?? []) as Row[]).map((r) => ({
    ...r,
    active_contracts: Number(r.active_contracts ?? 0),
    total_contract_value: Number(r.total_contract_value ?? 0),
    month_expected: Number(r.month_expected ?? 0),
    month_collected: Number(r.month_collected ?? 0),
    overdue_installments: Number(r.overdue_installments ?? 0),
    renewal_value_due: Number(r.renewal_value_due ?? 0),
    open_task_count: Number(r.open_task_count ?? 0),
    overdue_task_count: Number(r.overdue_task_count ?? 0),
    on_time_pct_30d:
      r.on_time_pct_30d == null ? null : Number(r.on_time_pct_30d),
    health_score: Number(r.health_score ?? 0),
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
  contract_code: string | null;
  hold_started_at: string | null;
  hold_end_date: string | null;
  type_before_hold_id: string | null;
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
      `id, external_id, contract_code, hold_started_at, hold_end_date,
       type_before_hold_id, start_date, end_date, actual_end_date, duration_months,
       total_value, paid_value, next_contract_value, renewal_paid_value,
       repeated_services_value, payment_status, target, status,
       contract_status_label, renewed_status, extension_days, delay_days,
       total_days_computed, notes, account_manager_id, account_manager_name,
       package_name,
       client:clients(id, name, external_id),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types!contracts_contract_type_id_fkey(key, name_ar),
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
    contract_code: string | null;
    hold_started_at: string | null;
    hold_end_date: string | null;
    type_before_hold_id: string | null;
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
    package_name: string | null;
    client: { id: string; name: string | null; external_id: string | null } | null;
    am: { id: string; full_name: string } | null;
    type: { key: string; name_ar: string } | null;
    package: { name_ar: string } | null;
    packages: Array<{ sort_order: number; package: { name_ar: string } | null }>;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const linkedPackages = [...(r.packages ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => p.package?.name_ar)
      .filter((x): x is string => !!x);
    const packageNames =
      linkedPackages.length > 0
        ? linkedPackages
        : r.package?.name_ar
          ? [r.package.name_ar]
          : splitPackageNames(r.package_name);
    return {
      id: r.id,
      external_id: r.external_id,
      contract_code: r.contract_code,
      hold_started_at: r.hold_started_at,
      hold_end_date: r.hold_end_date,
      type_before_hold_id: r.type_before_hold_id,
      client_id: r.client?.id ?? "",
      client_name: r.client?.name ?? null,
      client_external_id: r.client?.external_id ?? null,
      account_manager_id: r.account_manager_id,
      // Prefer the resolved employee name; fall back to the raw string when
      // the AM couldn't be matched (1 contract today: مدى الجميري).
      account_manager_name: r.am?.full_name ?? r.account_manager_name,
      contract_type_key: r.type?.key ?? null,
      contract_type_label: r.type?.name_ar ?? null,
      primary_package_name: r.package?.name_ar ?? packageNames[0] ?? null,
      package_names: packageNames,
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

export type ClientContractRow = {
  id: string;
  contract_code: string | null;
  status: string;
  target: string | null;
  total_value: number;
  start_date: string | null;
  end_date: string | null;
  type_label: string | null;
};

// All contracts for one client — powers the client detail page's contracts list.
export async function listClientContracts(
  orgId: string,
  clientId: string,
): Promise<ClientContractRow[]> {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select(
      "id, contract_code, status, target, total_value, start_date, end_date, type:contract_types(name_ar)",
    )
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => {
    const t = (c as { type?: { name_ar?: string } | { name_ar?: string }[] | null }).type;
    const typeObj = Array.isArray(t) ? t[0] : t;
    return {
      id: c.id as string,
      contract_code: (c.contract_code as string | null) ?? null,
      status: c.status as string,
      target: (c.target as string | null) ?? null,
      total_value: Number(c.total_value ?? 0),
      start_date: (c.start_date as string | null) ?? null,
      end_date: (c.end_date as string | null) ?? null,
      type_label: typeObj?.name_ar ?? null,
    };
  });
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
      `id, organization_id, external_id, start_date, end_date, duration_months,
       total_value, paid_value, target, status, notes,
       contract_code, hold_started_at, hold_end_date, type_before_hold_id,
       project_id, account_manager_id, contract_type_id, package_id,
       client:clients(id, name, client_code, external_id),
       am:employee_profiles!contracts_account_manager_id_fkey(id, full_name),
       type:contract_types!contracts_contract_type_id_fkey(id, key, name_ar),
       package:packages(id, key, name_ar, grace_days),
       project:projects(id, name)`,
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * All other contracts of the same client — the sheet's "duplicate Client ID"
 * insight surfaced properly: the detail page shows «هذا العميل لديه N عقود».
 */
export async function getClientSiblingContracts(
  orgId: string,
  clientId: string,
  excludeContractId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select(
      `id, contract_code, start_date, end_date, status, total_value,
       package_name,
       type:contract_types!contracts_contract_type_id_fkey(key, name_ar),
       packages:contract_packages(sort_order, package:packages(name_ar))`,
    )
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .neq("id", excludeContractId)
    .order("start_date", { ascending: false });
  if (error) throw error;

  type Row = {
    id: string;
    contract_code: string | null;
    start_date: string;
    end_date: string | null;
    status: string;
    total_value: number | string | null;
    package_name: string | null;
    type: { key: string; name_ar: string } | null;
    packages: Array<{ sort_order: number; package: { name_ar: string } | null }>;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    contract_code: r.contract_code,
    start_date: r.start_date,
    end_date: r.end_date,
    status: r.status,
    total_value: Number(r.total_value ?? 0),
    type_label: r.type?.name_ar ?? null,
    package_names:
      r.packages.length > 0
        ? [...r.packages]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((p) => p.package?.name_ar)
            .filter((x): x is string => !!x)
        : r.package_name
          ? [r.package_name]
          : [],
  }));
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

function mapSheetLogRows(rows: unknown[] | null): SheetLog[] {
  type Row = {
    id: string;
    contract_key: string;
    contract_id: string | null;
    client_external_id: string | null;
    client_name: string | null;
    account_manager: string | null;
    log_type: string;
    log_time: string | null;
    notes: string | null;
    snapshot: Record<string, unknown> | null;
  };

  return ((rows ?? []) as Row[]).map((row) => ({
    id: row.id,
    contract_key: row.contract_key,
    contract_id: row.contract_id,
    client_external_id: row.client_external_id,
    client_name: row.client_name,
    account_manager: row.account_manager,
    log_type: row.log_type,
    log_time: row.log_time,
    notes: row.notes,
    snapshot: row.snapshot ?? {},
  }));
}

export async function listSheetLogs(
  orgId: string,
  filters: SheetLogFilters = {},
  limit = 500,
): Promise<SheetLog[]> {
  let q = supabaseAdmin
    .from("contract_sheet_logs")
    .select(
      `id, contract_key, contract_id, client_external_id, client_name,
       account_manager, log_type, log_time, notes, snapshot`,
    )
    .eq("organization_id", orgId)
    .order("log_time", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (filters.logTypes && filters.logTypes.length > 0) {
    q = q.in("log_type", filters.logTypes);
  }
  if (filters.accountManager) {
    q = q.eq("account_manager", filters.accountManager);
  }
  if (filters.search) {
    const term = filters.search.trim().replace(/[,%]/g, "");
    if (term) {
      q = q.or(`client_name.ilike.%${term}%,contract_key.ilike.%${term}%`);
    }
  }
  if (filters.from) {
    q = q.gte("log_time", filters.from);
  }
  if (filters.to) {
    q = q.lte("log_time", filters.to);
  }

  const { data, error } = await q;
  if (error) throw error;
  return mapSheetLogRows(data);
}

export async function listSheetLogManagers(orgId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("contract_sheet_logs")
    .select("account_manager")
    .eq("organization_id", orgId)
    .not("account_manager", "is", null);
  if (error) throw error;

  type Row = { account_manager: string | null };
  return Array.from(
    new Set(
      ((data ?? []) as Row[])
        .map((row) => row.account_manager?.trim())
        .filter((value): value is string => !!value),
    ),
  ).sort((a, b) => a.localeCompare(b, "ar"));
}

export async function getContractSheetLogs(
  orgId: string,
  contractKey: string,
): Promise<SheetLog[]> {
  const { data, error } = await supabaseAdmin
    .from("contract_sheet_logs")
    .select(
      `id, contract_key, contract_id, client_external_id, client_name,
       account_manager, log_type, log_time, notes, snapshot`,
    )
    .eq("organization_id", orgId)
    .eq("contract_key", contractKey)
    .order("log_time", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return mapSheetLogRows(data);
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
           type:contract_types!contracts_contract_type_id_fkey(key, name_ar),
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
       type:contract_types!contracts_contract_type_id_fkey(key)`,
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
