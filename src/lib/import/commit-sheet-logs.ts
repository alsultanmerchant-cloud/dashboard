import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ParsedSheetLog } from "@/lib/import/excel-parser";
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
      "id, external_id, paid_value, total_value, repeated_services_value, next_contract_value",
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

  // Stage value backfills: a historical cycle (paid 0/null) recovers its real
  // amounts from its Close(Renew) snapshot. Keep the latest log per contract.
  const backfill = new Map<
    string,
    { paid: number; repeated: number | null; next: number | null; at: string }
  >();

  const rows = logs.map((log) => {
    const contractId = resolveContractId(log.contractKey, log.clientExternalId);
    if (contractId) {
      const snap = log.snapshot ?? {};
      const paid = snapNum(snap["Actual paid value"]);
      const contract = contractById.get(contractId);
      const needsValue =
        contract != null &&
        (contract.paid_value == null || contract.paid_value === 0);
      if (paid != null && needsValue) {
        const at = log.logTimeIso ?? "";
        const prev = backfill.get(contractId);
        if (!prev || at >= prev.at) {
          backfill.set(contractId, {
            paid,
            repeated: snapNum(snap[" Value of repeated services"]),
            next: snapNum(snap["Next Contract Value"]),
            at,
          });
        }
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

  // Backfill historical-cycle values from their renewal snapshots. Only touches
  // cycles still at 0/null, so the current cycle's real figures are never
  // clobbered. total_value falls back to paid for these closed cycles (their
  // Installments-tracker value isn't carried in the renewal log).
  await mapWithConcurrency([...backfill], 10, async ([contractId, v]) => {
    const c = contractById.get(contractId);
    if (!c) return;
    const patch: Record<string, number> = { paid_value: v.paid };
    if (c.total_value == null || c.total_value === 0) patch.total_value = v.paid;
    if ((c.repeated_services_value == null || c.repeated_services_value === 0) && v.repeated != null)
      patch.repeated_services_value = v.repeated;
    if ((c.next_contract_value == null || c.next_contract_value === 0) && v.next != null)
      patch.next_contract_value = v.next;
    const { error: upErr } = await supabaseAdmin
      .from("contracts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", contractId);
    if (upErr) errors.push(`backfill ${contractId}: ${upErr.message}`);
  });

  revalidatePath("/contracts");

  return {
    logsUpserted: error ? 0 : rows.length,
    errors,
  };
}
