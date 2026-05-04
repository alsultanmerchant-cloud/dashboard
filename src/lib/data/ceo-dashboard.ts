import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Mirrors the CEO Monthly Dashboard sheet the agency tracks daily.
// One server fetch builds every tile so the page renders in a single
// round-trip plus one installments query.

const CONTRACT_TYPE_KEYS = [
  "New", "Renew", "UPSELL", "WinBack", "Switch", "Hold", "Lost",
] as const;
export type ContractTypeKey = (typeof CONTRACT_TYPE_KEYS)[number];

export const CONTRACT_TYPE_LABEL: Record<ContractTypeKey, string> = {
  New: "جديد",
  Renew: "تجديد",
  UPSELL: "رفع باقة",
  WinBack: "استرجاع",
  Switch: "تحويل",
  Hold: "تعليق",
  Lost: "مفقود",
};

export interface CeoDashboardWindow {
  monthIso: string;       // YYYY-MM
  monthFirstIso: string;  // YYYY-MM-01
  monthLastIso: string;   // YYYY-MM-end
  monthLabel: string;     // "Apr 2026"
}

export interface CeoTodayTotals {
  newContracts: number;        // active contracts type=New
  renewing: number;            // active contracts type=Renew
  hold: number;                // contracts on hold (status or type)
  totalClients: number;        // distinct client_id across all contracts
  upsell: number;
  winBack: number;
}

export interface CeoMovementCell {
  count: number;
  value: number;
}

export interface CeoMonthlyMovement {
  byType: Record<ContractTypeKey, CeoMovementCell>;
  totalCount: number;
  totalValue: number;
}

export interface CeoIncome {
  expected: number;     // sum of total_value for new+renew contracts started in month
  actual: number;       // sum of installments actually received in month
  expectedCount: number;
  actualCount: number;
}

export interface CeoTargetSection {
  // Counts
  salesDeposit: number;        // contracts with target='Sales Deposit'
  onTarget: number;            // target='On-Target' (renewing this month)
  overdue: number;             // target='Overdue' (should have renewed earlier)
  expectedOnPlusOverdue: number;     // onTarget + overdue
  expectedRemovingRenewed: number;   // expectedOnPlusOverdue - actuallyRenewed
  expectedRemovingLost: number;      // further minus lost
  actualAchievedThisMonth: number;   // renewed contracts created in month
  // Money columns (account department)
  overdueInstallmentsAmount: number;
  installmentsAmount: number;
  onTargetClientsAmount: number;
  overdueClientsAmount: number;
  totalExpected: number;
  // Actuals
  actualOverdueInstallments: number;
  actualInstallments: number;
  actualOnTargetClients: number;
  actualOverdueClients: number;
  totalIncomeFromAccount: number;
  upsellAcc: number;
  winBackAcc: number;
  revenueAchievementPct: number | null;
  revenueGap: number;
}

export interface CeoSalesSection {
  overdueInstallments: number;
  expectedInstallments: number;
  totalExpectedFromInstallments: number;
  actualInstallments: number;
  gap: number;
  installmentsAchievementPct: number | null;
  upsellSales: number;
  actualIncomeFromNewClients: number;
  totalIncomeFromSales: number;
}

export interface CeoDashboardData {
  window: CeoDashboardWindow;
  today: CeoTodayTotals;
  movement: CeoMonthlyMovement;
  income: CeoIncome;
  account: CeoTargetSection;
  sales: CeoSalesSection;
}

// ── helpers ────────────────────────────────────────────────────────────────

function monthBounds(monthIso: string) {
  const [y, m] = monthIso.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { firstIso: fmt(first), lastIso: fmt(last) };
}

function monthLabelArabic(monthIso: string) {
  const [y, m] = monthIso.split("-").map(Number);
  const months = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];
  return `${months[m - 1]} ${y}`;
}

export function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── main ───────────────────────────────────────────────────────────────────

