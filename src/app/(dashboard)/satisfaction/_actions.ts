"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, createNotification } from "@/lib/audit";
import { parseWhatsAppChat } from "@/lib/whatsapp/parse";
import {
  listGroups,
  waConfigured,
  getGroupsMeta,
  fetchChatHistoryViaSessions,
  isOwnSession,
} from "@/lib/wa/openwa-client";
import { matchGroups, detectGroupKind } from "@/lib/wa/match-groups";
import { ingestWaMessages, type NormalMessage } from "@/lib/wa/ingest";
import { resolveClientProjectIds } from "@/lib/data/satisfaction-identity";

const UploadSchema = z.object({
  clientId: z.string().uuid("اختر عميلًا"),
  groupKind: z.enum(["client", "technical"]),
  filename: z.string().max(255).optional(),
  content: z.string().min(20, "الملف فارغ أو غير صالح").max(5_000_000),
});

const BriefLinkSchema = z.object({
  clientId: z.string().uuid("اختر عميلًا"),
  projectId: z.string().uuid("اختر مشروعًا").optional(),
  url: z
    .string()
    .trim()
    .url("أدخل رابطًا صحيحًا")
    .refine(
      (url) =>
        /docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+/.test(url) ||
        /docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/.test(url),
      "ارفع رابط Google Doc أو Google Sheet للبريف حتى يستطيع الذكاء الاصطناعي قراءته",
    ),
});

export type UploadState = {
  ok?: true;
  error?: string;
  stats?: { messageCount: number; participantCount: number; range: string | null };
};

export type BriefLinkState = { ok?: true; error?: string; projectId?: string };
export type BriefFileState = { ok?: true; error?: string; projectId?: string; filename?: string };

const RecommendationStatusSchema = z.object({
  clientId: z.string().uuid(),
  analysisId: z.string().uuid(),
  recommendationIndex: z.number().int().min(0).max(5),
  issue: z.string().trim().min(1).max(2_000),
  state: z.enum(["resolved", "cleared"]),
});

export type RecommendationStatusState = { ok?: true; error?: string };

export async function setRecommendationStatusAction(input: {
  clientId: string;
  analysisId: string;
  recommendationIndex: number;
  issue: string;
  state: "resolved" | "cleared";
}): Promise<RecommendationStatusState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RecommendationStatusSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { clientId, analysisId, recommendationIndex, issue, state } = parsed.data;

  // Verify the immutable snapshot and exact row text so a stale browser cannot
  // confirm a different recommendation after navigation/history changes.
  const { data: analysis, error: analysisError } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("id, recommendations, risks")
    .eq("organization_id", session.orgId)
    .eq("client_id", clientId)
    .eq("id", analysisId)
    .maybeSingle();
  if (analysisError) return { error: analysisError.message };
  const recommendations = Array.isArray(analysis?.recommendations)
    ? analysis.recommendations
    : [];
  const risks = Array.isArray(analysis?.risks) ? analysis.risks : [];
  // Confirm by exact issue TEXT, not array index. The UI (buildFallbackRecommendations)
  // appends derived cards — an overdue-tasks card and a first-risk card — at indices
  // PAST the end of the stored recommendations array. An index check rejected those
  // derived cards outright, so their "confirm resolved" button could never succeed
  // (and reload/re-analyze never helped, since they are never in the stored array).
  // A card is confirmable when its issue matches a stored recommendation OR a stored risk.
  const knownIssues = new Set<string>();
  for (const rec of recommendations) {
    if (rec && !Array.isArray(rec) && typeof rec === "object" && typeof rec.issue === "string") {
      knownIssues.add(rec.issue);
    }
  }
  for (const risk of risks) {
    if (typeof risk === "string") knownIssues.add(risk);
  }
  if (!knownIssues.has(issue)) {
    return { error: "التوصية تغيّرت أو لم تعد موجودة؛ حدّث الصفحة وحاول مجددًا" };
  }

  const { error } = await supabaseAdmin.from("ai_events").insert({
    organization_id: session.orgId,
    actor_user_id: session.userId,
    event_type: "SATISFACTION_RECOMMENDATION_STATUS_CHANGED",
    entity_type: "satisfaction_analysis",
    entity_id: analysisId,
    importance: "normal",
    payload: {
      clientId,
      recommendationIndex,
      issue,
      state,
    },
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action:
      state === "resolved"
        ? "satisfaction.recommendation_confirmed_resolved"
        : "satisfaction.recommendation_confirmation_cleared",
    entityType: "satisfaction_analysis",
    entityId: analysisId,
    metadata: { clientId, recommendationIndex, issue },
  });

  revalidatePath("/satisfaction");
  return { ok: true };
}

// Keep Arabic letters, latin alphanumerics, dot, dash, underscore; replace the
// rest with `_` so the storage object key stays safe across S3-compatible
// backends. Mirrors the helper used by the task comment composer.
function sanitizeFilename(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 200) || "file";
}

const MAX_BRIEF_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

