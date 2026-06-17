// Excel import parser for the "Acc SHEET.xlsx" the agency uses today.
// Two sheets we care about:
//   "Clients Contracts"     — one row per contract, ~24 columns
//   "💲Installments Tracker" — one row per contract with up to 4 installments
//                              expanded across columns
//
// Row layout (both sheets):
//   Row 0 — column headers
//   Row 1 — Arabic description / instructions for the human, NOT data
//   Row 2+ — actual data rows
//
// We use the "Key" column (e.g. "C83|20250906") as the canonical
// external_id for idempotent upsert.

import "server-only";
import * as XLSX from "xlsx";

export interface ParsedClient {
  externalId: string;        // Excel "Client ID" e.g. "C83"
  name: string;
  accountManagerName: string | null;
}

export interface ParsedContract {
  externalKey: string;       // Excel "Key" e.g. "C83|20250906"
  clientExternalId: string;
  clientName: string;
  accountManagerName: string | null;
  contractTypeKey: string | null;   // mapped to contract_types.key
  contractTypeRaw: string | null;
  packageName: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number | null;
  totalValue: number;
  paidValue: number;                // "Actual paid value"
  repeatedServicesValue: number | null;  // " Value of repeated services"
  nextContractValue: number | null;      // "Next Contract Value" (renewal value)
  renewalPaidValue: number | null;        // "Actual Paid for renewal"
  paymentStatus: string | null;            // "payment status" → Installments | Complete
  renewedStatus: string | null;            // "renewed?" → YES | NO | Closed
  delayDays: number | null;                // "Delays" (working days)
  extensionDays: number | null;            // "Extention period"
  totalDaysComputed: number | null;        // "Total Days (للمراجعة)"
  target: string | null;            // col E — current/live status
  targetByMonth: string | null;     // col V — month-aware status (current month only)
  statusLabel: string | null;       // raw "Active"/"Expired"/"SOON TO BE Renewed"/...
  status: "active" | "hold" | "lost" | "closed" | "expired" | "renewed";
  notes: string | null;
}

export interface ParsedInstallment {
  contractExternalKey: string;       // ties to ParsedContract.externalKey
  sequence: 1 | 2 | 3 | 4;
  expectedAmount: number;
  expectedDate: string | null;
  actualAmount: number;
  actualDate: string | null;
}

export interface ParsedSheetLog {
  contractKey: string;
  clientExternalId: string | null;
  clientName: string | null;
  accountManager: string | null;
  logType: string;
  logTimeIso: string | null;
  notes: string | null;
  snapshot: Record<string, unknown>;
}

