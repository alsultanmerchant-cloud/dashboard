/* eslint-disable no-console */
/**
 * scripts/import-acc-sheet.ts — phase T7.5 importer (skeleton).
 *
 * Status: DRY-RUN only. Reads docs/data/acc-sheet.xlsx, validates the
 * 7 expected tabs, and writes tmp/acc-sheet-diff.csv as a preview.
 * The --commit branch is intentionally unimplemented in this partial
 * commit — see docs/phase-T7-5-followups.md for the row-by-row mapping
 * spec the next agent must wire up to write into Supabase.
 *
 * Usage:
 *   bun scripts/import-acc-sheet.ts            # dry-run, writes tmp/ diff
 *   bun scripts/import-acc-sheet.ts --commit   # NOT IMPLEMENTED YET
 *
 * Hard rules:
 *   - Idempotent on (Client ID, contract.start_date).
 *   - Manual override file at tmp/am-name-map.csv for AM-name → user mapping.
 *     Format: sheet_name,employee_id (one row per ambiguous AM).
 *   - If a fuzzy AM match is unsure → leave for manual review, do NOT guess.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import * as XLSX from "xlsx";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SHEET_PATH = "docs/data/acc-sheet.xlsx";
const DIFF_OUT = "tmp/acc-sheet-diff.csv";
const AM_MAP_PATH = "tmp/am-name-map.csv";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

const EXPECTED_TABS = [
  "Cycle_tracker",
  "Installments Tracker",
  "Edits Updates log",
  "Clients Contracts",
  "CEO_Dashboard",
  "TARGET_CONTRACTS",
  "Acc_Target_Breakdown",
] as const;

type AmMap = Map<string, string>; // sheet AM name → employee_id (uuid)

function loadAmMap(): AmMap {
  const map: AmMap = new Map();
  if (!existsSync(AM_MAP_PATH)) return map;
  const text = readFileSync(AM_MAP_PATH, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const [name, id] = line.split(",").map((s) => s?.trim());
    if (name && id && !name.startsWith("#")) map.set(name, id);
  }
  return map;
}

function ensureDir(p: string) {
  mkdirSync(dirname(p), { recursive: true });
}

function summarizeTab(name: string, rows: Record<string, unknown>[]) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return {
    name,
    rowCount: rows.length,
    headers,
    firstRow: rows[0] ?? null,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const commit = args.has("--commit");

  if (!existsSync(SHEET_PATH)) {
    console.error(`[fatal] ${SHEET_PATH} not found`);
    process.exit(1);
  }

  const wb = XLSX.readFile(SHEET_PATH);
  const present = new Set(wb.SheetNames);
  const missing = EXPECTED_TABS.filter((t) => !present.has(t));
  if (missing.length) {
    console.error(`[fatal] missing required tabs: ${missing.join(", ")}`);
    console.error(`        found: ${wb.SheetNames.join(", ")}`);
    process.exit(2);
  }

  const amMap = loadAmMap();
  console.log(`[info] AM-name map: ${amMap.size} entries from ${AM_MAP_PATH}`);

  const summaries: ReturnType<typeof summarizeTab>[] = [];
  for (const tab of EXPECTED_TABS) {
    const sheet = wb.Sheets[tab];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    summaries.push(summarizeTab(tab, rows));
    console.log(`[ok]   ${tab.padEnd(22)} rows=${rows.length}`);
  }

  // Dry-run diff: header + sample row per tab.
  ensureDir(DIFF_OUT);
  const lines: string[] = ["tab,row_count,headers"];
  for (const s of summaries) {
    const headers = s.headers.join(" | ").replace(/[\n\r,]/g, " ");
    lines.push(`${s.name},${s.rowCount},"${headers}"`);
  }
  writeFileSync(DIFF_OUT, lines.join("\n") + "\n", "utf-8");
  console.log(`[ok] wrote dry-run diff → ${DIFF_OUT}`);

  if (commit) {
    const supa = makeAdminClient();
    if (!supa) {
      console.error("[stop] --commit needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env");
      process.exit(4);
    }

    // T7.5-finish: only the easiest tab is wired here (Clients Contracts).
    // The other 6 tabs are TODO until column mappings are confirmed against
    // the live xlsx — see docs/phase-T7-5-followups.md §2.
    const ccRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Clients Contracts"],
      { defval: null },
    );
    const ccResult = await commitClientsContracts(supa, ccRows, amMap);
    console.log(
      `[commit] Clients Contracts → contracts: upserted=${ccResult.upserted} ` +
        `skipped=${ccResult.skipped} errors=${ccResult.errors}`,
    );

    // TODO(T7.5-followup-#2): Installments Tracker → installments
    // TODO(T7.5-followup-#2): Cycle_tracker → monthly_cycles
    // TODO(T7.5-followup-#2): Edits Updates log → contract_events
    // TODO(T7.5-followup-#2): CEO_Dashboard → services_catalog
    // TODO(T7.5-followup-#2): TARGET_CONTRACTS → am_targets (expected)
    // TODO(T7.5-followup-#2): Acc_Target_Breakdown → am_targets (achieved)
    console.log("[commit] other tabs intentionally skipped — see followups #2");
    return;
  }

  console.log("[done] dry-run complete. Re-run with --commit once mapping is wired.");
  // mark as used to keep the spec contract honest
  void join;
}

// ---------------------------------------------------------------------------
// --commit helpers
// ---------------------------------------------------------------------------

function makeAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date → JS date (1900 epoch, Lotus quirk safe-ish for >1900-03-01)
    const ms = Math.round((v - 25569) * 86_400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function toNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

async function ensureClient(
  supa: SupabaseClient,
  name: string,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: existing } = await supa
    .from("clients")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("name", trimmed)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: ins, error } = await supa
    .from("clients")
    .insert({ organization_id: ORG_ID, name: trimmed })
    .select("id")
    .single();
  if (error) {
    console.error("[commit] client insert failed", trimmed, error.message);
    return null;
  }
  return ins?.id as string;
}

async function ensurePackage(
  supa: SupabaseClient,
  label: string,
): Promise<string | null> {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const key = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "package";
  const { data: existing } = await supa
    .from("packages")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("key", key)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: ins, error } = await supa
    .from("packages")
    .insert({ organization_id: ORG_ID, key, name_ar: trimmed })
    .select("id")
    .single();
  if (error) {
    console.error("[commit] package insert failed", trimmed, error.message);
    return null;
  }
  return ins?.id as string;
}

async function lookupContractType(
  supa: SupabaseClient,
  label: string,
): Promise<string | null> {
  const t = label.trim();
  if (!t) return null;
  const { data } = await supa
    .from("contract_types")
    .select("id")
    .eq("organization_id", ORG_ID)
    .or(`key.eq.${t},name_ar.eq.${t}`)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function commitClientsContracts(
  supa: SupabaseClient,
  rows: Record<string, unknown>[],
  amMap: AmMap,
): Promise<{ upserted: number; skipped: number; errors: number }> {
  let upserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const clientName = String(
      pick(row, "Client", "Client Name", "العميل", "Customer") ?? "",
    ).trim();
    const startDate = toIsoDate(
      pick(row, "Start Date", "Start", "تاريخ البدء", "Contract Start"),
    );
    if (!clientName || !startDate) {
      skipped += 1;
      continue;
    }

    const clientId = await ensureClient(supa, clientName);
    if (!clientId) {
      errors += 1;
      continue;
    }

    const amName = String(
      pick(row, "AM", "Account Manager", "المسوّق", "المسؤول") ?? "",
    ).trim();
    const amId = amName ? amMap.get(amName) ?? null : null;

    const pkgLabel = String(
      pick(row, "Package", "الباقة", "Plan") ?? "",
    ).trim();
    const pkgId = pkgLabel ? await ensurePackage(supa, pkgLabel) : null;

    const typeLabel = String(
      pick(row, "Type", "Contract Type", "النوع") ?? "",
    ).trim();
    const typeId = typeLabel ? await lookupContractType(supa, typeLabel) : null;

    const totalValue = toNumber(
      pick(row, "Total Value", "Total", "Value", "القيمة"),
    );
    const durationMonths = toNumber(
      pick(row, "Duration", "Months", "Duration Months", "المدة"),
    );

    const payload = {
      organization_id: ORG_ID,
      client_id: clientId,
      account_manager_id: amId,
      contract_type_id: typeId,
      package_id: pkgId,
      start_date: startDate,
      duration_months: durationMonths > 0 ? Math.round(durationMonths) : null,
      total_value: totalValue,
      external_source: "acc-sheet",
      external_id: String(pick(row, "Contract ID", "ID", "Ref") ?? "") || null,
    };

    const { error } = await supa
      .from("contracts")
      .upsert(payload, { onConflict: "organization_id,client_id,start_date" });
    if (error) {
      console.error("[commit] contract upsert failed", clientName, error.message);
      errors += 1;
      continue;
    }
    upserted += 1;
  }

  return { upserted, skipped, errors };
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(99);
});
