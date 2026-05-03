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

const SHEET_PATH = "docs/data/acc-sheet.xlsx";
const DIFF_OUT = "tmp/acc-sheet-diff.csv";
const AM_MAP_PATH = "tmp/am-name-map.csv";

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
    console.error(
      "[stop] --commit branch is not yet implemented. See docs/phase-T7-5-followups.md " +
        "for the per-tab mapping spec the next agent must wire up.",
    );
    process.exit(3);
  }

  console.log("[done] dry-run complete. Re-run with --commit once mapping is wired.");
  // mark as used to keep the spec contract honest
  void join;
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(99);
});
