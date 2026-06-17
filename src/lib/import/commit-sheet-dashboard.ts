// Commits the sheet's PRE-COMPUTED dashboard numbers (parsed by
// parse-sheet-dashboard.ts) into the per-month tables the CEO dashboard reads,
// FROZEN under source='sheet_import' so they're shown verbatim (the live SQL
// re-derivation is skipped for frozen months and only acts as a fallback).
//
//   totals  → monthly_dashboard_totals   (one row per org+month)
//   buckets → monthly_target_snapshot    (per-contract on-target/overdue/…)
//   amRows  → am_targets                 (per-account-manager rollup)
//
// Each pull replaces the month it captured and leaves every OTHER month intact,
// so older months (e.g. May, captured by switching the sheet's month dropdown)
// are preserved.

import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  SheetDashboardParse,
  SheetDashboardTotals,
} from "@/lib/import/parse-sheet-dashboard";

export type SheetDashboardCommitResult = {
  month: string | null;
  totalsWritten: boolean;
  cntOnTarget: number;
  bucketsWritten: number;
  amWritten: number;
  amUnmatched: string[];
  errors: string[];
};

const pct = (actual: number, expected: number) =>
  expected > 0 ? Math.round((actual / expected) * 10000) / 100 : 0;

// Normalize an Arabic/Latin name for matching: drop emoji/symbols/diacritics,
// fold alef/yaa/taa-marbuta variants, collapse whitespace.
function normName(v: string): string {
  return v
    .replace(/[ً-ْٰ]/g, "")
    .replace(/ـ/g, "") // tatweel
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toTotalsRow(orgId: string, month: string, t: SheetDashboardTotals) {
  const expected_renewals = t.acc_exp_ontarget + t.acc_exp_overdue_clients;
  const expected_installments =
    t.acc_exp_inst + t.acc_exp_overdue_inst + t.sales_exp_inst + t.sales_exp_overdue_inst;
  const actual_renewals = t.acc_act_ontarget + t.acc_act_overdue_clients + t.acc_act_sd_renewed;
  const actual_installments = t.acc_act_inst + t.sales_act_inst;
  return {
    organization_id: orgId,
    month,
    expected_renewals,
    expected_installments,
    total_expected: t.total_expected,
    actual_renewals,
    actual_installments,
    total_actual: t.total_actual,
    achievement_pct: pct(t.total_actual, t.total_expected),
    mov_new: t.mov_new,
    mov_renewed: t.mov_renewed,
    mov_lost: t.mov_lost,
    mov_upsell: t.mov_upsell,
    mov_winback: t.mov_winback,
    mov_closed: t.mov_closed,
    mov_hold: 0,
    cnt_total_clients: t.cnt_total_clients,
    cnt_roster_new: t.cnt_roster_new,
    cnt_roster_renew: t.cnt_roster_renew,
    cnt_roster_hold: t.cnt_roster_hold,
    cnt_roster_upsell: t.cnt_roster_upsell,
    cnt_roster_winback: t.cnt_roster_winback,
    cnt_on_target: t.cnt_on_target,
    cnt_overdue: t.cnt_overdue,
    cnt_sales_deposit: t.cnt_sales_deposit,
    acc_exp_overdue_inst: t.acc_exp_overdue_inst,
    acc_exp_inst: t.acc_exp_inst,
    acc_exp_ontarget: t.acc_exp_ontarget,
    acc_exp_overdue_clients: t.acc_exp_overdue_clients,
    acc_expected: t.acc_expected,
    acc_act_inst: t.acc_act_inst,
    acc_act_ontarget: t.acc_act_ontarget,
    acc_act_overdue_clients: t.acc_act_overdue_clients,
    acc_act_sd_renewed: t.acc_act_sd_renewed,
    acc_upsell: t.acc_upsell,
    acc_winback: t.acc_winback,
    acc_actual: t.acc_actual,
    acc_achievement_pct: pct(t.acc_actual, t.acc_expected),
    acc_gap: t.acc_gap,
    sales_exp_overdue_inst: t.sales_exp_overdue_inst,
    sales_exp_inst: t.sales_exp_inst,
    sales_expected: t.sales_expected,
    sales_act_inst: t.sales_act_inst,
    sales_upsell: t.sales_upsell,
    sales_new_income: t.sales_new_income,
    sales_total_income: t.sales_total_income,
    sales_gap: t.sales_gap,
    // Installments Achievement %: actual installments / expected installments.
    // Sales has a collection target independent of new-client income, so the
    // headline % must not fold in sales_new_income (matches the sheet).
    sales_achievement_pct: pct(t.sales_act_inst, t.sales_expected),
    is_frozen: true,
    source: "sheet_import",
    frozen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function commitSheetDashboard({
  parse,
  orgId,
}: {
  parse: SheetDashboardParse;
  orgId: string;
}): Promise<SheetDashboardCommitResult> {
  const errors: string[] = [];
  const month = parse.monthIso;
  if (!month) {
    return {
      month: null,
      totalsWritten: false,
      cntOnTarget: 0,
      bucketsWritten: 0,
      amWritten: 0,
      amUnmatched: [],
      errors: ["تعذّر تحديد الشهر من الشيت — لم تُحفظ أرقام لوحة الرئيس."],
    };
  }

  // 1) Headline totals (one row per org+month).
  const { error: totErr } = await supabaseAdmin
    .from("monthly_dashboard_totals")
    .upsert(toTotalsRow(orgId, month, parse.totals), {
      onConflict: "organization_id,month",
    });
  if (totErr) errors.push(`totals: ${totErr.message}`);

  // 2) Per-contract bucket snapshot — map sheet Key → contract id, then replace
  //    this month's snapshot wholesale.
  let bucketsWritten = 0;
  {
    const { data: contracts, error } = await supabaseAdmin
      .from("contracts")
      .select("id, external_id, client:clients(name, external_id), account_manager_name, am:employee_profiles!contracts_account_manager_id_fkey(full_name)")
      .eq("organization_id", orgId);
    if (error) {
      errors.push(`buckets lookup: ${error.message}`);
    } else {
      type CRow = {
        id: string;
        external_id: string | null;
        client: { name: string | null; external_id: string | null } | null;
        account_manager_name: string | null;
        am: { full_name: string } | null;
      };
      const byKey = new Map<string, CRow>();
      for (const c of (contracts ?? []) as unknown as CRow[]) {
        if (c.external_id) byKey.set(String(c.external_id), c);
      }

      const rows = parse.buckets
        .map((b) => {
          const c = byKey.get(b.contractKey);
          if (!c) return null;
          return {
            organization_id: orgId,
            month,
            contract_id: c.id,
            bucket: b.bucket,
            client_name: b.clientName ?? c.client?.name ?? null,
            client_code: c.client?.external_id ?? null,
            account_manager_name: c.am?.full_name ?? c.account_manager_name ?? null,
            value: b.value,
            frozen_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const missing = parse.buckets.length - rows.length;
      if (missing > 0) {
        errors.push(`${missing} عقد في تبويب التارجت لم يُطابَق برقم العقد.`);
      }

      // Replace this month's snapshot atomically-ish: clear then insert.
      const { error: delErr } = await supabaseAdmin
        .from("monthly_target_snapshot")
        .delete()
        .eq("organization_id", orgId)
        .eq("month", month);
      if (delErr) errors.push(`buckets clear: ${delErr.message}`);

      if (rows.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from("monthly_target_snapshot")
          .upsert(rows, { onConflict: "organization_id,month,contract_id,bucket" });
        if (insErr) errors.push(`buckets insert: ${insErr.message}`);
        else bucketsWritten = rows.length;
      }
    }
  }

  // 3) Per-AM rollup — match sheet name → employee, replace this month's rows.
  let amWritten = 0;
  const amUnmatched: string[] = [];
  {
    const { data: emps, error } = await supabaseAdmin
      .from("employee_profiles")
      .select("id, full_name")
      .eq("organization_id", orgId);
    if (error) {
      errors.push(`am lookup: ${error.message}`);
    } else {
      const byName = new Map<string, string>();
      for (const e of emps ?? []) {
        const k = normName(String(e.full_name ?? ""));
        if (k && !byName.has(k)) byName.set(k, e.id);
      }

      const rows = parse.amRows
        .map((a) => {
          const id = byName.get(normName(a.name));
          if (!id) {
            amUnmatched.push(a.name);
            return null;
          }
          return {
            organization_id: orgId,
            account_manager_id: id,
            month,
            expected_total: a.expected,
            achieved_total: a.achieved,
            achievement_pct: pct(a.achieved, a.expected),
            team_expected: a.teamExpected,
            team_achieved: a.teamAchieved,
            team_role: a.teamRole,
            breakdown_json: { source: "sheet_acc_breakdown" },
            updated_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // Replace only the sheet-sourced rows for this month, then upsert fresh.
      const { error: delErr } = await supabaseAdmin
        .from("am_targets")
        .delete()
        .eq("organization_id", orgId)
        .eq("month", month);
      if (delErr) errors.push(`am clear: ${delErr.message}`);

      if (rows.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from("am_targets")
          .upsert(rows, { onConflict: "organization_id,account_manager_id,month" });
        if (insErr) errors.push(`am insert: ${insErr.message}`);
        else amWritten = rows.length;
      }
    }
  }

  revalidatePath("/contracts");

  return {
    month,
    totalsWritten: !totErr,
    cntOnTarget: parse.totals.cnt_on_target,
    bucketsWritten,
    amWritten,
    amUnmatched,
    errors,
  };
}
