import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ParsedSheetLog } from "@/lib/import/excel-parser";
import { ACC_SHEET_SOURCE } from "./commit-contract-import";

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
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", ACC_SHEET_SOURCE);
  if (contractsError) {
    return {
      logsUpserted: 0,
      errors: [contractsError.message],
    };
  }

  const contractIdByExternalId = new Map<string, string>();
  for (const contract of contracts ?? []) {
    if (contract.external_id) {
      contractIdByExternalId.set(String(contract.external_id), contract.id);
    }
  }

  const rows = logs.map((log) => ({
    organization_id: orgId,
    contract_key: log.contractKey,
    contract_id: contractIdByExternalId.get(log.contractKey) ?? null,
    client_external_id: log.clientExternalId,
    client_name: log.clientName,
    account_manager: log.accountManager,
    log_type: log.logType,
    log_time: log.logTimeIso,
    notes: log.notes,
    snapshot: log.snapshot,
  }));

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

  revalidatePath("/contracts");

  return {
    logsUpserted: error ? 0 : rows.length,
    errors,
  };
}
