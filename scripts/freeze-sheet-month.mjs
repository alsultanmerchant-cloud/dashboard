// Standalone re-freeze of one month's CEO-dashboard numbers from the public sheet.
// Mirrors src/lib/import/commit-sheet-dashboard.ts but runs outside Next (REST,
// no revalidatePath). Reuses the REAL parser so parsing can't drift.
//
// Usage:
//   bun scripts/freeze-sheet-month.mjs            # dry-run: parse + print only
//   bun scripts/freeze-sheet-month.mjs --write --expect=2026-05-01   # write May
//
// Requires .env.local already sourced (CONTRACTS_GOOGLE_SHEET_ID,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

import * as XLSX from "xlsx";
import { parseSheetDashboard } from "../src/lib/import/parse-sheet-dashboard.ts";

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes("--write");
const EXPECT = (ARGS.find((a) => a.startsWith("--expect=")) ?? "").split("=")[1] || null;
// Optional: pull from a different spreadsheet (e.g. a user-owned copy where the
// month dropdown isn't locked). Falls back to the configured production sheet.
const SHEET_OVERRIDE = (ARGS.find((a) => a.startsWith("--sheet=")) ?? "").split("=")[1] || null;
const ORG_SLUG = "rawasm-demo";

const SHEET_ID = SHEET_OVERRIDE || process.env.CONTRACTS_GOOGLE_SHEET_ID;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SHEET_ID || !SB_URL || !SB_KEY) {
  console.error("Missing env (CONTRACTS_GOOGLE_SHEET_ID / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const CEO_SHEET = "CEO_Dashboared";
const TARGET_CONTRACTS_SHEET = "TARGET_CONTRACTS";
const ACC_BREAKDOWN_SHEET = "Acc_Target_Breakdown";

function tabAoa(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
}

const pct = (a, e) => (e > 0 ? Math.round((a / e) * 10000) / 100 : 0);

function normName(v) {
  return String(v)
    .replace(/[ً-ْٰ]/g, "")
    .replace(/ـ/g, "")
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

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── fetch + parse ────────────────────────────────────────────────────────────
console.log("Downloading workbook…");
const wbRes = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`);
const wb = XLSX.read(Buffer.from(await wbRes.arrayBuffer()), { type: "buffer", raw: false });
const parse = parseSheetDashboard({
  ceo: tabAoa(wb, CEO_SHEET),
  target: tabAoa(wb, TARGET_CONTRACTS_SHEET),
  accBreak: tabAoa(wb, ACC_BREAKDOWN_SHEET),
});

const t = parse.totals;
console.log("\n=== PARSED ===");
console.log("monthIso:", parse.monthIso);
console.log("total_expected:", t.total_expected, " total_actual:", t.total_actual);
console.log("cnt_on_target:", t.cnt_on_target, " cnt_overdue:", t.cnt_overdue, " cnt_sales_deposit:", t.cnt_sales_deposit);
console.log("roster new/renew/hold/upsell/winback:", t.cnt_roster_new, t.cnt_roster_renew, t.cnt_roster_hold, t.cnt_roster_upsell, t.cnt_roster_winback, " total:", t.cnt_total_clients);
console.log("movement new/renewed/lost/upsell/winback/closed:", t.mov_new, t.mov_renewed, t.mov_lost, t.mov_upsell, t.mov_winback, t.mov_closed);
console.log("acc_expected:", t.acc_expected, " acc_actual:", t.acc_actual, " sales_total_income:", t.sales_total_income);
const bucketCounts = parse.buckets.reduce((m, b) => ((m[b.bucket] = (m[b.bucket] || 0) + 1), m), {});
console.log("buckets:", JSON.stringify(bucketCounts), " total bucket rows:", parse.buckets.length);
console.log("amRows:", parse.amRows.length);
if (parse.warnings.length) console.log("WARNINGS:", parse.warnings);

if (!WRITE) {
  console.log("\n(dry-run — no writes. Re-run with --write --expect=YYYY-MM-01 to freeze.)");
  process.exit(0);
}

// ── write guards ─────────────────────────────────────────────────────────────
const month = parse.monthIso;
if (!month) { console.error("Refusing to write: month could not be read from the sheet."); process.exit(1); }
if (EXPECT && month !== EXPECT) {
  console.error(`Refusing to write: sheet month is ${month} but --expect=${EXPECT}. Flip the sheet's Month dropdown first.`);
  process.exit(1);
}

const [org] = await sb(`organizations?slug=eq.${ORG_SLUG}&select=id`);
if (!org) { console.error("Org not found."); process.exit(1); }
const orgId = org.id;
const now = new Date().toISOString();

// 1) totals
const expected_renewals = t.acc_exp_ontarget + t.acc_exp_overdue_clients;
const expected_installments = t.acc_exp_inst + t.acc_exp_overdue_inst + t.sales_exp_inst + t.sales_exp_overdue_inst;
const actual_renewals = t.acc_act_ontarget + t.acc_act_overdue_clients + t.acc_act_sd_renewed;
const actual_installments = t.acc_act_inst + t.sales_act_inst;
const totalsRow = {
  organization_id: orgId, month,
  expected_renewals, expected_installments, total_expected: t.total_expected,
  actual_renewals, actual_installments, total_actual: t.total_actual,
  achievement_pct: pct(t.total_actual, t.total_expected),
  mov_new: t.mov_new, mov_renewed: t.mov_renewed, mov_lost: t.mov_lost,
  mov_upsell: t.mov_upsell, mov_winback: t.mov_winback, mov_closed: t.mov_closed, mov_hold: 0,
  cnt_total_clients: t.cnt_total_clients, cnt_roster_new: t.cnt_roster_new,
  cnt_roster_renew: t.cnt_roster_renew, cnt_roster_hold: t.cnt_roster_hold,
  cnt_roster_upsell: t.cnt_roster_upsell, cnt_roster_winback: t.cnt_roster_winback,
  cnt_on_target: t.cnt_on_target, cnt_overdue: t.cnt_overdue, cnt_sales_deposit: t.cnt_sales_deposit,
  acc_exp_overdue_inst: t.acc_exp_overdue_inst, acc_exp_inst: t.acc_exp_inst,
  acc_exp_ontarget: t.acc_exp_ontarget, acc_exp_overdue_clients: t.acc_exp_overdue_clients,
  acc_expected: t.acc_expected, acc_act_inst: t.acc_act_inst, acc_act_ontarget: t.acc_act_ontarget,
  acc_act_overdue_clients: t.acc_act_overdue_clients, acc_act_sd_renewed: t.acc_act_sd_renewed,
  acc_upsell: t.acc_upsell, acc_winback: t.acc_winback, acc_actual: t.acc_actual,
  acc_achievement_pct: pct(t.acc_actual, t.acc_expected), acc_gap: t.acc_gap,
  sales_exp_overdue_inst: t.sales_exp_overdue_inst, sales_exp_inst: t.sales_exp_inst,
  sales_expected: t.sales_expected, sales_act_inst: t.sales_act_inst, sales_upsell: t.sales_upsell,
  sales_new_income: t.sales_new_income, sales_total_income: t.sales_total_income, sales_gap: t.sales_gap,
  sales_achievement_pct: pct(t.sales_total_income, t.sales_expected),
  is_frozen: true, source: "sheet_import", frozen_at: now, updated_at: now,
};
await sb("monthly_dashboard_totals?on_conflict=organization_id,month", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(totalsRow),
});
console.log("\n✓ totals written for", month);

// 2) buckets — map sheet Key -> contract id.
// Exact key match first. For PAST months, a contract that has since renewed no
// longer carries its period-key (the live row moved to a later key), so the key
// is orphaned. Fall back to the CLIENT code (the "C##" prefix of the key) →
// that client's current contract (latest start_date). Best-effort historical
// parity: keeps bucket COUNTS faithful to the sheet so the funnel doesn't
// under-report renewed/on-target. See [[project_contracts_month_status]].
const contracts = await sb(`contracts?organization_id=eq.${orgId}&select=id,external_id,start_date,account_manager_name,client:clients(name,external_id),am:employee_profiles!contracts_account_manager_id_fkey(full_name)`);
const byKey = new Map();
const byClientCode = new Map();
for (const c of contracts) {
  if (c.external_id) byKey.set(String(c.external_id), c);
  const code = c.client?.external_id;
  if (code) (byClientCode.get(code) ?? byClientCode.set(code, []).get(code)).push(c);
}
// Pick a client's current contract: latest start_date, then highest external_id.
for (const [, arr] of byClientCode) {
  arr.sort((a, b) =>
    String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) ||
    String(b.external_id ?? "").localeCompare(String(a.external_id ?? "")));
}
let fallbackCount = 0;
const seen = new Set(); // dedup on contract_id+bucket (PK)
const bucketRows = parse.buckets.map((b) => {
  let c = byKey.get(b.contractKey);
  if (!c) {
    const code = String(b.contractKey).split("|")[0];
    c = byClientCode.get(code)?.[0];
    if (c) fallbackCount++;
  }
  if (!c) return null;
  const dedupKey = `${c.id}|${b.bucket}`;
  if (seen.has(dedupKey)) return null;
  seen.add(dedupKey);
  return {
    organization_id: orgId, month, contract_id: c.id, bucket: b.bucket,
    client_name: b.clientName ?? c.client?.name ?? null,
    client_code: c.client?.external_id ?? null,
    account_manager_name: c.am?.full_name ?? c.account_manager_name ?? null,
    value: b.value, frozen_at: now,
  };
}).filter(Boolean);
const missingBuckets = parse.buckets.length - bucketRows.length;
if (fallbackCount > 0) console.log(`  (client-code fallback recovered ${fallbackCount} orphaned key(s))`);
await sb(`monthly_target_snapshot?organization_id=eq.${orgId}&month=eq.${month}`, { method: "DELETE" });
if (bucketRows.length) {
  await sb("monthly_target_snapshot?on_conflict=organization_id,month,contract_id,bucket", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(bucketRows),
  });
}
console.log(`✓ buckets written: ${bucketRows.length} (unmatched keys: ${missingBuckets})`);