// Resolve the brief's target project: the explicit one if given, else the
// client's most recent non-archived project. Shared by the link + file actions.
async function resolveBriefProject(
  orgId: string,
  clientId: string,
  projectId?: string,
): Promise<{ id: string; name: string } | null> {
  // Resolve across the client's FULL identity (owned + WA-group-linked + merged
  // twins) — otherwise a client whose project sits on a twin row (or who owns no
  // project directly) can never get a brief attached.
  const ids = await resolveClientProjectIds(orgId, clientId);
  if (ids.length === 0) return null;
  // Honour an explicit project only when it belongs to this client's identity.
  const scoped = projectId && ids.includes(projectId) ? [projectId] : ids;
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", scoped)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0] as { id: string; name: string } | undefined) ?? null;
}

export async function attachClientBriefLinkAction(input: {
  clientId: string;
  projectId?: string;
  url: string;
}): Promise<BriefLinkState> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = BriefLinkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };

  const project = await resolveBriefProject(
    session.orgId,
    parsed.data.clientId,
    parsed.data.projectId,
  );
  if (!project) return { error: "لا يوجد مشروع نشط لهذا العميل لإرفاق البريف عليه" };

  const externalId = `${project.id}:${parsed.data.url}`.slice(0, 240);
  const { error } = await supabaseAdmin.from("project_attachments").upsert(
    {
      organization_id: session.orgId,
      project_id: project.id,
      filename: "البريف",
      source_url: parsed.data.url,
      uploaded_by: session.userId,
      external_source: "manual_satisfaction_brief",
      external_id: externalId,
    },
    { onConflict: "organization_id,external_source,external_id" },
  );
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.brief_link_attached",
    entityType: "project",
    entityId: project.id,
    metadata: { clientId: parsed.data.clientId, url: parsed.data.url },
  });

  revalidatePath("/satisfaction");
  revalidatePath(`/projects/${project.id}`);
  return { ok: true, projectId: project.id };
}

