import "server-only";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ParseResult } from "@/lib/import/excel-parser";
import { normName, diceRatio } from "@/lib/match/client-match";
import { mapWithConcurrency } from "@/lib/import/concurrency";

export const ACC_SHEET_SOURCE = "excel-acc-sheet";

export type ContractImportCommitResult = {
  clientsCreated: number;
  clientsUpdated: number;
  contractsUpserted: number;
  installmentsUpserted: number;
  errors: string[];
};

function splitPackageNames(packageName: string | null | undefined): string[] {
  if (!packageName) return [];
  const seen = new Set<string>();
  return packageName
    .split(/[,،]/)
    .map((p) => p.trim())
    .filter((p) => p !== "#")
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
}

function packageKeyForSheetName(name: string): string {
  if (name === "فيديو برومو") return "promo_video";
  return `sheet_${createHash("sha1").update(name).digest("hex").slice(0, 12)}`;
}

async function syncContractPackageLinks(contractId: string, packageIds: string[]) {
  const { error: deleteError } = await supabaseAdmin
    .from("contract_packages")
    .delete()
    .eq("contract_id", contractId);
  if (deleteError) throw deleteError;

  if (packageIds.length === 0) return;

  const { error: insertError } = await supabaseAdmin
    .from("contract_packages")
    .insert(
      packageIds.map((packageId, index) => ({
        contract_id: contractId,
        package_id: packageId,
        sort_order: index,
      })),
    );
  if (insertError) throw insertError;
}

