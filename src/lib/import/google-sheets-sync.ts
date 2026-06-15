import "server-only";

import { createPrivateKey, sign } from "node:crypto";
import * as XLSX from "xlsx";
import { parseAccSheet, parseLogsSheet } from "@/lib/import/excel-parser";
import { commitSheetLogs } from "@/lib/import/commit-sheet-logs";
import {
  commitContractImportPayload,
  type ContractImportCommitResult,
} from "@/lib/import/commit-contract-import";
import {
  parseSheetDashboard,
  type Aoa,
} from "@/lib/import/parse-sheet-dashboard";
import {
  commitSheetDashboard,
  type SheetDashboardCommitResult,
} from "@/lib/import/commit-sheet-dashboard";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VALUES_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const CLIENTS_CONTRACTS_SHEET = "Clients Contracts";
const INSTALLMENTS_SHEET = "💲Installments Tracker";
const LOGS_SHEET = "Logs";
// The sheet's pre-computed dashboard tabs (parity source for the CEO numbers).
const CEO_SHEET = "CEO_Dashboared";
const TARGET_CONTRACTS_SHEET = "TARGET_CONTRACTS";
const ACC_BREAKDOWN_SHEET = "Acc_Target_Breakdown";
const DEFAULT_CONTRACTS_GID = "395145863";
const DEFAULT_LOGS_GID = "1221711550";
const DEFAULT_INSTALLMENTS_GID = "1424000307";
const DEFAULT_CEO_GID = "1435052881";
const DEFAULT_TARGET_CONTRACTS_GID = "521452760";
const DEFAULT_ACC_BREAKDOWN_GID = "455085356";
// The computed tabs are padded to tens of thousands of empty rows; the data
// lives in the top corner. Bound the read so we never pull megabytes of commas.
const CEO_RANGE = "A1:AS80";
const TARGET_CONTRACTS_RANGE = "A1:Y250";
const ACC_BREAKDOWN_RANGE = "A1:S120";

export type GoogleSheetSyncResult = ContractImportCommitResult & {
  spreadsheetId: string;
  parsedClients: number;
  parsedContracts: number;
  parsedInstallments: number;
  parsedLogs: number;
  logsUpserted: number;
  dashboard: SheetDashboardCommitResult | null;
  warnings: string[];
};

type SheetConfig = {
  spreadsheetId: string;
  contractsGid: string;
  installmentsGid: string | null;
  logsGid: string;
  ceoGid: string;
  targetContractsGid: string;
  accBreakdownGid: string;
  clientEmail: string | null;
  privateKey: string | null;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getGoogleSheetConfig(): SheetConfig {
  const spreadsheetId = process.env.CONTRACTS_GOOGLE_SHEET_ID;
  const contractsGid = process.env.CONTRACTS_GOOGLE_CONTRACTS_GID || DEFAULT_CONTRACTS_GID;
  const installmentsGid =
    process.env.CONTRACTS_GOOGLE_INSTALLMENTS_GID || DEFAULT_INSTALLMENTS_GID;
  const logsGid = process.env.CONTRACTS_GOOGLE_LOGS_GID || DEFAULT_LOGS_GID;
  const ceoGid = process.env.CONTRACTS_GOOGLE_CEO_GID || DEFAULT_CEO_GID;
  const targetContractsGid =
    process.env.CONTRACTS_GOOGLE_TARGET_CONTRACTS_GID || DEFAULT_TARGET_CONTRACTS_GID;
  const accBreakdownGid =
    process.env.CONTRACTS_GOOGLE_ACC_BREAKDOWN_GID || DEFAULT_ACC_BREAKDOWN_GID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!spreadsheetId) {
    throw new Error(
      "Google Sheet sync is not configured. Set CONTRACTS_GOOGLE_SHEET_ID.",
    );
  }
  return {
    spreadsheetId,
    contractsGid,
    installmentsGid,
    logsGid,
    ceoGid,
    targetContractsGid,
    accBreakdownGid,
    clientEmail: clientEmail || null,
    privateKey: rawPrivateKey ? rawPrivateKey.replace(/\\n/g, "\n") : null,
  };
}

async function getAccessToken(config: SheetConfig): Promise<string> {
  if (!config.clientEmail || !config.privateKey) {
    throw new Error("Private Google Sheet sync requires GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: config.clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const key = createPrivateKey(config.privateKey);
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Failed to authenticate with Google Sheets");
  }
  return json.access_token;
}

async function fetchSheetValues({
  spreadsheetId,
  accessToken,
  sheetName,
  a1Range,
}: {
  spreadsheetId: string;
  accessToken: string;
  sheetName: string;
  a1Range?: string;
}): Promise<unknown[][]> {
  const rangeRef = a1Range ? `'${sheetName}'!${a1Range}` : `'${sheetName}'`;
  const range = encodeURIComponent(rangeRef);
  const res = await fetch(`${VALUES_URL}/${spreadsheetId}/values/${range}?majorDimension=ROWS`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await res.json()) as {
    values?: unknown[][];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Failed to read Google Sheet tab: ${sheetName}`);
  }
  return json.values ?? [];
}

// Download the whole public workbook as XLSX. This is the source for the public
// path: unlike per-tab CSV/gviz exports it preserves date typing (so parseDate
// sees real dates, not a lossy "M/D/YY") AND merged-cell values (the CEO/target
// tabs are heavily merged — gviz/CSV return null for every merged secondary
// cell, which silently blanks "Jun"/"On Target"/etc).
async function fetchPublicWorkbook(spreadsheetId: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`,
    { cache: "no-store", signal: AbortSignal.timeout(60000) },
  );
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    throw new Error(`Public Google Sheet xlsx export failed with HTTP ${res.status}.`);
  }
  if (!contentType.includes("spreadsheetml") && !contentType.includes("octet-stream")) {
    throw new Error("Google did not return an XLSX export. Make the sheet public, or configure service-account credentials.");
  }
  return res.arrayBuffer();
}