// 3) am_targets — match sheet name -> employee
const emps = await sb(`employee_profiles?organization_id=eq.${orgId}&select=id,full_name`);
const byName = new Map();
for (const e of emps) { const k = normName(e.full_name ?? ""); if (k && !byName.has(k)) byName.set(k, e.id); }
const amUnmatched = [];
const amRows = parse.amRows.map((a) => {
  const id = byName.get(normName(a.name));
  if (!id) { amUnmatched.push(a.name); return null; }
  return {
    organization_id: orgId, account_manager_id: id, month,
    expected_total: a.expected, achieved_total: a.achieved,
    achievement_pct: pct(a.achieved, a.expected),
    team_expected: a.teamExpected, team_achieved: a.teamAchieved, team_role: a.teamRole,
    breakdown_json: { source: "sheet_acc_breakdown" }, updated_at: now,
  };
}).filter(Boolean);
await sb(`am_targets?organization_id=eq.${orgId}&month=eq.${month}`, { method: "DELETE" });
if (amRows.length) {
  await sb("am_targets?on_conflict=organization_id,account_manager_id,month", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(amRows),
  });
}
console.log(`✓ am_targets written: ${amRows.length} (unmatched: ${amUnmatched.join(", ") || "none"})`);
console.log(`\nDONE — froze ${month} from the sheet.`);
