import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  type ParsedSheetLog,
  normalizePaymentStatus,
  parseDate,
} from "@/lib/import/excel-parser";
import { ACC_SHEET_SOURCE } from "./commit-contract-import";
import { mapWithConcurrency } from "@/lib/import/concurrency";

// `ClientID|YYYYMMDD` → days-since-epoch, for nearest-cycle matching. Returns
// null for keys we can't parse (no `|`, non-8-digit date).
function keyToDays(ymd: string | undefined): number | null {
  if (!ymd || !/^\d{8}$/.test(ymd)) return null;
  const y = +ymd.slice(0, 4);
  const m = +ymd.slice(4, 6);
  const d = +ymd.slice(6, 8);
  const t = Date.UTC(y, m - 1, d);
  return Number.isFinite(t) ? t / 86_400_000 : null;
}

function snapNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Like snapNum but rounds to an int and PRESERVES zero — a 0-day delay on a
// closed cycle ("On Target") is real data, not a blank.
function snapInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function commitSheetLogs({
  logs,
  orgId,
}: {
  logs: ParsedSheetLog[];
  orgId: string;
}): Promise<{ logsUpserted: number; errors: string[] }> {
  const errors: string[] = [];

  const { data: contracts, error: contractsError } = await supabaseAdmin
    .from("contracts")
    .select(
      "id, external_id, paid_value, total_value, repeated_services_value, next_contract_value, end_date, duration_months, payment_status, delay_days, account_manager_name, sheet_present",
    )
    .eq("organization_id", orgId)
    .eq("external_source", ACC_SHEET_SOURCE);
  if (contractsError) {
    return {
      logsUpserted: 0,
      errors: [contractsError.message],
    };
  }

  type ContractRow = {
    id: string;
    external_id: string | null;
    paid_value: number | null;
    total_value: number | null;
    repeated_services_value: number | null;
    next_contract_value: number | null;
    end_date: string | null;
    duration_months: number | null;
    payment_status: string | null;
    delay_days: number | null;
    account_manager_name: string | null;
    sheet_present: boolean | null;
  };
  const contractById = new Map<string, ContractRow>();
  const contractIdByExternalId = new Map<string, string>();
  // Per-client renewal cycles, so a log whose date key doesn't match any
  // contract exactly can still be attached to the nearest cycle. The sheet's
  // "Edits/Updates" tab and "Client's Contracts" tab enter each cycle's start
  // date independently and they drift by a few days (e.g. log C27|20260130 vs
  // contract C27|20260128), which breaks the exact-key join.
  const cyclesByClient = new Map<string, { id: string; days: number }[]>();
  for (const c of (contracts ?? []) as ContractRow[]) {
    contractById.set(c.id, c);
    const ext = String(c.external_id ?? "");
    if (c.external_id) contractIdByExternalId.set(ext, c.id);
    const [clientExt, ymd] = ext.split("|");
    const days = keyToDays(ymd);
    if (!clientExt || days == null) continue;
    const arr = cyclesByClient.get(clientExt) ?? [];
    arr.push({ id: c.id, days });
    cyclesByClient.set(clientExt, arr);
  }

  // Exact key first; else the same client's contract cycle with the nearest
  // start date (tolerance 31d — cycles are months apart, so the correct one is
  // unambiguously closest while still absorbing the few-days tab drift).
  const resolveContractId = (
    contractKey: string,
    clientExternalId: string | null,
  ): string | null => {
    const exact = contractIdByExternalId.get(contractKey);
    if (exact) return exact;
    const [keyClient, ymd] = contractKey.split("|");
    const clientExt = clientExternalId ?? keyClient;
    const logDays = keyToDays(ymd);
    if (!clientExt || logDays == null) return null;
    const cycles = cyclesByClient.get(clientExt);
    if (!cycles?.length) return null;
    let best: { id: string; diff: number } | null = null;
    for (const cyc of cycles) {
      const diff = Math.abs(cyc.days - logDays);
      if (!best || diff < best.diff) best = { id: cyc.id, diff };
    }
    return best && best.diff <= 31 ? best.id : null;
  };

  // Stage backfills: a reconstructed historical cycle (one that is NOT a live
  // "Clients Contracts" row) recovers its real figures from its Close(Renew)
  // snapshot — money AND the descriptive fields the live row would carry
  // (end date, duration, payment status, delays, account manager). Keep the
  // latest log per contract; the per-field null-guards in the patch loop below
  // decide what actually gets written.
  const backfill = new Map<
    string,
    { snap: Record<string, unknown>; accountManager: string | null; at: string }
  >();

  const rows = logs.map((log) => {
    const contractId = resolveContractId(log.contractKey, log.clientExternalId);
    if (contractId) {
      const at = log.logTimeIso ?? "";
      const prev = backfill.get(contractId);
      if (!prev || at >= prev.at) {
        backfill.set(contractId, {
          snap: log.snapshot ?? {},
          accountManager: log.accountManager,
          at,
        });
      }
    }
    return {
      organization_id: orgId,
      contract_key: log.contractKey,
      contract_id: contractId,
      client_external_id: log.clientExternalId,
      client_name: log.clientName,
      account_manager: log.accountManager,
      log_type: log.logType,
      log_time: log.logTimeIso,
      notes: log.notes,
      snapshot: log.snapshot,
    };
  });

  if (rows.length === 0) {
    revalidatePath("/contracts");
    return { logsUpserted: 0, errors };
  }

  const { error } = await supabaseAdmin
    .from("contract_sheet_logs")
    .upsert(rows, {
      onConflict: "organization_id,contract_key,log_type,log_time",
    });
  if (error) {
    errors.push(error.message);
  }

  // Backfill historical-cycle fields from their renewal snapshots. Gated to
  // reconstructed cycles (sheet_present = false): a live "Clients Contracts"
  // row already carries authoritative values from the sheet, so it is never
  // touched. Every field is written ONLY when currently blank, so a re-sync is
  // idempotent and can never clobber a real value. The descriptive fields
  // (end_date/duration/payment_status/delay_days/AM) used to be dropped even
  // though the close-log snapshot carries them — this recovers them.
  await mapWithConcurrency([...backfill], 10, async ([contractId, v]) => {
    const c = contractById.get(contractId);
    if (!c || c.sheet_present) return;
    const snap = v.snap;
    const patch: Record<string, unknown> = {};

    // ── money (total_value falls back to paid for these closed cycles, whose
    //    Installments-tracker value isn't carried in the renewal log) ──
    const paid = snapNum(snap["Actual paid value"]);
    if (paid != null) {
      if (c.paid_value == null || c.paid_value === 0) patch.paid_value = paid;
      if (c.total_value == null || c.total_value === 0) patch.total_value = paid;
    }
    const repeated = snapNum(snap[" Value of repeated services"]);
    if (repeated != null && (c.repeated_services_value == null || c.repeated_services_value === 0))
      patch.repeated_services_value = repeated;
    const next = snapNum(snap["Next Contract Value"]);
    if (next != null && (c.next_contract_value == null || c.next_contract_value === 0))
      patch.next_contract_value = next;

    // ── descriptive fields from the Close(Renew) snapshot ──
    if (c.end_date == null) {
      const end =
        parseDate(snap["Actual End Date"]) ?? parseDate(snap["Expected End Date"]);
      if (end) patch.end_date = end;
    }
    if (c.duration_months == null) {
      const dur = snapInt(snap["C.Duration (Months)"]);
      if (dur != null && dur > 0) patch.duration_months = dur;
    }
    if (c.payment_status == null && snap["payment status"] != null) {
      const ps = normalizePaymentStatus(String(snap["payment status"]));
      if (ps) patch.payment_status = ps;
    }
    if (c.delay_days == null) {
      const delay = snapInt(snap["Delays\n (working days)"]);
      if (delay != null) patch.delay_days = delay;
    }
    if (c.account_manager_name == null && v.accountManager) {
      patch.account_manager_name = v.accountManager;
    }

    if (Object.keys(patch).length === 0) return;
    patch.updated_at = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("contracts")
      .update(patch)
      .eq("id", contractId);
    if (upErr) errors.push(`backfill ${contractId}: ${upErr.message}`);
  });

  revalidatePath("/contracts");

  return {
    logsUpserted: error ? 0 : rows.length,
    errors,
  };
}