export interface ParseResult {
  clients: ParsedClient[];           // unique-by-externalId
  contracts: ParsedContract[];
  installments: ParsedInstallment[];
  warnings: string[];
  stats: {
    clientsContractsRows: number;
    installmentsTrackerRows: number;
    skippedRows: number;
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function s(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim() || null;
}
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
// Like num(), but preserves the blank-vs-zero distinction the team asked for:
// a blank sheet cell → null (renders "—"), a literal "0" → 0 (renders "0").
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  if (str === "") return null;
  const n = Number(str.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

// "payment status" — the sheet uses "Installments" / "Complete" (the grid keys
// its color swatches off those exact strings). Map loosely so stray casing or
// the Arabic instruction row can never leak a junk value into the column.
function normalizePaymentStatus(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase();
  if (k.includes("install")) return "Installments";
  if (k.includes("complete")) return "Complete";
  return null;
}

// "renewed?" — YES / NO / Closed (drives the grid's row tint). Normalize the
// casing and drop anything else so the color rule stays predictable.
function normalizeRenewedStatus(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase();
  if (k === "yes") return "YES";
  if (k === "no") return "NO";
  if (k === "closed") return "Closed";
  return null;
}

// Excel dates can come as JS Date, ISO strings, or "6 Sep 2025" / "24/9/2025".
// Normalize to YYYY-MM-DD or null.
function parseDate(v: unknown): string | null {
  if (!v && v !== 0) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const str = String(v).trim();
  if (!str) return null;

  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  // "6 Sep 2025" or "24 Sep 2025"
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
  // "24/9/2025" or "24-9-2025"
  const m2 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    return `${m2[3]}-${String(Number(m2[2])).padStart(2, "0")}-${String(Number(m2[1])).padStart(2, "0")}`;
  }
  // Excel serial number?
  const n = Number(str);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

const TYPE_KEY_MAP: Record<string, string> = {
  "new": "New",
  "renewal": "Renew",
  "renew": "Renew",
  "renewed": "Renew",
  "win-back": "WinBack",
  "winback": "WinBack",
  "upsell": "UPSELL",
  "upsell-acc": "UPSELL",
  "upsell - acc": "UPSELL",
  "upsell-sales": "UPSELL",
  "upsell - sales": "UPSELL",
  "switch": "Switch",
  "hold": "Hold",
  "lost": "Lost",
};
function mapContractType(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase().trim();
  return TYPE_KEY_MAP[k] ?? null;
}

// Sky Light writes some renewals as "#Renewal#" — an internal sheet marker that
// drives its own accounting; it is intentionally NOT the same token as plain
// "Renewal". We leave the marker untouched in the sheet and don't remap it
// globally (other #Renewal# rows must stay as the sheet has them). But for these
// specific active clients the contract IS a renewal, so without a type they drop
// out of the Renewal filter. Force the renewal type for them only. Re-applied on
// every sync, so a re-pull never reverts them to untyped.
const RENEWAL_TYPE_EXCEPTION_CLIENTS = new Set(["C30", "C39"]);
function isRenewalMarker(raw: string | null): boolean {
  return /^#?\s*renewal\s*#?$/i.test((raw ?? "").trim());
}

const STATUS_MAP: Record<string, ParsedContract["status"]> = {
  "active":             "active",
  "hold":               "hold",
  "on hold":            "hold",
  "closed":             "closed",
  "expired":            "expired",
  "lost":               "lost",
  "renewed":            "renewed",
  "soon to be renewed": "active",   // treat as still-running
};
function mapStatus(raw: string | null, typeKey: string | null): ParsedContract["status"] {
  if (typeKey === "Lost") return "lost";
  if (typeKey === "Hold") {
    // A Hold contract whose Contract Status (col N) reads Closed/Lost is a LOST
    // client, not an active pause. Sky Light: held clients routinely churn to
    // lost, and the sheet records that as Type=Hold + Status=Closed (the payment
    // may still be chased, so the payments tab isn't marked lost yet). Only a
    // hold that is still open counts as a live paused contract.
    const hk = raw?.toLowerCase().trim();
    if (hk === "closed" || hk === "lost") return "lost";
    return "hold";
  }
  if (!raw) return "active";
  const k = raw.toLowerCase().trim();
  return STATUS_MAP[k] ?? "active";
}

// Normalize the contract-status label. The sheet stores 'On Target' (col E /
// col V); a hyphen variant 'On-Target' crept in via an earlier import and made
// the dashboard SQL undercount (see migration 0173). Collapse it here so it
// never re-enters on sync.
function normalizeTarget(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim();
  if (!k) return null;
  if (/^on[\s-]*target$/i.test(k)) return "On Target";
  return k;
}

function parseLogTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();

  const str = String(v).trim();
  if (!str) return null;

  const m = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/,
  );
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d.toISOString();
}

const LOG_SNAPSHOT_COLUMNS = [
  "Contract Start Date",
  "Target",
  "Contract Type",
  "Package",
  "C.Duration (Months)",
  "Actual paid value",
  " Value of repeated services",
  "payment status",
  "Expected End Date",
  "Contract Status",
  "Next Contract Value",
  "Actual End Date",
  "Delays\n (working days)",
] as const;

// ── main ───────────────────────────────────────────────────────────────────

export function parseAccSheet(buf: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const warnings: string[] = [];
  let skippedRows = 0;

  // Sheet names are stable in the agency's template
  const ccSheet = wb.Sheets["Clients Contracts"];
  const itSheet = wb.Sheets["💲Installments Tracker"];

  if (!ccSheet) warnings.push('لم يتم العثور على ورقة "Clients Contracts"');
  if (!itSheet) warnings.push('لم يتم العثور على ورقة "💲Installments Tracker"');

  // ── Clients Contracts ────────────────────────────────────────────────
  type CCRow = Record<string, unknown>;
  const ccRows = ccSheet
    ? (XLSX.utils.sheet_to_json<CCRow>(ccSheet, { defval: null, raw: false }) as CCRow[])
    : [];

  // The TRUE full (pre-tax) contract value lives on the Installments Tracker
  // ("قيمة العقد بالكامل (بدون ضرائب)"), keyed by the contract Key. The Clients-
  // Contracts tab only carries the renewal amount and the actual-paid amount, so
  // we join the tracker's full value in below to set total_value for installment
  // contracts. Read once here and reuse for the installments loop further down.
  type ITRow = Record<string, unknown>;
  const itRows = itSheet
    ? (XLSX.utils.sheet_to_json<ITRow>(itSheet, { defval: null, raw: false }) as ITRow[])
    : [];
  const fullContractValueByKey = new Map<string, number>();
  for (const r of itRows) {
    const cid = s(r["Client ID"]);
    if (!cid || !/^C\d+$/i.test(cid)) continue;
    const itKey =
      s(r["Key"]) ??
      `${cid}|${(parseDate(r["تاريخ الدفعة الاولى وبداية العقد"]) ?? "").replace(/-/g, "")}`;
    const fv = numOrNull(r["قيمة العقد بالكامل\n(بدون ضرائب)"]);
    if (fv != null && fv > 0) fullContractValueByKey.set(itKey, fv);
  }

  const contracts: ParsedContract[] = [];
  const clientMap = new Map<string, ParsedClient>();

  for (let i = 0; i < ccRows.length; i++) {
    const r = ccRows[i];
    const clientId = s(r["Client ID"]);
    const clientName = s(r["Client Name"]);
    const key = s(r["Key"]);

    // Skip the description row (row index 0 in the sheet has Arabic instructions
    // in some columns but "Client ID" should be a real ID like "C10" on real rows)
    if (!clientId || !clientName) { skippedRows++; continue; }
    if (!/^C\d+$/i.test(clientId)) { skippedRows++; continue; }

    const accountManagerName = s(r["Account manager"]);
    const contractTypeRaw = s(r["Contract Type"]);
    let contractTypeKey = mapContractType(contractTypeRaw);
    // Per-client exception: treat "#Renewal#" as a renewal type so the filter
    // catches it (see RENEWAL_TYPE_EXCEPTION_CLIENTS). Only fills an otherwise
    // untyped renewal-marker row; never overrides an already-mapped type.
    if (
      !contractTypeKey &&
      isRenewalMarker(contractTypeRaw) &&
      RENEWAL_TYPE_EXCEPTION_CLIENTS.has(clientId.toUpperCase())
    ) {
      contractTypeKey = "Renew";
    }
    const startDate = parseDate(r["Contract Start Date"]);
    const externalKey = key ?? `${clientId}|${(startDate ?? "").replace(/-/g, "")}`;
    const endDate = parseDate(r["Expected End Date"]);
    const actualEndDate = parseDate(r["Actual End Date"]);
    const target = normalizeTarget(s(r["Target"]));
    // Col V — the sheet's month-aware status, only populated for the sheet's
    // currently-selected month (blank otherwise). Mirrored as an audit field.
    const targetByMonth = normalizeTarget(
      s(r["Target_ByMonth"]) ?? s(r["Target By Month"]),
    );
    const statusLabel = s(r["Contract Status"]);
    const status = mapStatus(statusLabel, contractTypeKey);
    // المدفوع = the actual collected amount. (Renewal payment is its own column.)
    const paidValue = num(r["Actual paid value"]);
    const repeatedServicesValue = numOrNull(r[" Value of repeated services"]);
    const nextContractValue = numOrNull(r["Next Contract Value"]);
    const paymentStatus = normalizePaymentStatus(s(r["payment status"]));
    // القيمة الإجمالية (total contract value):
    //  • Complete payment  → the actual paid value IS the full contract value.
    //  • Installments      → the full PRE-TAX value from the Installments Tracker
    //                        ("قيمة العقد بالكامل بدون ضرائب"); the paid amount is
    //                        only the first installment.
    // It is NOT "Value of repeated services" / "Next Contract Value" — those are
    // the RENEWAL amount (next_contract_value), a separate figure.
    const itFullValue = fullContractValueByKey.get(externalKey) ?? null;
    const totalValue =
      paymentStatus === "Complete"
        ? paidValue
        : itFullValue ?? paidValue;
    const renewalPaidValue = numOrNull(r["Actual Paid for renewal"]);
    const renewedStatus = normalizeRenewedStatus(s(r["renewed?"]));
    const delayDays = intOrNull(r["Delays"]);
    const extensionDays = intOrNull(r["Extention period"]);
    const totalDaysComputed = intOrNull(r["Total Days (للمراجعة)"]);
    const durationRaw = num(r["C.Duration (Months)"]);
    const durationMonths = durationRaw > 0 ? Math.round(durationRaw) : null;
    const packageName = s(r["Package"]);
    const notes = [s(r["Notes"]), s(r["ملاحظات"])].filter(Boolean).join(" — ") || null;

    contracts.push({
      externalKey,
      clientExternalId: clientId,
      clientName,
      accountManagerName,
      contractTypeKey,
      contractTypeRaw,
      packageName,
      startDate,
      endDate: actualEndDate ?? endDate,
      durationMonths,
      totalValue,
      paidValue,
      repeatedServicesValue,
      nextContractValue,
      renewalPaidValue,
      paymentStatus,
      renewedStatus,
      delayDays,
      extensionDays,
      totalDaysComputed,
      target,
      targetByMonth,
      statusLabel,
      status,
      notes,
    });

    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, {
        externalId: clientId,
        name: clientName,
        accountManagerName,
      });
    }
  }

  // ── Installments Tracker ─────────────────────────────────────────────
  // itRows already read above (for the full-contract-value map).
  const installments: ParsedInstallment[] = [];

  for (let i = 0; i < itRows.length; i++) {
    const r = itRows[i];
    const clientId = s(r["Client ID"]);
    const key = s(r["Key"]);
    if (!clientId || !/^C\d+$/i.test(clientId)) { skippedRows++; continue; }

    const startDate = parseDate(r["تاريخ الدفعة الاولى وبداية العقد"]);
    const externalKey = key ?? `${clientId}|${(startDate ?? "").replace(/-/g, "")}`;

    // Installment 1 = "الدفعة الأولى" (paid at contract start)
    const inst1Amount = num(r["قيمة الدفعة الأولى\n(المدفوعة في بداية العقد)"]);
    if (inst1Amount > 0) {
      installments.push({
        contractExternalKey: externalKey,
        sequence: 1,
        expectedAmount: inst1Amount,
        expectedDate: startDate,
        actualAmount: inst1Amount, // installment 1 is paid at start
        actualDate: startDate,
      });
    }

    // Installments 2, 3, 4 — read expected + actual pairs
    const cols: Array<{
      seq: 2 | 3 | 4;
      expDateCol: string;
      amountCol: string;
      actDateCol: string;
    }> = [
      {
        seq: 2,
        expDateCol: "التاريخ المتوقع للدفعة الثانية",
        amountCol: "قيمة الدفعة الثانية",
        actDateCol: "التاريخ الفعلي لتحصيل الدفعة الثانية",
      },
      {
        seq: 3,
        expDateCol: "التاريخ المتوقع للدفعة الثالثة",
        amountCol: "قيمة الدفعة الثالثة",
        actDateCol: "التاريخ الفعلي لتحصيل الدفعة الثالثة",
      },
      {
        seq: 4,
        expDateCol: "التاريخ المتوقع للدفعة الرابعة",
        amountCol: "قيمة الدفعة الرابعة",
        actDateCol: "التاريخ الفعلي لتحصيل الدفعة الرابعة",
      },
    ];
    for (const c of cols) {
      const amount = num(r[c.amountCol]);
      if (amount <= 0) continue;
      const expectedDate = parseDate(r[c.expDateCol]);
      const actualDate = parseDate(r[c.actDateCol]);
      installments.push({
        contractExternalKey: externalKey,
        sequence: c.seq,
        expectedAmount: amount,
        expectedDate,
        actualAmount: actualDate ? amount : 0,
        actualDate,
      });
    }
  }

  return {
    clients: Array.from(clientMap.values()),
    contracts,
    installments,
    warnings,
    stats: {
      clientsContractsRows: ccRows.length,
      installmentsTrackerRows: itRows.length,
      skippedRows,
    },
  };
}