// Upload a LOCAL brief file (txt/csv/xlsx/…) into Supabase Storage and register
// it as a project document so satisfaction analysis can read the documented
// requirements when no shareable Google Doc/Sheet exists. Does NOT re-analyze —
// the caller decides when (the success prompt offers "now" vs "later").
export async function uploadClientBriefFileAction(
  formData: FormData,
): Promise<BriefFileState> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const clientId = String(formData.get("clientId") ?? "");
  const projectIdInput = String(formData.get("projectId") ?? "") || undefined;
  const file = formData.get("file");
  if (!z.string().uuid().safeParse(clientId).success) return { error: "اختر عميلًا" };
  if (!(file instanceof File) || file.size === 0) return { error: "اختر ملفًا صالحًا" };
  if (file.size > MAX_BRIEF_FILE_BYTES) return { error: "الملف كبير جدًا (الحد ١٥ ميجابايت)" };

  const project = await resolveBriefProject(session.orgId, clientId, projectIdInput);
  if (!project) return { error: "لا يوجد مشروع نشط لهذا العميل لإرفاق البريف عليه" };

  const safeName = sanitizeFilename(file.name);
  const storagePath = `projects/${project.id}/brief/${Date.now()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabaseAdmin.storage
    .from("attachments")
    .upload(storagePath, bytes, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { error: `تعذّر رفع الملف: ${upErr.message}` };

  // Stable external_id (project + safe filename) so re-uploading the same brief
  // updates the row in place instead of creating a duplicate document.
  const externalId = `${project.id}:brief-file:${safeName}`.slice(0, 240);
  const { error } = await supabaseAdmin.from("project_attachments").upsert(
    {
      organization_id: session.orgId,
      project_id: project.id,
      filename: file.name,
      mimetype: file.type || null,
      size_bytes: file.size,
      storage_path: storagePath,
      uploaded_by: session.userId,
      external_source: "manual_satisfaction_brief",
      external_id: externalId,
    },
    { onConflict: "organization_id,external_source,external_id" },
  );
  if (error) {
    // Roll back the orphaned storage object so a failed insert leaves no litter.
    await supabaseAdmin.storage.from("attachments").remove([storagePath]);
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.brief_file_uploaded",
    entityType: "project",
    entityId: project.id,
    metadata: { clientId, filename: file.name, sizeBytes: file.size },
  });

  revalidatePath("/satisfaction");
  revalidatePath(`/projects/${project.id}`);
  return { ok: true, projectId: project.id, filename: file.name };
}

// Detach a wrongly-attached brief: delete the project/task attachment row and,
// for uploaded files, remove the underlying storage object so no litter is left.
// Lets the operator fix a mistaken upload/link (then re-attach the correct one).
const DeleteBriefSchema = z.object({
  clientId: z.string().uuid("اختر عميلًا"),
  attachmentId: z.string().uuid("معرّف غير صالح"),
  source: z.enum(["project", "task"]),
});

export type DeleteBriefState = { ok?: true; error?: string };

export async function deleteClientBriefAction(input: {
  clientId: string;
  attachmentId: string;
  source: "project" | "task";
}): Promise<DeleteBriefState> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DeleteBriefSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { clientId, attachmentId, source } = parsed.data;
  const table = source === "project" ? "project_attachments" : "task_attachments";

  // Fetch first (org-scoped) so we can clean up the storage object and audit it.
  // project_attachments carries project_id directly; task_attachments links via
  // its task, so resolve the project through the tasks join there.
  const selectCols =
    source === "project"
      ? "id, filename, storage_path, project_id"
      : "id, filename, storage_path, task:tasks!inner(project_id)";
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from(table)
    .select(selectCols)
    .eq("organization_id", session.orgId)
    .eq("id", attachmentId)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: "المستند غير موجود أو تم حذفه مسبقًا" };

  const r = row as {
    filename?: string | null;
    storage_path?: string | null;
    project_id?: string | null;
    task?: { project_id?: string | null } | null;
  };
  const projectId = source === "project" ? r.project_id ?? null : r.task?.project_id ?? null;

  const { error: delErr } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("organization_id", session.orgId)
    .eq("id", attachmentId);
  if (delErr) return { error: delErr.message };

  // Remove the underlying file once the row is gone (best effort — a leftover
  // object is harmless, but a deleted row pointing at live storage is litter).
  if (r.storage_path) {
    await supabaseAdmin.storage.from("attachments").remove([r.storage_path]);
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.brief_deleted",
    entityType: "project",
    entityId: projectId,
    metadata: { clientId, attachmentId, source, filename: r.filename ?? null },
  });

  revalidatePath("/satisfaction");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function uploadChatImportAction(
  _prev: UploadState | undefined,
  formData: FormData,
): Promise<UploadState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = UploadSchema.safeParse({
    clientId: formData.get("clientId"),
    groupKind: formData.get("groupKind"),
    filename: formData.get("filename") || undefined,
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  const { clientId, groupKind, filename, content } = parsed.data;

  // Confirm the client belongs to this org.
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "العميل غير موجود" };

  const chat = parseWhatsAppChat(content);
  if (chat.messageCount === 0) {
    return { error: "لم يتم العثور على رسائل صالحة في الملف" };
  }

  const { error } = await supabaseAdmin.from("client_chat_imports").insert({
    organization_id: session.orgId,
    client_id: clientId,
    group_kind: groupKind,
    source_filename: filename ?? null,
    message_count: chat.messageCount,
    participant_count: chat.participantCount,
    first_message_at: chat.firstMessageAt,
    last_message_at: chat.lastMessageAt,
    transcript: chat.transcript,
    uploaded_by: session.userId,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.chat_imported",
    entityType: "client",
    entityId: clientId,
    metadata: { groupKind, messageCount: chat.messageCount },
  });

  revalidatePath("/satisfaction");
  return {
    ok: true,
    stats: {
      messageCount: chat.messageCount,
      participantCount: chat.participantCount,
      range:
        chat.firstMessageAt && chat.lastMessageAt
          ? `${chat.firstMessageAt.slice(0, 10)} → ${chat.lastMessageAt.slice(0, 10)}`
          : null,
    },
  };
}

// ---- Map a WhatsApp group → client + kind (backfills existing messages) ---
// PATCH semantics: only the fields present in the input are written. The row
// UI auto-saves one control at a time; the old full-row overwrite let a stale
// tab (state initialized before someone else / auto-link changed the row)
// silently wipe or revert client/project links on every unrelated toggle.
const MapSchema = z.object({
  chatId: z.string().min(3),
  clientId: z.string().uuid().nullable().optional(),
  groupKind: z.enum(["client", "technical"]).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type MapState = { ok?: true; error?: string };

export async function mapWaGroupAction(input: {
  chatId: string;
  clientId?: string | null;
  groupKind?: "client" | "technical" | null;
  isActive?: boolean;
}): Promise<MapState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = MapSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { chatId, clientId, groupKind, isActive } = parsed.data;

  const update: Record<string, unknown> = {};
  if (clientId !== undefined) update.client_id = clientId;
  if (groupKind !== undefined) update.group_kind = groupKind;
  if (isActive !== undefined) update.is_active = isActive;
  if (Object.keys(update).length === 0) return { ok: true };
  update.updated_at = new Date().toISOString();

  const { data: link, error } = await supabaseAdmin
    .from("wa_group_links")
    .update(update)
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  // Backfill: stamp existing messages of this chat with the new mapping so
  // they flow into the client's transcript immediately — changed fields only.
  if (clientId !== undefined || groupKind !== undefined) {
    const msgUpdate: Record<string, unknown> = {};
    if (clientId !== undefined) msgUpdate.client_id = clientId;
    if (groupKind !== undefined) msgUpdate.group_kind = groupKind;
    await supabaseAdmin
      .from("wa_messages")
      .update(msgUpdate)
      .eq("organization_id", session.orgId)
      .eq("chat_id", chatId);
  }

  // audit_logs.entity_id is uuid — the raw chat id ("…@g.us") used to make
  // this insert fail silently, so mappings left no trail. Log the row uuid.
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.mapped",
    entityType: "wa_group_link",
    entityId: link?.id ?? null,
    metadata: { chatId, clientId, groupKind, isActive },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true };
}

// Keep wa_group_links.project_id (the legacy "primary" single project) in sync
// with the wa_group_projects join table (0203): the oldest linked project wins,
// or null when none remain. Lets single-project readers (e.g. the archived-
// status resolver's fallback) keep working without knowing about the M2M.
async function syncPrimaryProject(orgId: string, linkId: string) {
  const { data } = await supabaseAdmin
    .from("wa_group_projects")
    .select("project_id")
    .eq("organization_id", orgId)
    .eq("group_link_id", linkId)
    .order("created_at", { ascending: true })
    .limit(1);
  await supabaseAdmin
    .from("wa_group_links")
    .update({ project_id: data?.[0]?.project_id ?? null, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", linkId);
}

// ---- Replace the set of projects a group serves (0203 many-to-many) -------
// A shared client group can cover several projects of a multi-contract client.
// The mapping UI's project multi-select sends the full desired set; we diff it
// against the current rows so concurrent edits never wipe the whole set.
const SetProjectsSchema = z.object({
  chatId: z.string().min(3),
  projectIds: z.array(z.string().uuid()).max(50),
});

export async function setWaGroupProjectsAction(input: {
  chatId: string;
  projectIds: string[];
}): Promise<MapState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = SetProjectsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { chatId, projectIds } = parsed.data;
  const want = new Set(projectIds);

  const { data: link } = await supabaseAdmin
    .from("wa_group_links")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!link) return { error: "المجموعة غير موجودة" };

  const { data: current } = await supabaseAdmin
    .from("wa_group_projects")
    .select("project_id")
    .eq("organization_id", session.orgId)
    .eq("group_link_id", link.id);
  const have = new Set((current ?? []).map((r) => r.project_id));

  const toRemove = [...have].filter((p) => !want.has(p));
  const toAdd = [...want].filter((p) => !have.has(p));

  if (toRemove.length > 0) {
    const { error } = await supabaseAdmin
      .from("wa_group_projects")
      .delete()
      .eq("organization_id", session.orgId)
      .eq("group_link_id", link.id)
      .in("project_id", toRemove);
    if (error) return { error: error.message };
  }
  if (toAdd.length > 0) {
    const { error } = await supabaseAdmin.from("wa_group_projects").insert(
      toAdd.map((project_id) => ({
        organization_id: session.orgId,
        group_link_id: link.id,
        project_id,
      })),
    );
    if (error) return { error: error.message };
  }

  await syncPrimaryProject(session.orgId, link.id);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.projects_set",
    entityType: "wa_group_link",
    entityId: link.id,
    metadata: { chatId, projectIds, added: toAdd, removed: toRemove },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true };
}

// ---- Additively link a group to ONE project, stamping client/kind/active --
// Used by the coverage panel's "link this group to the missing project" action,
// which is inherently additive (never re-points an existing project).
const AddProjectSchema = z.object({
  chatId: z.string().min(3),
  projectId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  groupKind: z.enum(["client", "technical"]).nullable().optional(),
});

export async function addWaGroupProjectAction(input: {
  chatId: string;
  projectId: string;
  clientId?: string | null;
  groupKind?: "client" | "technical" | null;
}): Promise<MapState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = AddProjectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { chatId, projectId, clientId, groupKind } = parsed.data;

  // Stamp client/kind and (re)activate the group in one write, then add the
  // project link. Mirrors mapWaGroupAction's PATCH + message backfill.
  const update: Record<string, unknown> = { is_active: true, updated_at: new Date().toISOString() };
  if (clientId !== undefined) update.client_id = clientId;
  if (groupKind !== undefined) update.group_kind = groupKind;

  const { data: link, error } = await supabaseAdmin
    .from("wa_group_links")
    .update(update)
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!link) return { error: "المجموعة غير موجودة" };

  const { error: insErr } = await supabaseAdmin
    .from("wa_group_projects")
    .upsert(
      { organization_id: session.orgId, group_link_id: link.id, project_id: projectId },
      { onConflict: "group_link_id,project_id", ignoreDuplicates: true },
    );
  if (insErr) return { error: insErr.message };

  if (clientId !== undefined || groupKind !== undefined) {
    const msgUpdate: Record<string, unknown> = {};
    if (clientId !== undefined) msgUpdate.client_id = clientId;
    if (groupKind !== undefined) msgUpdate.group_kind = groupKind;
    await supabaseAdmin
      .from("wa_messages")
      .update(msgUpdate)
      .eq("organization_id", session.orgId)
      .eq("chat_id", chatId);
  }

  await syncPrimaryProject(session.orgId, link.id);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.project_added",
    entityType: "wa_group_link",
    entityId: link.id,
    metadata: { chatId, projectId, clientId, groupKind },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true };
}

// ---- Stamp the (contract) client onto every group serving a project -------
// The coverage panel lets the operator set the client for a project directly;
// contracts are the source of truth for client identity, so we write the chosen
// client onto ALL wa_group_links currently linked to that project (via the 0203
// join) and backfill their messages. A no-op when the project has no groups yet
// — in that case the coverage row's linkGroup carries the client onto the first
// group linked. Passing clientId=null clears the client from those groups.
const SetProjectClientSchema = z.object({
  projectId: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
});

export async function setProjectClientAction(input: {
  projectId: string;
  clientId: string | null;
}): Promise<MapState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = SetProjectClientSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { projectId, clientId } = parsed.data;

  // Which group links serve this project?
  const { data: gpRows, error: gpErr } = await supabaseAdmin
    .from("wa_group_projects")
    .select("group_link_id")
    .eq("organization_id", session.orgId)
    .eq("project_id", projectId);
  if (gpErr) return { error: gpErr.message };
  const linkIds = [...new Set((gpRows ?? []).map((r) => r.group_link_id as string))];
  if (linkIds.length === 0) return { ok: true }; // no groups yet — nothing to stamp

  const { data: links, error: upErr } = await supabaseAdmin
    .from("wa_group_links")
    .update({ client_id: clientId, updated_at: new Date().toISOString() })
    .eq("organization_id", session.orgId)
    .in("id", linkIds)
    .select("chat_id");
  if (upErr) return { error: upErr.message };

  // Backfill the affected chats' messages so they flow into the client's
  // transcript immediately (mirrors mapWaGroupAction).
  const chatIds = [...new Set((links ?? []).map((l) => l.chat_id as string))];
  if (chatIds.length > 0) {
    await supabaseAdmin
      .from("wa_messages")
      .update({ client_id: clientId })
      .eq("organization_id", session.orgId)
      .in("chat_id", chatIds);
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.project_client_set",
    entityType: "project",
    entityId: projectId,
    metadata: { projectId, clientId, linkIds },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true };
}

// ---- Auto-link groups → projects by name (high-confidence only) -----------
export type AutoLinkState = {
  ok?: true;
  error?: string;
  linked?: number;
  classified?: number;
  suggested?: number;
  scanned?: number;
};

export async function autoLinkWaProjectsAction(): Promise<AutoLinkState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { getClientDisplayNameMap, foldedContractsByCanonical } = await import("@/lib/data/clients");
  const [linksRes, clientsRes, projectsRes, displayNames, foldedContracts] = await Promise.all([
    supabaseAdmin
      .from("wa_group_links")
      .select(
        "id, chat_id, chat_name, client_id, project_id, group_kind, suggested_client_id, suggestion_dismissed_at",
      )
      .eq("organization_id", session.orgId),
    // Only canonical (non-merged) clients — never auto-link a group to a
    // tombstoned duplicate that was folded into another client (0145).
    supabaseAdmin
      .from("clients")
      .select("id, name")
      .eq("organization_id", session.orgId)
      .is("merged_into_client_id", null),
    supabaseAdmin
      .from("projects")
      .select("id, name, client_id, status")
      .eq("organization_id", session.orgId),
    getClientDisplayNameMap(session.orgId),
    foldedContractsByCanonical(session.orgId),
  ]);
  if (linksRes.error) return { error: linksRes.error.message };
  if (clientsRes.error) return { error: clientsRes.error.message };
  if (projectsRes.error) return { error: projectsRes.error.message };

  const links = linksRes.data ?? [];
  const contractBackedClientIds = new Set(
    Array.from(foldedContracts.entries())
      .filter(([, contracts]) => contracts.length > 0)
      .map(([clientId]) => clientId),
  );
  const matches = matchGroups(
    links.map((l) => ({ id: l.chat_id, name: l.chat_name })),
    (clientsRes.data ?? []).filter((c) => contractBackedClientIds.has(c.id)).map((c) => {
      // Primary name = the contract-sheet name (source of truth); aliases add the
      // raw Odoo name + every contract sheet_client_name (across merged twins) so a
      // group named by ANY of them still resolves. See [[project_client_display_name_resolver]].
      const primary = displayNames.get(c.id) ?? c.name;
      const contractNames = (foldedContracts.get(c.id) ?? [])
        .map((k) => k.sheet_client_name)
        .filter((n): n is string => !!n && n.trim().length > 0);
      const aliases = Array.from(new Set([c.name, ...contractNames])).filter((n) => n !== primary);
      return { id: c.id, name: primary, aliases };
    }),
    (projectsRes.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      clientId: p.client_id,
      status: p.status,
    })),
  );

  const existing = new Map(links.map((l) => [l.chat_id, l]));
  let linked = 0; // groups newly linked to a project (strong matches, applied)
  let classified = 0; // groups newly tagged client/technical from emoji
  let suggested = 0; // low-confidence matches parked for confirmation

  for (const m of matches) {
    const row = existing.get(m.chatId);
    if (!row) continue;
    const update: Record<string, unknown> = {};
    const strong = m.confidence === "exact" || m.confidence === "high";
    const currentHasContractClient = !!row.client_id && contractBackedClientIds.has(row.client_id);

    // Project: only strong matches that resolved a project, never overwrite manual.
    const willLink = m.projectId && strong && !row.project_id;
    if (willLink) {
      update.project_id = m.projectId;
    }
    // Client: fill blanks, and repair older auto-links that pointed at a
    // project-only/Odoo client with no contract identity. Contract-backed
    // clients are left untouched so manual choices are not overwritten.
    const willSetClient =
      m.clientId &&
      strong &&
      (!row.client_id || (!currentHasContractClient && row.client_id !== m.clientId));
    if (willSetClient) update.client_id = m.clientId;

    // Kind: 💫/📍 convention, only fill when blank (never override manual).
    const willClassify = m.groupKind && !row.group_kind;
    if (willClassify) update.group_kind = m.groupKind;

    // Low-confidence match on an UNLINKED, non-dismissed group → park it as a
    // suggestion the operator confirms/rejects (instead of dropping it silently).
    // Existing links and applied strong matches are left untouched.
    const willSuggest =
      m.confidence === "low" &&
      !!m.clientId &&
      !row.client_id &&
      !willLink &&
      !row.suggestion_dismissed_at &&
      row.suggested_client_id !== m.clientId;
    if (willSuggest) {
      update.suggested_client_id = m.clientId;
      update.suggested_project_id = m.projectId ?? null;
      update.suggested_confidence = m.confidence;
      update.suggested_at = new Date().toISOString();
    }

    if (Object.keys(update).length === 0) continue;
    update.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("wa_group_links")
      .update(update)
      .eq("organization_id", session.orgId)
      .eq("chat_id", m.chatId);
    if (error) continue;
    // Mirror the auto-linked project into the M2M join table (0203) so coverage
    // sees it. project_id above stays as the primary mirror.
    if (willLink && m.projectId) {
      await supabaseAdmin.from("wa_group_projects").upsert(
        { organization_id: session.orgId, group_link_id: row.id, project_id: m.projectId },
        { onConflict: "group_link_id,project_id", ignoreDuplicates: true },
      );
    }
    if (willLink) linked += 1;
    if (willClassify) classified += 1;
    if (willSuggest) suggested += 1;

    // Backfill stored messages so transcripts pick up the new client/kind.
    if (update.client_id || update.group_kind) {
      const msgUpdate: Record<string, unknown> = {};
      if (update.client_id) msgUpdate.client_id = update.client_id;
      if (update.group_kind) msgUpdate.group_kind = update.group_kind;
      await supabaseAdmin
        .from("wa_messages")
        .update(msgUpdate)
        .eq("organization_id", session.orgId)
        .eq("chat_id", m.chatId);
    }
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.auto_linked_projects",
    entityType: "wa_group_link",
    entityId: session.orgId,
    metadata: { linked, classified, suggested, scanned: links.length },
  });

  // Notify owners about anything that now needs a human eye: pending
  // confirmations + active projects still missing their WhatsApp groups.
  await notifyWaLinkingState(session.orgId);

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true, linked, classified, suggested, scanned: links.length };
}

// Bell-notify owners about pending link suggestions and projects missing groups.
// Deduped: skips a type if the owner already has an unread one of it, so a
// repeated sync doesn't pile up duplicates — the in-page sections are the
// always-accurate source of truth; this is just the nudge.
async function notifyWaLinkingState(orgId: string) {
  const [{ getWaLinkSuggestions, getProjectGroupCoverage }, { getOwnerUserIds }] =
    await Promise.all([
      import("@/lib/data/satisfaction"),
      import("@/lib/data/org-roles"),
    ]);
  const owners = await getOwnerUserIds(orgId);
  if (owners.length === 0) return;
  const [suggestions, gaps] = await Promise.all([
    getWaLinkSuggestions(orgId),
    getProjectGroupCoverage(orgId),
  ]);

  const plans: Array<{ type: string; title: string }> = [];
  if (suggestions.length > 0)
    plans.push({
      type: "WA_LINK_SUGGESTIONS",
      title: `${suggestions.length} رابط مجموعة واتساب بانتظار التأكيد`,
    });
  if (gaps.length > 0)
    plans.push({
      type: "WA_PROJECT_COVERAGE",
      title: `${gaps.length} مشروع بدون مجموعات واتساب مكتملة`,
    });
  if (plans.length === 0) return;

  for (const userId of owners) {
    for (const plan of plans) {
      const { data: open } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("organization_id", orgId)
        .eq("recipient_user_id", userId)
        .eq("type", plan.type)
        .is("read_at", null)
        .limit(1);
      if (open && open.length > 0) continue; // already nudged, not yet read
      await createNotification({
        organizationId: orgId,
        recipientUserId: userId,
        type: plan.type,
        title: plan.title,
        entityType: "wa_group_link",
        entityId: null,
      });
    }
  }
}

// Confirm a parked suggestion → promote it to the live link.
export async function confirmWaSuggestionAction(input: {
  chatId: string;
}): Promise<{ ok?: true; error?: string }> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const chatId = z.string().min(3).safeParse(input.chatId);
  if (!chatId.success) return { error: "معرّف مجموعة غير صالح" };

  const { data: row, error: rowErr } = await supabaseAdmin
    .from("wa_group_links")
    .select("id, chat_name, group_kind, suggested_client_id, suggested_project_id")
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId.data)
    .maybeSingle();
  if (rowErr) return { error: rowErr.message };
  if (!row?.suggested_client_id) return { error: "لا يوجد اقتراح لتأكيده" };

  const kind = row.group_kind ?? detectGroupKind(row.chat_name);
  const { error } = await supabaseAdmin
    .from("wa_group_links")
    .update({
      client_id: row.suggested_client_id,
      project_id: row.suggested_project_id,
      ...(row.group_kind ? {} : kind ? { group_kind: kind } : {}),
      suggested_client_id: null,
      suggested_project_id: null,
      suggested_confidence: null,
      suggested_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId.data);
  if (error) return { error: error.message };

  // Backfill stored messages so transcripts pick up the confirmed mapping.
  await supabaseAdmin
    .from("wa_messages")
    .update({
      client_id: row.suggested_client_id,
      ...(row.group_kind ? {} : kind ? { group_kind: kind } : {}),
    })
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId.data);

  if (row.suggested_project_id) {
    await supabaseAdmin.from("wa_group_projects").upsert(
      {
        organization_id: session.orgId,
        group_link_id: row.id,
        project_id: row.suggested_project_id,
      },
      { onConflict: "group_link_id,project_id", ignoreDuplicates: true },
    );
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.suggestion_confirmed",
    entityType: "wa_group_link",
    entityId: row.id,
    metadata: { chatId: chatId.data, clientId: row.suggested_client_id, projectId: row.suggested_project_id },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true };
}

// Reject a parked suggestion → dismiss it (won't be re-suggested).
export async function rejectWaSuggestionAction(input: {
  chatId: string;
}): Promise<{ ok?: true; error?: string }> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const chatId = z.string().min(3).safeParse(input.chatId);
  if (!chatId.success) return { error: "معرّف مجموعة غير صالح" };

  const { data: row, error } = await supabaseAdmin
    .from("wa_group_links")
    .update({
      suggested_client_id: null,
      suggested_project_id: null,
      suggested_confidence: null,
      suggested_at: null,
      suggestion_dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId.data)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.suggestion_rejected",
    entityType: "wa_group_link",
    entityId: row?.id ?? null,
    metadata: { chatId: chatId.data },
  });

  revalidatePath("/satisfaction/groups");
  return { ok: true };
}

// ---- Pull the group list from the OpenWA gateway -------------------------
export type SyncState = { ok?: true; error?: string; found?: number };

export async function syncWaGroupsAction(): Promise<SyncState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  if (!waConfigured()) {
    return { error: "WA_API_URL غير مهيأ — أضف عنوان خدمة OpenWA في متغيرات البيئة" };
  }

  let groups: Array<{ id: string; name: string | null }>;
  try {
    groups = await listGroups();
  } catch (e) {
    return { error: `تعذر الاتصال بـ OpenWA: ${(e as Error).message}` };
  }
  if (groups.length === 0) {
    return { error: "لم تُرجع OpenWA أي مجموعات — تأكد أن الرقم متصل وعضو في المجموعات" };
  }

  for (const g of groups) {
    // 💫 = client group, 📍 = internal team group (agency naming convention).
    const kind = detectGroupKind(g.name);
    const { data: existing } = await supabaseAdmin
      .from("wa_group_links")
      .select("id, group_kind")
      .eq("organization_id", session.orgId)
      .eq("chat_id", g.id)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("wa_group_links")
        .update({
          chat_name: g.name,
          // only auto-fill kind when not already set (never override manual)
          ...(existing.group_kind ? {} : kind ? { group_kind: kind } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", session.orgId)
        .eq("chat_id", g.id);
    } else {
      await supabaseAdmin.from("wa_group_links").insert({
        organization_id: session.orgId,
        chat_id: g.id,
        chat_name: g.name,
        group_kind: kind,
      });
    }
  }

  revalidatePath("/satisfaction/groups");
  return { ok: true, found: groups.length };
}

// ---- Import historical messages from OpenWA (WA-Web store) ----------------
// Pulls past messages for MAPPED, ACTIVE groups via the gateway's history
// endpoint and ingests them (ingestWaMessages stamps client/kind from the link
// and refreshes counts). Resumable: skips groups that already have messages.
export type ImportHistoryState = {
  ok?: true;
  error?: string;
  groups?: number;
  imported?: number;
  remaining?: number;
};

const HISTORY_LIMIT = 1000;
const HISTORY_CONCURRENCY = 2;

export async function importWaHistoryAction(): Promise<ImportHistoryState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!waConfigured()) {
    return { error: "WA_API_URL غير مهيأ — أضف عنوان خدمة OpenWA في متغيرات البيئة" };
  }
  const orgId = session.orgId; // captured for use inside the worker closure

  // Every enrolled number's session — a group may be served by ANY of the
  // agency's numbers, so backfill must try each until one that is a member of
  // the group returns its history (single-session fetch silently missed groups
  // the primary number wasn't in). Most-recently-seen first as a cheap heuristic.
  const { data: accounts } = await supabaseAdmin
    .from("wa_accounts")
    .select("session_id, last_seen_at")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  // Tenant isolation: only read history from OUR sessions on the shared gateway.
  const sessionNames = (accounts ?? [])
    .map((a) => a.session_id as string)
    .filter((name) => isOwnSession(name));
  if (sessionNames.length === 0) {
    return { error: "لا توجد أرقام واتساب مفعّلة — أضف رقمًا من صفحة الربط" };
  }

  // Target: mapped (client_id set) + active groups not yet history-seeded.
  // Keyed on history_imported_at (not message_count) so groups that only got a
  // stray live webhook message still get a full backfill — see migration 0155.
  const { data: targets, error } = await supabaseAdmin
    .from("wa_group_links")
    .select("chat_id, chat_name, message_count")
    .eq("organization_id", orgId)
    .not("client_id", "is", null)
    .eq("is_active", true)
    .is("history_imported_at", null);
  if (error) return { error: error.message };
  const queue = (targets ?? []).map((t) => ({
    chatId: t.chat_id as string,
    chatName: (t.chat_name as string | null) ?? null,
  }));
  if (queue.length === 0) return { ok: true, groups: 0, imported: 0, remaining: 0 };

  let imported = 0;
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const { chatId, chatName } = queue[cursor++];
      try {
        // Whichever enrolled number is actually in this group serves its history.
        const hit = await fetchChatHistoryViaSessions(chatId, sessionNames, HISTORY_LIMIT);
        const msgs: NormalMessage[] = (hit?.messages ?? [])
          .filter((m) => (m.body && m.body.trim().length > 0) || m.media)
          .map((m) => ({
            chatId,
            chatName,
            waMessageId: m.id,
            waRawId: m.id ?? null, // history endpoint already returns the bare id
            sender: null,
            senderId: m.from,
            body: m.body,
            messageType: m.type,
            isFromMe: m.fromMe,
            sentAt: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : null,
            media: m.media ?? null,
          }));
        if (msgs.length > 0) {
          const res = await ingestWaMessages(msgs, hit?.sessionName ?? null, {
            refreshMessageCounts: true,
          });
          imported += res.ingested;
        }
        // Mark seeded ONLY when a member number actually served this group (even
        // if its store was empty). If NO enrolled number is a member yet (hit
        // null), leave history_imported_at null so the group is retried once the
        // covering number is enrolled — never strand it as falsely "seeded".
        if (hit === null) {
          done += 1;
          continue;
        }
        await supabaseAdmin
          .from("wa_group_links")
          .update({ history_imported_at: new Date().toISOString() })
          .eq("organization_id", orgId)
          .eq("chat_id", chatId);
      } catch {
        /* transient gateway error; leave history_imported_at null → retried next run */
      }
      done += 1;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(HISTORY_CONCURRENCY, queue.length) }, () => worker()),
  );

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_history.imported",
    entityType: "wa_group_link",
    entityId: session.orgId,
    metadata: { groups: done, imported },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true, groups: done, imported, remaining: queue.length - done };
}

// ---- Refresh member counts from OpenWA (resumable, throttled) -------------
// The gateway caps concurrency on its per-group endpoint, so this is slow for
// hundreds of groups. It is RESUMABLE: each run only fetches groups whose count
// is still missing (member_count is null), so clicking again fills the rest.
export type RefreshMembersState = {
  ok?: true;
  error?: string;
  refreshed?: number;
  remaining?: number;
};

export async function refreshWaMembersAction(): Promise<RefreshMembersState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!waConfigured()) {
    return { error: "WA_API_URL غير مهيأ — أضف عنوان خدمة OpenWA في متغيرات البيئة" };
  }

  // Only the ones we don't have yet (resumable).
  const { data: pending, error: pErr } = await supabaseAdmin
    .from("wa_group_links")
    .select("chat_id")
    .eq("organization_id", session.orgId)
    .is("member_count", null);
  if (pErr) return { error: pErr.message };
  const chatIds = (pending ?? []).map((r) => r.chat_id);
  if (chatIds.length === 0) return { ok: true, refreshed: 0, remaining: 0 };

  const metas = await getGroupsMeta(chatIds);
  const now = new Date().toISOString();
  for (const [chatId, meta] of Object.entries(metas)) {
    await supabaseAdmin
      .from("wa_group_links")
      .update({
        member_count: meta.memberCount,
        admin_count: meta.adminCount,
        members_synced_at: now,
      })
      .eq("organization_id", session.orgId)
      .eq("chat_id", chatId);
  }

  const refreshed = Object.keys(metas).length;
  revalidatePath("/satisfaction/groups");
  return { ok: true, refreshed, remaining: chatIds.length - refreshed };
}

// --- Manual archive / restore -------------------------------------------
// For clients whose relationship is dead but carry no project signal — e.g. a
// cancelled contract whose group was never added to Rawasm. These otherwise
// stay "active" forever (no project → no archived signal), so the operator can
// flag them manually; isActiveClient() in data/satisfaction.ts honors this.
const ArchiveSchema = z.object({
  clientId: z.string().uuid(),
  archived: z.boolean(),
});

export type ArchiveClientState = { ok?: true; error?: string };

export async function setClientArchivedAction(input: {
  clientId: string;
  archived: boolean;
}): Promise<ArchiveClientState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ArchiveSchema.safeParse(input);
  if (!parsed.success) return { error: "بيانات غير صالحة" };
  const { clientId, archived } = parsed.data;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "العميل غير موجود" };

  // clients.status CHECK allows only ('active','inactive','lead'); 'inactive'
  // is our manual archive marker (isActiveClient treats any non-active status
  // as archived).
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ status: archived ? "inactive" : "active" })
    .eq("organization_id", session.orgId)
    .eq("id", clientId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: archived ? "client.archived" : "client.restored",
    entityType: "client",
    entityId: clientId,
  });

  revalidatePath("/satisfaction");
  return { ok: true };
}
