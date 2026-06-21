"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { parseAccSheet, type ParseResult } from "@/lib/import/excel-parser";
import { commitContractImportPayload } from "@/lib/import/commit-contract-import";
import {
  syncContractsFromGoogleSheet,
  syncSingleClientFromGoogleSheet,
} from "@/lib/import/google-sheets-sync";

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

  const result = await commitContractImportPayload({
    payload,
    orgId: session.orgId,
    actorUserId: session.userId,
    auditAction: "contracts.import_excel",
  });

  return {
    kind: "ok",
    ...result,
  };
}

export type GoogleSheetSyncState =
  | { kind: "idle" }
  | { kind: "error"; error: string }
  | {
      kind: "ok";
      clientsCreated: number;
      clientsUpdated: number;
      contractsUpserted: number;
      installmentsUpserted: number;
      errors: string[];
      parsedClients: number;
      parsedContracts: number;
      parsedInstallments: number;
      parsedLogs: number;
      logsUpserted: number;
      dashboardMonth: string | null;
      dashboardOnTarget: number | null;
      dashboardBuckets: number;
      warnings: string[];
    };

export async function syncGoogleSheetAction(
  _prev: GoogleSheetSyncState | undefined,
  _formData: FormData,
): Promise<GoogleSheetSyncState> {
  void _prev;
  void _formData;
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }

  try {
    const result = await syncContractsFromGoogleSheet({
      orgId: session.orgId,
      actorUserId: session.userId,
      auditAction: "contracts.sync_google_sheet",
    });
    return {
      kind: "ok",
      clientsCreated: result.clientsCreated,
      clientsUpdated: result.clientsUpdated,
      contractsUpserted: result.contractsUpserted,
      installmentsUpserted: result.installmentsUpserted,
      errors: result.errors,
      parsedClients: result.parsedClients,
      parsedContracts: result.parsedContracts,
      parsedInstallments: result.parsedInstallments,
      parsedLogs: result.parsedLogs,
      logsUpserted: result.logsUpserted,
      dashboardMonth: result.dashboard?.month ?? null,
      dashboardOnTarget: result.dashboard?.cntOnTarget ?? null,
      dashboardBuckets: result.dashboard?.bucketsWritten ?? 0,
      warnings: result.warnings,
    };
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }
}

export type SingleContractSyncState =
  | { kind: "error"; error: string }
  | {
      kind: "ok";
      clientExternalId: string;
      matchedContracts: number;
      contractsUpserted: number;
      logsUpserted: number;
      warnings: string[];
    };

/**
 * Refresh a single client's contracts from the Google Sheet (the per-contract
 * "Pull from Sheet" button on /contracts/[id]). Scoped to one client: it
 * re-reads the workbook but commits only that client's rows + reruns the
 * historical-cycle backfill for it. `clientExternalId` is the sheet ID like
 * "C27" (derived from the contract Key's prefix).
 */
export async function syncSingleContractAction(
  clientExternalId: string,
): Promise<SingleContractSyncState> {
  let session;
  try {
    session = await requirePermission("contract.manage");
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }

  if (!clientExternalId || typeof clientExternalId !== "string") {
    return { kind: "error", error: "معرّف العميل مفقود" };
  }

  try {
    const result = await syncSingleClientFromGoogleSheet({
      orgId: session.orgId,
      actorUserId: session.userId,
      clientExternalId,
      auditAction: "contracts.sync_google_sheet_single",
    });
    revalidatePath("/contracts");
    return {
      kind: "ok",
      clientExternalId: result.clientExternalId,
      matchedContracts: result.matchedContracts,
      contractsUpserted: result.contractsUpserted,
      logsUpserted: result.logsUpserted,
      warnings: result.warnings,
    };
  } catch (e) {
    return { kind: "error", error: (e as Error).message };
  }
}
