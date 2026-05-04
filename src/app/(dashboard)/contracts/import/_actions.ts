"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { parseAccSheet, type ParseResult } from "@/lib/import/excel-parser";

const SOURCE = "excel-acc-sheet";

export type ImportPreviewState =
  | { kind: "idle" }
  | { kind: "error"; error: string }
  | { kind: "preview"; payload: ParseResult };

/** Reads the uploaded file, parses it, and returns a preview without writing. */
export async function previewImportAction(
  _prev: ImportPreviewState | undefined,
  formData: FormData,
): Promise<ImportPreviewState> {
  try {
    await requirePermission("contract.manage");
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { kind: "error", error: "اختر ملف Excel أولاً" };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { kind: "error", error: "حجم الملف يتجاوز 20 ميجابايت" };
  }

  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return { kind: "error", error: "تعذر قراءة الملف" };
  }

  let payload: ParseResult;
  try {
    payload = parseAccSheet(buf);
  } catch (e) {
    return { kind: "error", error: `فشل تحليل الملف: ${(e as Error).message}` };
  }

  if (payload.contracts.length === 0) {
    return {
      kind: "error",
      error: "لم يتم العثور على عقود صالحة. تأكد من أن الورقة تحتوي على عمود Client ID وقيم تبدأ بـ C.",
    };
  }

  return { kind: "preview", payload };
}

export type ImportCommitState =
  | { kind: "idle" }
  | { kind: "error"; error: string }
  | {
      kind: "ok";
      clientsCreated: number;
      clientsUpdated: number;
      contractsUpserted: number;
      installmentsUpserted: number;
      errors: string[];
    };

/**
 * Commit the parsed payload to Supabase.
 *
 * The payload is sent back from the client as JSON in a hidden form field
 * (so we don't re-upload + re-parse the file). It's bounded to ~1500 rows
 * total which keeps the form-data size well under Next.js limits.
 */
export async function commitImportAction(
  _prev: ImportCommitState | undefined,
  formData: FormData,
): Promise<ImportCommitState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }

  const raw = formData.get("payload");
  if (typeof raw !== "string" || !raw) {
    return { kind: "error", error: "بيانات الاستيراد مفقودة" };
  }
  let payload: ParseResult;
  try {
    payload = JSON.parse(raw) as ParseResult;
  } catch {
    return { kind: "error", error: "تعذر قراءة بيانات الاستيراد" };
  }

  const errors: string[] = [];

  // ── Step 1: Pre-load contract types so we can resolve type → id ───
  const { data: types } = await supabaseAdmin
    .from("contract_types")
    .select("id, key");
  const typeIdByKey = new Map<string, string>();
  for (const t of types ?? []) {
    typeIdByKey.set(String(t.key), t.id);
  }

  // ── Step 2: Upsert clients ─────────────────────────────────────────
  const clientRows = payload.clients.map((c) => ({
    organization_id: session.orgId,
    name: c.name,
    external_source: SOURCE,
    external_id: c.externalId,
    status: "active",
  }));

  let clientsCreated = 0;
  let clientsUpdated = 0;
  const clientIdByExternal = new Map<string, string>();

  // Hydrate existing
  const { data: existingClients } = await supabaseAdmin
    .from("clients")
    .select("id, external_id")
    .eq("organization_id", session.orgId)
    .eq("external_source", SOURCE);
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

  // ── Step 3: Upsert contracts ──────────────────────────────────────
  let contractsUpserted = 0;
  const contractIdByExternalKey = new Map<string, string>();

  // Hydrate existing contracts by external_id
  const { data: existingContracts } = await supabaseAdmin
    .from("contracts")
    .select("id, external_id")
    .eq("organization_id", session.orgId)
    .eq("external_source", SOURCE);
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
      organization_id: session.orgId,
      client_id: clientUuid,
      contract_type_id: typeId,
      account_manager_name: c.accountManagerName,
      package_name: c.packageName,
      start_date: c.startDate,
      end_date: c.endDate,
      duration_months: c.durationMonths,
      total_value: c.totalValue,
      paid_value: c.paidValue,
      target: c.target,
      status: c.status,
      contract_status_label: c.statusLabel,
      notes: c.notes,
      external_source: SOURCE,
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

  // ── Step 4: Upsert installments ──────────────────────────────────
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
      organization_id: session.orgId,
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

  // Audit
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "contracts.import_excel",
    entityType: "import",
    entityId: SOURCE,
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
    kind: "ok",
    clientsCreated,
    clientsUpdated,
    contractsUpserted,
    installmentsUpserted,
    errors: errors.slice(0, 50),
  };
}