export function parseLogsSheet(buf: ArrayBuffer): {
  logs: ParsedSheetLog[];
  warnings: string[];
} {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const warnings: string[] = [];
  // The real Sky Light sheet names this tab "Edits  Updates log"; older
  // CSV-assembled workbooks named it "Logs". Accept either.
  const logsSheet = wb.Sheets.Logs ?? wb.Sheets["Edits  Updates log"];

  if (!logsSheet) {
    return {
      logs: [],
      warnings: ['لم يتم العثور على ورقة "Logs"'],
    };
  }

  type LogRow = Record<string, unknown>;
  const rows = XLSX.utils.sheet_to_json<LogRow>(logsSheet, {
    defval: null,
    raw: false,
  }) as LogRow[];

  const logs: ParsedSheetLog[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const logTimeRaw = row["Log Time"];
    const logType = s(row["Log Type"]);
    // Skip rows where BOTH Log Time and Log Type are empty.
    if (!s(logTimeRaw) && !logType) continue;

    const clientExternalId = s(row["Client ID"]);
    const startDate = parseDate(row["Contract Start Date"]);
    const contractKey =
      s(row["Key"]) ??
      (clientExternalId
        ? `${clientExternalId}|${(startDate ?? "").replace(/-/g, "")}`
        : null);
    if (!contractKey) {
      warnings.push(`Logs row ${i + 2}: missing contract key`);
      continue;
    }
    if (!logType) {
      warnings.push(`Logs row ${i + 2}: missing log type`);
      continue;
    }

    const snapshot: Record<string, unknown> = {};
    for (const name of LOG_SNAPSHOT_COLUMNS) {
      const value = row[name];
      if (value !== null && value !== undefined && value !== "") {
        snapshot[name] = value;
      }
    }

    logs.push({
      contractKey,
      clientExternalId,
      clientName: s(row["Client Name"]),
      accountManager: s(row["Account manager"]),
      logType,
      logTimeIso: parseLogTime(logTimeRaw),
      notes: s(row["Notes"]),
      snapshot,
    });
  }

  return { logs, warnings };
}