function workbookTabAoa(buf: ArrayBuffer, name: string): Aoa {
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: false,
  });
}

function valuesToWorkbookBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export async function syncContractsFromGoogleSheet({
  orgId,
  actorUserId,
  auditAction,
}: {
  orgId: string;
  actorUserId?: string | null;
  auditAction: string;
}): Promise<GoogleSheetSyncResult> {
  const config = getGoogleSheetConfig();
  let workbookBuffer: ArrayBuffer;
  const warnings: string[] = [];
  // For the public sheet, one XLSX export carries every tab (raw + computed) with
  // correct date typing and merged-cell values. parseAccSheet/parseLogsSheet read
  // "Clients Contracts" / "💲Installments Tracker" / "Edits  Updates log" by name.
  let publicWorkbook: ArrayBuffer | null = null;
  if (!config.clientEmail || !config.privateKey) {
    publicWorkbook = await fetchPublicWorkbook(config.spreadsheetId);
    workbookBuffer = publicWorkbook;
  } else {
    const accessToken = await getAccessToken(config);
    const [clientsContractsRows, installmentsRows] = await Promise.all([
      fetchSheetValues({
        spreadsheetId: config.spreadsheetId,
        accessToken,
        sheetName: CLIENTS_CONTRACTS_SHEET,
      }),
      fetchSheetValues({
        spreadsheetId: config.spreadsheetId,
        accessToken,
        sheetName: INSTALLMENTS_SHEET,
      }),
    ]);

    const privateSheets: Record<string, unknown[][]> = {
      [CLIENTS_CONTRACTS_SHEET]: clientsContractsRows,
      [INSTALLMENTS_SHEET]: installmentsRows,
    };
    try {
      privateSheets[LOGS_SHEET] = await fetchSheetValues({
        spreadsheetId: config.spreadsheetId,
        accessToken,
        sheetName: LOGS_SHEET,
      });
    } catch (e) {
      warnings.push(`Logs sheet sync skipped: ${(e as Error).message}`);
    }
    workbookBuffer = valuesToWorkbookBuffer(privateSheets);
  }
  const payload = parseAccSheet(workbookBuffer);
  if (payload.contracts.length === 0) {
    throw new Error("Google Sheet sync found no valid contract rows.");
  }

  const result = await commitContractImportPayload({
    payload,
    orgId,
    actorUserId: actorUserId ?? null,
    auditAction,
  });

  let parsedLogs = 0;
  let logsUpserted = 0;
  try {
    const logsPayload = parseLogsSheet(workbookBuffer);
    parsedLogs = logsPayload.logs.length;
    warnings.push(...logsPayload.warnings);
    const logsResult = await commitSheetLogs({
      logs: logsPayload.logs,
      orgId,
    });
    logsUpserted = logsResult.logsUpserted;
    warnings.push(...logsResult.errors);
  } catch (e) {
    warnings.push(`Logs sheet sync skipped: ${(e as Error).message}`);
  }

  // Pre-computed dashboard tabs — captured AFTER contracts are upserted so the
  // bucket Key → contract id mapping resolves. Non-fatal: a failure here leaves
  // the raw sync intact and the dashboard falls back to its live recompute.
  let dashboard: SheetDashboardCommitResult | null = null;
  try {
    let ceo: Aoa;
    let target: Aoa;
    let accBreak: Aoa;
    if (publicWorkbook) {
      ceo = workbookTabAoa(publicWorkbook, CEO_SHEET);
      target = workbookTabAoa(publicWorkbook, TARGET_CONTRACTS_SHEET);
      accBreak = workbookTabAoa(publicWorkbook, ACC_BREAKDOWN_SHEET);
    } else {
      const accessToken = await getAccessToken(config);
      [ceo, target, accBreak] = await Promise.all([
        fetchSheetValues({ spreadsheetId: config.spreadsheetId, accessToken, sheetName: CEO_SHEET, a1Range: CEO_RANGE }),
        fetchSheetValues({ spreadsheetId: config.spreadsheetId, accessToken, sheetName: TARGET_CONTRACTS_SHEET, a1Range: TARGET_CONTRACTS_RANGE }),
        fetchSheetValues({ spreadsheetId: config.spreadsheetId, accessToken, sheetName: ACC_BREAKDOWN_SHEET, a1Range: ACC_BREAKDOWN_RANGE }),
      ]);
    }
    const parsed = parseSheetDashboard({ ceo, target, accBreak });
    warnings.push(...parsed.warnings);
    dashboard = await commitSheetDashboard({ parse: parsed, orgId });
    warnings.push(...dashboard.errors);
    if (dashboard.amUnmatched.length > 0) {
      warnings.push(`أكونت غير مطابقين في تبويب التارجت: ${dashboard.amUnmatched.join("، ")}`);
    }
  } catch (e) {
    warnings.push(`Dashboard tabs sync skipped: ${(e as Error).message}`);
  }

  return {
    ...result,
    spreadsheetId: config.spreadsheetId,
    parsedClients: payload.clients.length,
    parsedContracts: payload.contracts.length,
    parsedInstallments: payload.installments.length,
    parsedLogs,
    logsUpserted,
    dashboard,
    warnings: [...payload.warnings, ...warnings],
  };
}
