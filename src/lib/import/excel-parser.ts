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
  paidValue: number;
  target: string | null;
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
  if (typeKey === "Hold") return "hold";
  if (!raw) return "active";
  const k = raw.toLowerCase().trim();
  return STATUS_MAP[k] ?? "active";
}

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
    const contractTypeKey = mapContractType(contractTypeRaw);
    const startDate = parseDate(r["Contract Start Date"]);
    const endDate = parseDate(r["Expected End Date"]);
    const actualEndDate = parseDate(r["Actual End Date"]);
    const target = s(r["Target"]);
    const statusLabel = s(r["Contract Status"]);
    const status = mapStatus(statusLabel, contractTypeKey);
    const totalValue = num(r["Next Contract Value"]) || num(r[" Value of repeated services"]);
    const paidValue = num(r["Actual Paid for renewal"]) || num(r["Actual paid value"]);
    const durationRaw = num(r["C.Duration (Months)"]);
    const durationMonths = durationRaw > 0 ? Math.round(durationRaw) : null;
    const packageName = s(r["Package"]);
    const notes = [s(r["Notes"]), s(r["ملاحظات"])].filter(Boolean).join(" — ") || null;

    const externalKey = key ?? `${clientId}|${(startDate ?? "").replace(/-/g, "")}`;

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
      target,
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
  type ITRow = Record<string, unknown>;
  const itRows = itSheet
    ? (XLSX.utils.sheet_to_json<ITRow>(itSheet, { defval: null, raw: false }) as ITRow[])
    : [];

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
