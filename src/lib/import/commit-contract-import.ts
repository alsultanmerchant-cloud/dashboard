import "server-only";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ParseResult } from "@/lib/import/excel-parser";

export const ACC_SHEET_SOURCE = "excel-acc-sheet";

export type ContractImportCommitResult = {
  clientsCreated: number;
  clientsUpdated: number;
  contractsUpserted: number;
  installmentsUpserted: number;
  errors: string[];
};

export async function commitContractImportPayload({
  payload,
  orgId,
  actorUserId,
  auditAction,
}: {
  payload: ParseResult;
  orgId: string;
  actorUserId?: string | null;
  auditAction: string;
}): Promise<ContractImportCommitResult> {
  const errors: string[] = [];

  const { data: types } = await supabaseAdmin
    .from("contract_types")
    .select("id, key");
  const typeIdByKey = new Map<string, string>();
  for (const t of types ?? []) {
    typeIdByKey.set(String(t.key), t.id);
  }

  const clientRows = payload.clients.map((c) => ({
    organization_id: orgId,
    name: c.name,
    external_source: ACC_SHEET_SOURCE,
    external_id: c.externalId,
    status: "active",
  }));

  let clientsCreated = 0;
  let clientsUpdated = 0;
  const clientIdByExternal = new Map<string, string>();

  const { data: existingClients } = await supabaseAdmin
    .from("clients")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", ACC_SHEET_SOURCE);
  const existingClientMap = new Map<string, string>();
  for (const r of existingClients ?? []) {
    if (r.external_id) existingClientMap.set(String(r.external_id), r.id);
  }

  for (const row of clientRows) {
    const existingId = existingClientMap.get(row.external_id);
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("clients")
        .update({ name: row.name })
        .eq("id", existingId);
      if (error) {
        errors.push(`عميل ${row.external_id}: ${error.message}`);
        continue;
      }
      clientIdByExternal.set(row.external_id, existingId);
      clientsUpdated++;
    } else {
      const { data, error } = await supabaseAdmin
        .from("clients")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) {
        errors.push(`عميل ${row.external_id}: ${error?.message ?? "insert failed"}`);
        continue;
      }
      clientIdByExternal.set(row.external_id, data.id);
      clientsCreated++;
    }
  }

  let contractsUpserted = 0;
  const contractIdByExternalKey = new Map<string, string>();

  const { data: existingContracts } = await supabaseAdmin
    .from("contracts")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", ACC_SHEET_SOURCE);
  const existingContractMap = new Map<string, string>();
  for (const r of existingContracts ?? []) {
    if (r.external_id) existingContractMap.set(String(r.external_id), r.id);
  }

  for (const c of payload.contracts) {
    const clientUuid = clientIdByExternal.get(c.clientExternalId);
    if (!clientUuid) {
      errors.push(`عقد ${c.externalKey}: عميل مفقود`);
      continue;
    }
    const typeId = c.contractTypeKey
      ? typeIdByKey.get(c.contractTypeKey) ?? null
      : null;

    const row = {
      organization_id: orgId,
      client_id: clientUuid,
      contract_type_id: typeId,
      account_manager_name: c.accountManagerName,
      package_name: c.packageName,
      start_date: c.startDate,
      end_date: c.endDate,
      duration_months: c.durationMonths,
      total_value: c.totalValue,
      paid_value: c.paidValue,
      repeated_services_value: c.repeatedServicesValue,
      next_contract_value: c.nextContractValue,
      renewal_paid_value: c.renewalPaidValue,
      payment_status: c.paymentStatus,
      renewed_status: c.renewedStatus,
      delay_days: c.delayDays,
      extension_days: c.extensionDays,
      total_days_computed: c.totalDaysComputed,
      target: c.target,
      target_by_month: c.targetByMonth,
      status: c.status,
      contract_status_label: c.statusLabel,
      notes: c.notes,
      external_source: ACC_SHEET_SOURCE,
      external_id: c.externalKey,
    };

    const existingId = existingContractMap.get(c.externalKey);
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("contracts")
        .update(row)
        .eq("id", existingId);
      if (error) {
        errors.push(`عقد ${c.externalKey}: ${error.message}`);
        continue;
      }
      contractIdByExternalKey.set(c.externalKey, existingId);
    } else {
      const { data, error } = await supabaseAdmin
        .from("contracts")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) {
        errors.push(`عقد ${c.externalKey}: ${error?.message ?? "insert failed"}`);
        continue;
      }
      contractIdByExternalKey.set(c.externalKey, data.id);
    }
    contractsUpserted++;
  }

  let installmentsUpserted = 0;

  for (const inst of payload.installments) {
    const contractUuid = contractIdByExternalKey.get(inst.contractExternalKey);
    if (!contractUuid) {
      errors.push(`دفعة لعقد ${inst.contractExternalKey}: عقد مفقود`);
      continue;
    }

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

    const { error } = await supabaseAdmin
      .from("installments")
      .upsert(row, { onConflict: "contract_id,sequence" });
    if (error) {
      errors.push(`دفعة ${inst.contractExternalKey}#${inst.sequence}: ${error.message}`);
      continue;
    }
    installmentsUpserted++;
  }

  await logAudit({
    organizationId: orgId,
    actorUserId: actorUserId ?? null,
    action: auditAction,
    entityType: "import",
    entityId: ACC_SHEET_SOURCE,
    metadata: {
      clientsCreated,
      clientsUpdated,
      contractsUpserted,
      installmentsUpserted,
      errorCount: errors.length,
    },
  });

  revalidatePath("/finance");
  revalidatePath("/contracts");
  revalidatePath("/clients");

  return {
    clientsCreated,
    clientsUpdated,
    contractsUpserted,
    installmentsUpserted,
    errors: errors.slice(0, 50),
  };
}