export async function getCeoDashboardData(
  orgId: string,
  monthIso: string,
): Promise<CeoDashboardData> {
  const { firstIso, lastIso } = monthBounds(monthIso);

  // 1. Pull every contract for the org once (cheap; agency-scale data).
  //    We need: client_id, type, status, target, dates, value, paid_value.
  const { data: contracts, error: cErr } = await supabaseAdmin
    .from("contracts")
    .select(
      `id, client_id, status, target, total_value, paid_value, start_date, end_date,
       type:contract_types ( key )`,
    )
    .eq("organization_id", orgId);
  if (cErr) throw cErr;

  type ContractRow = {
    id: string;
    client_id: string;
    status: string;
    target: string | null;
    total_value: number | string | null;
    paid_value: number | string | null;
    start_date: string | null;
    end_date: string | null;
    type: { key?: string } | { key?: string }[] | null;
  };
  const rows = (contracts ?? []) as ContractRow[];

  // 2. Pull installments — both expected (in month) and actual (in month).
  //    One query covers both axes.
  const { data: insts, error: iErr } = await supabaseAdmin
    .from("installments")
    .select(
      `expected_amount, actual_amount, expected_date, actual_date, status,
       contract:contracts!inner ( id, target, type:contract_types ( key ) )`,
    )
    .eq("organization_id", orgId);
  if (iErr) throw iErr;

  type InstallmentRow = {
    expected_amount: number | string | null;
    actual_amount: number | string | null;
    expected_date: string | null;
    actual_date: string | null;
    status: string;
    contract: {
      id: string;
      target: string | null;
      type: { key?: string } | { key?: string }[] | null;
    } | { id: string; target: string | null; type: unknown }[] | null;
  };
  const instRows = (insts ?? []) as InstallmentRow[];

  // ── Today's totals ────────────────────────────────────────────────────
  const today: CeoTodayTotals = {
    newContracts: 0,
    renewing: 0,
    hold: 0,
    totalClients: new Set(rows.map((r) => r.client_id)).size,
    upsell: 0,
    winBack: 0,
  };

  function typeKey(r: { type: ContractRow["type"] }): string | null {
    if (!r.type) return null;
    const t = Array.isArray(r.type) ? r.type[0] : r.type;
    return t?.key ?? null;
  }

  for (const r of rows) {
    const t = typeKey(r);
    const isActive = r.status === "active";
    if (isActive && t === "New") today.newContracts++;
    if (isActive && t === "Renew") today.renewing++;
    if (r.status === "hold" || t === "Hold") today.hold++;
    if (isActive && t === "UPSELL") today.upsell++;
    if (isActive && t === "WinBack") today.winBack++;
  }

  // ── Monthly movement (selected month) ─────────────────────────────────
  const movement: CeoMonthlyMovement = {
    byType: Object.fromEntries(
      CONTRACT_TYPE_KEYS.map((k) => [k, { count: 0, value: 0 }]),
    ) as Record<ContractTypeKey, CeoMovementCell>,
    totalCount: 0,
    totalValue: 0,
  };

  // "Closed" = contracts whose end_date fell in this month and
  // status is closed/expired.
  let closedThisMonth = 0;

  for (const r of rows) {
    const t = typeKey(r) as ContractTypeKey | null;
    const startedThisMonth =
      r.start_date && r.start_date >= firstIso && r.start_date <= lastIso;
    const endedThisMonth =
      r.end_date && r.end_date >= firstIso && r.end_date <= lastIso;

    if (startedThisMonth && t && movement.byType[t]) {
      movement.byType[t].count++;
      movement.byType[t].value += Number(r.total_value || 0);
      movement.totalCount++;
      movement.totalValue += Number(r.total_value || 0);
    }
    if (endedThisMonth && (r.status === "closed" || r.status === "expired")) {
      closedThisMonth++;
    }
  }

  // ── Income (NEW + RENEWAL) ────────────────────────────────────────────
  const income: CeoIncome = {
    expected: 0,
    actual: 0,
    expectedCount: 0,
    actualCount: 0,
  };
  for (const r of rows) {
    const t = typeKey(r);
    const startedThisMonth =
      r.start_date && r.start_date >= firstIso && r.start_date <= lastIso;
    if (startedThisMonth && (t === "New" || t === "Renew")) {
      income.expected += Number(r.total_value || 0);
      income.expectedCount++;
    }
  }
  for (const inst of instRows) {
    const c = Array.isArray(inst.contract) ? inst.contract[0] : inst.contract;
    if (!c) continue;
    const t = c.type
      ? (Array.isArray(c.type) ? (c.type[0] as { key?: string })?.key : (c.type as { key?: string })?.key) ?? null
      : null;
    if (
      inst.actual_date && inst.actual_date >= firstIso &&
      inst.actual_date <= lastIso &&
      (t === "New" || t === "Renew")
    ) {
      income.actual += Number(inst.actual_amount || 0);
      income.actualCount++;
    }
  }

  // ── Account Department section ───────────────────────────────────────
  // target field on contracts: "Sales Deposit" / "On-Target" / "Overdue" / "Lost" / "Renewed"
  const account: CeoTargetSection = {
    salesDeposit: 0,
    onTarget: 0,
    overdue: 0,
    expectedOnPlusOverdue: 0,
    expectedRemovingRenewed: 0,
    expectedRemovingLost: 0,
    actualAchievedThisMonth: 0,
    overdueInstallmentsAmount: 0,
    installmentsAmount: 0,
    onTargetClientsAmount: 0,
    overdueClientsAmount: 0,
    totalExpected: 0,
    actualOverdueInstallments: 0,
    actualInstallments: 0,
    actualOnTargetClients: 0,
    actualOverdueClients: 0,
    totalIncomeFromAccount: 0,
    upsellAcc: 0,
    winBackAcc: 0,
    revenueAchievementPct: null,
    revenueGap: 0,
  };

  let renewedInMonth = 0;
  let lostInMonth = 0;

  for (const r of rows) {
    const t = typeKey(r);
    const tgt = r.target ?? "";
    const startedThisMonth =
      r.start_date && r.start_date >= firstIso && r.start_date <= lastIso;
    const value = Number(r.total_value || 0);

    if (tgt === "Sales Deposit") account.salesDeposit++;
    if (tgt === "On-Target") {
      account.onTarget++;
      account.onTargetClientsAmount += value;
    }
    if (tgt === "Overdue") {
      account.overdue++;
      account.overdueClientsAmount += value;
    }
    if (startedThisMonth && t === "Renew") renewedInMonth++;
    if (startedThisMonth && t === "Lost") lostInMonth++;
    if (startedThisMonth && t === "UPSELL") {
      account.upsellAcc += value;
    }
    if (startedThisMonth && t === "WinBack") {
      account.winBackAcc += value;
    }
  }

  account.expectedOnPlusOverdue = account.onTarget + account.overdue;
  account.expectedRemovingRenewed = account.expectedOnPlusOverdue - renewedInMonth;
  account.expectedRemovingLost =
    account.expectedRemovingRenewed - lostInMonth;
  account.actualAchievedThisMonth = renewedInMonth;

  // Installments by source — Account vs Sales is determined by the parent
  // contract's target. "Sales Deposit" → Sales; everything else → Account.
  for (const inst of instRows) {
    const c = Array.isArray(inst.contract) ? inst.contract[0] : inst.contract;
    if (!c) continue;
    const isSales = c.target === "Sales Deposit";
    const expected = Number(inst.expected_amount || 0);
    const actual = Number(inst.actual_amount || 0);
    const expectedThisMonth =
      inst.expected_date && inst.expected_date >= firstIso &&
      inst.expected_date <= lastIso;
    const actualThisMonth =
      inst.actual_date && inst.actual_date >= firstIso &&
      inst.actual_date <= lastIso;
    const isOverdue = inst.status === "overdue";

    if (!isSales) {
      // Account
      if (expectedThisMonth) account.installmentsAmount += expected;
      if (isOverdue) account.overdueInstallmentsAmount += expected - actual;
      if (actualThisMonth) {
        account.actualInstallments += actual;
        if (isOverdue) account.actualOverdueInstallments += actual;
      }
    }
  }
  account.totalExpected =
    account.installmentsAmount +
    account.onTargetClientsAmount +
    account.overdueClientsAmount;
  account.totalIncomeFromAccount =
    account.actualInstallments +
    account.actualOnTargetClients +
    account.actualOverdueClients;
  account.revenueAchievementPct = account.totalExpected > 0
    ? Math.round((account.totalIncomeFromAccount / account.totalExpected) * 100)
    : null;
  account.revenueGap = Math.max(0, account.totalExpected - account.totalIncomeFromAccount);

  // ── Sales section ─────────────────────────────────────────────────────
  const sales: CeoSalesSection = {
    overdueInstallments: 0,
    expectedInstallments: 0,
    totalExpectedFromInstallments: 0,
    actualInstallments: 0,
    gap: 0,
    installmentsAchievementPct: null,
    upsellSales: 0,
    actualIncomeFromNewClients: 0,
    totalIncomeFromSales: 0,
  };

  for (const inst of instRows) {
    const c = Array.isArray(inst.contract) ? inst.contract[0] : inst.contract;
    if (!c || c.target !== "Sales Deposit") continue;
    const expected = Number(inst.expected_amount || 0);
    const actual = Number(inst.actual_amount || 0);
    const expectedThisMonth =
      inst.expected_date && inst.expected_date >= firstIso &&
      inst.expected_date <= lastIso;
    const actualThisMonth =
      inst.actual_date && inst.actual_date >= firstIso &&
      inst.actual_date <= lastIso;
    const isOverdue = inst.status === "overdue";

    if (isOverdue) sales.overdueInstallments += expected - actual;
    if (expectedThisMonth) sales.expectedInstallments += expected;
    if (actualThisMonth) sales.actualInstallments += actual;
  }

  // Income from NEW clients = New-type contracts started this month, by sum
  for (const r of rows) {
    const t = typeKey(r);
    const startedThisMonth =
      r.start_date && r.start_date >= firstIso && r.start_date <= lastIso;
    if (startedThisMonth && t === "New") {
      sales.actualIncomeFromNewClients += Number(r.paid_value || 0);
    }
  }

  sales.totalExpectedFromInstallments =
    sales.expectedInstallments + sales.overdueInstallments;
  sales.gap = Math.max(0, sales.totalExpectedFromInstallments - sales.actualInstallments);
  sales.installmentsAchievementPct = sales.totalExpectedFromInstallments > 0
    ? Math.round((sales.actualInstallments / sales.totalExpectedFromInstallments) * 100)
    : null;
  sales.totalIncomeFromSales =
    sales.actualInstallments + sales.actualIncomeFromNewClients + sales.upsellSales;

  return {
    window: {
      monthIso,
      monthFirstIso: firstIso,
      monthLastIso: lastIso,
      monthLabel: monthLabelArabic(monthIso),
    },
    today,
    movement: { ...movement, totalValue: movement.totalValue + 0 },
    income: { ...income, expected: income.expected, actual: income.actual + closedThisMonth * 0 },
    account,
    sales,
  };
}
