#!/usr/bin/env bun
/**
 * One-shot seed: read the agency's Acc SHEET .xlsx and load every client,
 * contract, and installment into Supabase. Idempotent — safe to re-run.
 *
 * After this script the dashboard replaces the spreadsheet entirely:
 * /finance lights up, /contracts lists all 172 contracts, and the team
 * enters new data via the dashboard UI from here onward.
 *
 * Usage: bun run scripts/seed-acc-sheet.ts [path-to-xlsx]
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// ── inline parser (avoids server-only constraint when running as a script) ─
function s(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim() || null;
}
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function parseDate(v: unknown): string | null {
  if (!v && v !== 0) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const str = String(v).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = str.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const monIx = monthsShort.findIndex((x) => m[2].toLowerCase().startsWith(x.toLowerCase()));
    const year = Number(m[3]);
    if (monIx >= 0) {
      return `${year}-${String(monIx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const m2 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) return `${m2[3]}-${String(Number(m2[2])).padStart(2, "0")}-${String(Number(m2[1])).padStart(2, "0")}`;
  const n = Number(str);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}
const TYPE_KEY_MAP: Record<string, string> = {
  "new": "New", "renewal": "Renew", "renew": "Renew", "renewed": "Renew",
  "win-back": "WinBack", "winback": "WinBack",
  "upsell": "UPSELL", "upsell-acc": "UPSELL", "upsell - acc": "UPSELL",
  "upsell-sales": "UPSELL", "upsell - sales": "UPSELL",
  "switch": "Switch", "hold": "Hold", "lost": "Lost",
};
const STATUS_MAP: Record<string, string> = {
  "active": "active", "hold": "hold", "on hold": "hold",
  "closed": "closed", "expired": "expired",
  "lost": "lost", "renewed": "renewed", "soon to be renewed": "active",
};

// ── load + parse ──────────────────────────────────────────────────────────
const filePath =
  process.argv[2] || "/Users/mahmoudmac/Downloads/Acc SHEET .xlsx";
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}
console.log(`[seed] Reading ${path.basename(filePath)}...`);
const buf = fs.readFileSync(filePath);
const wb = XLSX.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
  type: "array",
  cellDates: true,
});

const ccSheet = wb.Sheets["Clients Contracts"];
const itSheet = wb.Sheets["💲Installments Tracker"];
if (!ccSheet) { console.error("Missing 'Clients Contracts' sheet"); process.exit(1); }
if (!itSheet) { console.error("Missing 'Installments Tracker' sheet"); process.exit(1); }

const ccRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ccSheet, {
  defval: null, raw: false,
});
const itRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(itSheet, {
  defval: null, raw: false,
});

interface Contract {
  externalKey: string;
  clientExternalId: string;
  clientName: string;
  accountManagerName: string | null;
  contractTypeKey: string | null;
  packageName: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number | null;
  totalValue: number;
  paidValue: number;
  target: string | null;
  statusLabel: string | null;
  status: string;
  notes: string | null;
}
interface Installment {
  contractExternalKey: string;
  sequence: 1 | 2 | 3 | 4;
  expectedAmount: number;
  expectedDate: string | null;
  actualAmount: number;
  actualDate: string | null;
}
interface Client {
  externalId: string;
  name: string;
  accountManagerName: string | null;
}

const contracts: Contract[] = [];
const clients = new Map<string, Client>();
const installments: Installment[] = [];

for (const r of ccRows) {
  const cid = s(r["Client ID"]);
  const cname = s(r["Client Name"]);
  if (!cid || !cname || !/^C\d+$/i.test(cid)) continue;
  const start = parseDate(r["Contract Start Date"]);
  const end = parseDate(r["Expected End Date"]);
  const actualEnd = parseDate(r["Actual End Date"]);
  const typeRaw = s(r["Contract Type"]);
  const typeKey = typeRaw ? TYPE_KEY_MAP[typeRaw.toLowerCase().trim()] ?? null : null;
  const statusLabel = s(r["Contract Status"]);
  const statusKey = statusLabel
    ? STATUS_MAP[statusLabel.toLowerCase().trim()] ?? "active"
    : "active";
  const status =
    typeKey === "Lost" ? "lost" :
    typeKey === "Hold" ? "hold" :
    statusKey;
  const externalKey = s(r["Key"]) ?? `${cid}|${(start ?? "").replace(/-/g, "")}`;

  contracts.push({
    externalKey,
    clientExternalId: cid,
    clientName: cname,
    accountManagerName: s(r["Account manager"]),
    contractTypeKey: typeKey,
    packageName: s(r["Package"]),
    startDate: start,
    endDate: actualEnd ?? end,
    durationMonths: num(r["C.Duration (Months)"]) > 0 ? Math.round(num(r["C.Duration (Months)"])) : null,
    totalValue: num(r["Next Contract Value"]) || num(r[" Value of repeated services"]),
    paidValue: num(r["Actual Paid for renewal"]) || num(r["Actual paid value"]),
    target: s(r["Target"]),
    statusLabel,
    status,
    notes: [s(r["Notes"]), s(r["ملاحظات"])].filter(Boolean).join(" — ") || null,
  });
  if (!clients.has(cid)) {
    clients.set(cid, { externalId: cid, name: cname, accountManagerName: s(r["Account manager"]) });
  }
}

for (const r of itRows) {
  const cid = s(r["Client ID"]);
  if (!cid || !/^C\d+$/i.test(cid)) continue;
  const start = parseDate(r["تاريخ الدفعة الاولى وبداية العقد"]);
  const externalKey = s(r["Key"]) ?? `${cid}|${(start ?? "").replace(/-/g, "")}`;

  const i1 = num(r["قيمة الدفعة الأولى\n(المدفوعة في بداية العقد)"]);
  if (i1 > 0) {
    installments.push({
      contractExternalKey: externalKey, sequence: 1,
      expectedAmount: i1, expectedDate: start,
      actualAmount: i1, actualDate: start,
    });
  }
  const more: Array<{ seq: 2 | 3 | 4; exp: string; amt: string; act: string }> = [
    { seq: 2, exp: "التاريخ المتوقع للدفعة الثانية", amt: "قيمة الدفعة الثانية", act: "التاريخ الفعلي لتحصيل الدفعة الثانية" },
    { seq: 3, exp: "التاريخ المتوقع للدفعة الثالثة", amt: "قيمة الدفعة الثالثة", act: "التاريخ الفعلي لتحصيل الدفعة الثالثة" },
    { seq: 4, exp: "التاريخ المتوقع للدفعة الرابعة", amt: "قيمة الدفعة الرابعة", act: "التاريخ الفعلي لتحصيل الدفعة الرابعة" },
  ];
  for (const c of more) {
    const amt = num(r[c.amt]);
    if (amt <= 0) continue;
    const exp = parseDate(r[c.exp]);
    const act = parseDate(r[c.act]);
    installments.push({
      contractExternalKey: externalKey, sequence: c.seq,
      expectedAmount: amt, expectedDate: exp,
      actualAmount: act ? amt : 0, actualDate: act,
    });
  }
}

console.log(`[seed] Parsed: ${clients.size} clients · ${contracts.length} contracts · ${installments.length} installments`);

// ── connect ────────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const SOURCE = "excel-acc-sheet";
const ORG_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG || "rawasm-demo";

const { data: org, error: orgErr } = await sb
  .from("organizations").select("id").eq("slug", ORG_SLUG).single();
if (orgErr || !org) { console.error(`org "${ORG_SLUG}" not found`); process.exit(1); }
const orgId = org.id;
console.log(`[seed] Target org: ${ORG_SLUG} (${orgId})`);

// ── upsert clients ────────────────────────────────────────────────────────
const { data: existingClients } = await sb
  .from("clients").select("id, external_id")
  .eq("organization_id", orgId).eq("external_source", SOURCE);
const existingClientMap = new Map<string, string>();
for (const r of existingClients ?? []) {
  if (r.external_id) existingClientMap.set(String(r.external_id), r.id);
}

const clientIdByExternal = new Map<string, string>();
let clientsInserted = 0;
let clientsUpdated = 0;
for (const c of clients.values()) {
  const existing = existingClientMap.get(c.externalId);
  if (existing) {
    await sb.from("clients").update({ name: c.name }).eq("id", existing);
    clientIdByExternal.set(c.externalId, existing);
    clientsUpdated++;
  } else {
    const { data, error } = await sb.from("clients").insert({
      organization_id: orgId,
      name: c.name,
      external_source: SOURCE,
      external_id: c.externalId,
      status: "active",
    }).select("id").single();
    if (error) { console.error(`client ${c.externalId}: ${error.message}`); continue; }
    clientIdByExternal.set(c.externalId, data!.id);
    clientsInserted++;
  }
}
console.log(`[seed] Clients: ${clientsInserted} new, ${clientsUpdated} updated`);

// ── lookup contract types ─────────────────────────────────────────────────
const { data: types } = await sb.from("contract_types").select("id, key");
const typeIdByKey = new Map<string, string>();
for (const t of types ?? []) typeIdByKey.set(String(t.key), t.id);

// ── upsert contracts ──────────────────────────────────────────────────────
const { data: existingContracts } = await sb
  .from("contracts").select("id, external_id")
  .eq("organization_id", orgId).eq("external_source", SOURCE);
const existingContractMap = new Map<string, string>();
for (const r of existingContracts ?? []) {
  if (r.external_id) existingContractMap.set(String(r.external_id), r.id);
}

const contractIdByExternalKey = new Map<string, string>();
let contractsUpserted = 0;
const contractErrors: string[] = [];

for (const c of contracts) {
  const clientUuid = clientIdByExternal.get(c.clientExternalId);
  if (!clientUuid) { contractErrors.push(`${c.externalKey}: missing client`); continue; }
  const typeId = c.contractTypeKey ? typeIdByKey.get(c.contractTypeKey) ?? null : null;

  const row = {
    organization_id: orgId,
    client_id: clientUuid,
    contract_type_id: typeId,
    account_manager_name: c.accountManagerName,
    package_name: c.packageName,
    contract_status_label: c.statusLabel,
    start_date: c.startDate,
    end_date: c.endDate,
    duration_months: c.durationMonths,
    total_value: c.totalValue,
    paid_value: c.paidValue,
    target: c.target,
    status: c.status,
    notes: c.notes,
    external_source: SOURCE,
    external_id: c.externalKey,
  };
  const existing = existingContractMap.get(c.externalKey);
  if (existing) {
    const { error } = await sb.from("contracts").update(row).eq("id", existing);
    if (error) { contractErrors.push(`${c.externalKey}: ${error.message}`); continue; }
    contractIdByExternalKey.set(c.externalKey, existing);
  } else {
    const { data, error } = await sb.from("contracts").insert(row).select("id").single();
    if (error) { contractErrors.push(`${c.externalKey}: ${error.message}`); continue; }
    contractIdByExternalKey.set(c.externalKey, data!.id);
  }
  contractsUpserted++;
}
console.log(`[seed] Contracts upserted: ${contractsUpserted}`);
if (contractErrors.length) {
  console.log(`[seed] Contract errors (${contractErrors.length}):`);
  for (const e of contractErrors.slice(0, 10)) console.log("  -", e);
}

// ── upsert installments ───────────────────────────────────────────────────
let installmentsUpserted = 0;
const installmentErrors: string[] = [];

for (const inst of installments) {
  const contractUuid = contractIdByExternalKey.get(inst.contractExternalKey);
  if (!contractUuid) { installmentErrors.push(`${inst.contractExternalKey}#${inst.sequence}: missing contract`); continue; }

  const status =
    inst.actualAmount > 0
      ? inst.actualAmount >= inst.expectedAmount ? "received" : "partial"
      : inst.expectedDate && inst.expectedDate < new Date().toISOString().slice(0, 10)
        ? "overdue"
        : "pending";

  const row = {
    organization_id: orgId,
    contract_id: contractUuid,
    sequence: inst.sequence,
    expected_date: inst.expectedDate ?? new Date().toISOString().slice(0, 10),
    expected_amount: inst.expectedAmount,
    actual_date: inst.actualDate,
    actual_amount: inst.actualAmount > 0 ? inst.actualAmount : null,
    status,
  };
  const { error } = await sb.from("installments").upsert(row, { onConflict: "contract_id,sequence" });
  if (error) { installmentErrors.push(`${inst.contractExternalKey}#${inst.sequence}: ${error.message}`); continue; }
  installmentsUpserted++;
}
console.log(`[seed] Installments upserted: ${installmentsUpserted}`);
if (installmentErrors.length) {
  console.log(`[seed] Installment errors (${installmentErrors.length}):`);
  for (const e of installmentErrors.slice(0, 10)) console.log("  -", e);
}

console.log("\n[seed] ✓ Done. Open /finance to see the live numbers.");