async function restoreSheetParityFields(
  contractId: string,
  c: ParseResult["contracts"][number],
) {
  const { error } = await supabaseAdmin
    .from("contracts")
    .update({
      delay_days: c.delayDays,
      extension_days: c.extensionDays,
      total_days_computed: c.totalDaysComputed,
    })
    .eq("id", contractId);
  if (error) throw error;
}

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
    .select("id, key")
    .eq("organization_id", orgId);
  const typeIdByKey = new Map<string, string>();
  for (const t of types ?? []) {
    typeIdByKey.set(String(t.key), t.id);
  }

  const { data: packageRows } = await supabaseAdmin
    .from("packages")
    .select("id, name_ar")
    .eq("organization_id", orgId);
  const packageIdByName = new Map<string, string>();
  for (const p of packageRows ?? []) {
    if (p.name_ar) packageIdByName.set(String(p.name_ar).trim(), p.id);
  }

  const missingPackageNames = new Set<string>();
  for (const c of payload.contracts) {
    for (const name of splitPackageNames(c.packageName)) {
      if (!packageIdByName.has(name)) missingPackageNames.add(name);
    }
  }
  if (missingPackageNames.size > 0) {
    const { data: createdPackages, error } = await supabaseAdmin
      .from("packages")
      .upsert(
        [...missingPackageNames].map((name) => ({
          organization_id: orgId,
          key: packageKeyForSheetName(name),
          name_ar: name,
          active: true,
          grace_days: 5,
        })),
        { onConflict: "organization_id,key" },
      )
      .select("id, name_ar");
    if (error) {
      errors.push(`باقات جديدة من الشيت: ${error.message}`);
    } else {
      for (const p of createdPackages ?? []) {
        if (p.name_ar) packageIdByName.set(String(p.name_ar).trim(), p.id);
      }
    }
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

  await mapWithConcurrency(clientRows, 10, async (row) => {
    const existingId = existingClientMap.get(row.external_id);
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("clients")
        .update({ name: row.name })
        .eq("id", existingId);
      if (error) {
        errors.push(`عميل ${row.external_id}: ${error.message}`);
        return;
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
        return;
      }
      clientIdByExternal.set(row.external_id, data.id);
      clientsCreated++;
    }
  });

  let contractsUpserted = 0;
  const contractIdByExternalKey = new Map<string, string>();
  // contract external key → its type key, so installment rows can carry
  // source_type_key (Account vs Sales attribution for the income engine).
  const typeKeyByExternalKey = new Map<string, string>();

  const { data: existingContracts } = await supabaseAdmin
    .from("contracts")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", ACC_SHEET_SOURCE);
  const existingContractMap = new Map<string, string>();
  for (const r of existingContracts ?? []) {
    if (r.external_id) existingContractMap.set(String(r.external_id), r.id);
  }

  // Resolve each sheet "Account manager" name to an employee_profiles FK so the
  // contract carries account_manager_id (not just the free-text name) — the
  // dashboard's AM column reads through that FK, so without it the column shows
  // "—" even when the sheet names a manager. Exact normalized match first, with
  // a high-confidence Dice fallback for minor spelling variance.
  const { data: emps } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name")
    .eq("organization_id", orgId);
  const empByName = new Map<string, string>();
  const empList: { id: string; norm: string }[] = [];
  for (const e of emps ?? []) {
    const k = normName(String(e.full_name ?? ""));
    if (!k) continue;
    if (!empByName.has(k)) empByName.set(k, e.id);
    empList.push({ id: e.id, norm: k });
  }
  const resolveAmId = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const k = normName(name);
    if (!k) return null;
    const exact = empByName.get(k);
    if (exact) return exact;
    let best: { id: string; score: number } | null = null;
    let second = 0;
    for (const e of empList) {
      const score = diceRatio(k, e.norm);
      if (!best || score > best.score) {
        second = best?.score ?? 0;
        best = { id: e.id, score };
      } else if (score > second) {
        second = score;
      }
    }
    // Require a strong, unambiguous lead before trusting a fuzzy match.
    return best && best.score >= 0.85 && best.score - second >= 0.1
      ? best.id
      : null;
  };
  const amUnmatched = new Set<string>();

  await mapWithConcurrency(payload.contracts, 10, async (c) => {
    const clientUuid = clientIdByExternal.get(c.clientExternalId);
    if (!clientUuid) {
      errors.push(`عقد ${c.externalKey}: عميل مفقود`);
      return;
    }
    const typeId = c.contractTypeKey
      ? typeIdByKey.get(c.contractTypeKey) ?? null
      : null;
    if (c.contractTypeKey) {
      typeKeyByExternalKey.set(c.externalKey, c.contractTypeKey);
    }
    const packageIds = splitPackageNames(c.packageName)
      .map((name) => packageIdByName.get(name))
      .filter((id): id is string => !!id);

    const accountManagerId = resolveAmId(c.accountManagerName);
    if (c.accountManagerName && !accountManagerId) {
      amUnmatched.add(c.accountManagerName);
    }

    const row = {
      organization_id: orgId,
      client_id: clientUuid,
      sheet_client_name: c.clientName,
      contract_type_id: typeId,
      account_manager_name: c.accountManagerName,
      // Only write the FK when we resolved one. On the update path, writing null
      // for an unmatched sheet name would clobber a manually-assigned manager.
      ...(accountManagerId ? { account_manager_id: accountManagerId } : {}),
      package_id: packageIds[0] ?? null,
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
      // Every row in this pull is, by definition, present in the sheet. Stale
      // rows (no longer in the sheet) are flipped to false after the loop.
      sheet_present: true,
    };

    const existingId = existingContractMap.get(c.externalKey);
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("contracts")
        .update(row)
        .eq("id", existingId);
      if (error) {
        errors.push(`عقد ${c.externalKey}: ${error.message}`);
        return;
      }
      contractIdByExternalKey.set(c.externalKey, existingId);
      try {
        await restoreSheetParityFields(existingId, c);
      } catch (error) {
        errors.push(`حقول الشيت لعقد ${c.externalKey}: ${(error as Error).message}`);
        return;
      }
      try {
        await syncContractPackageLinks(existingId, packageIds);
      } catch (error) {
        errors.push(`باقات عقد ${c.externalKey}: ${(error as Error).message}`);
        return;
      }
    } else {
      const { data, error } = await supabaseAdmin
        .from("contracts")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) {
        errors.push(`عقد ${c.externalKey}: ${error?.message ?? "insert failed"}`);
        return;
      }
      contractIdByExternalKey.set(c.externalKey, data.id);
      try {
        await restoreSheetParityFields(data.id, c);
      } catch (error) {
        errors.push(`حقول الشيت لعقد ${c.externalKey}: ${(error as Error).message}`);
        return;
      }
      try {
        await syncContractPackageLinks(data.id, packageIds);
      } catch (error) {
        errors.push(`باقات عقد ${c.externalKey}: ${(error as Error).message}`);
        return;
      }
    }
    contractsUpserted++;
  });

  if (amUnmatched.size > 0) {
    errors.push(
      `مدراء حسابات لم تتم مطابقتهم بموظف: ${[...amUnmatched].join("، ")}`,
    );
  }

  // Reconcile sheet membership. Contracts previously synced from the sheet but
  // absent from this pull (e.g. a pre-renewal version whose Client ID|start_date
  // key was overwritten when the client renewed) are flagged sheet_present=false
  // so the sheet-parity grid hides them. They stay in the DB for history.
  const staleKeys = [...existingContractMap.keys()].filter(
    (k) => !contractIdByExternalKey.has(k),
  );
  if (staleKeys.length > 0) {
    const { error } = await supabaseAdmin
      .from("contracts")
      .update({ sheet_present: false })
      .eq("organization_id", orgId)
      .eq("external_source", ACC_SHEET_SOURCE)
      .in("external_id", staleKeys);
    if (error) errors.push(`أرشفة العقود غير الموجودة بالشيت: ${error.message}`);
  }

  let installmentsUpserted = 0;
  const today = new Date().toISOString().slice(0, 10);

  // Build every installment row first, then write them in one bulk upsert. The
  // unique (contract_id, sequence) constraint makes a single round-trip safe and
  // replaces what was up to ~5 sequential upserts per contract.
  const installmentRows = [];
  for (const inst of payload.installments) {
    const contractUuid = contractIdByExternalKey.get(inst.contractExternalKey);
    if (!contractUuid) {
      errors.push(`دفعة لعقد ${inst.contractExternalKey}: عقد مفقود`);
      continue;
    }

    const status =
      inst.actualAmount > 0
        ? inst.actualAmount >= inst.expectedAmount ? "received" : "partial"
        : inst.expectedDate && inst.expectedDate < today
          ? "overdue"
          : "pending";

    installmentRows.push({
      organization_id: orgId,
      contract_id: contractUuid,
      sequence: inst.sequence,
      expected_date: inst.expectedDate ?? today,
      expected_amount: inst.expectedAmount,
      actual_date: inst.actualDate,
      actual_amount: inst.actualAmount > 0 ? inst.actualAmount : null,
      source_type_key: typeKeyByExternalKey.get(inst.contractExternalKey) ?? null,
      status,
    });
  }

  if (installmentRows.length > 0) {
    const { error } = await supabaseAdmin
      .from("installments")
      .upsert(installmentRows, { onConflict: "contract_id,sequence" });
    if (error) {
      errors.push(`الدفعات: ${error.message}`);
    } else {
      installmentsUpserted = installmentRows.length;
    }
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
