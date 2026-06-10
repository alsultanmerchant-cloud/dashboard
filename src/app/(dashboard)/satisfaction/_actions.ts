"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { parseWhatsAppChat } from "@/lib/whatsapp/parse";
import { listGroups, waConfigured, getGroupsMeta, fetchChatHistory } from "@/lib/wa/openwa-client";
import { matchGroups, detectGroupKind } from "@/lib/wa/match-groups";
import { ingestWaMessages, type NormalMessage } from "@/lib/wa/ingest";

const UploadSchema = z.object({
  clientId: z.string().uuid("اختر عميلًا"),
  groupKind: z.enum(["client", "technical"]),
  filename: z.string().max(255).optional(),
  content: z.string().min(20, "الملف فارغ أو غير صالح").max(5_000_000),
});

export type UploadState = {
  ok?: true;
  error?: string;
  stats?: { messageCount: number; participantCount: number; range: string | null };
};

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
const MapSchema = z.object({
  chatId: z.string().min(3),
  clientId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  groupKind: z.enum(["client", "technical"]).nullable(),
  isActive: z.boolean(),
});

export type MapState = { ok?: true; error?: string };

export async function mapWaGroupAction(input: {
  chatId: string;
  clientId: string | null;
  projectId: string | null;
  groupKind: "client" | "technical" | null;
  isActive: boolean;
}): Promise<MapState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = MapSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { chatId, clientId, projectId, groupKind, isActive } = parsed.data;

  const { error } = await supabaseAdmin
    .from("wa_group_links")
    .update({
      client_id: clientId,
      project_id: projectId,
      group_kind: groupKind,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId);
  if (error) return { error: error.message };

  // Backfill: stamp existing messages of this chat with the new mapping so
  // they flow into the client's transcript immediately.
  await supabaseAdmin
    .from("wa_messages")
    .update({ client_id: clientId, group_kind: groupKind })
    .eq("organization_id", session.orgId)
    .eq("chat_id", chatId);

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "wa_group.mapped",
    entityType: "wa_group_link",
    entityId: chatId,
    metadata: { clientId, projectId, groupKind, isActive },
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
  scanned?: number;
};

export async function autoLinkWaProjectsAction(): Promise<AutoLinkState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const [linksRes, clientsRes, projectsRes] = await Promise.all([
    supabaseAdmin
      .from("wa_group_links")
      .select("chat_id, chat_name, client_id, project_id, group_kind")
      .eq("organization_id", session.orgId),
    supabaseAdmin.from("clients").select("id, name").eq("organization_id", session.orgId),
    supabaseAdmin
      .from("projects")
      .select("id, name, client_id, status")
      .eq("organization_id", session.orgId),
  ]);
  if (linksRes.error) return { error: linksRes.error.message };
  if (clientsRes.error) return { error: clientsRes.error.message };
  if (projectsRes.error) return { error: projectsRes.error.message };

  const links = linksRes.data ?? [];
  const matches = matchGroups(
    links.map((l) => ({ id: l.chat_id, name: l.chat_name })),
    (clientsRes.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    (projectsRes.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      clientId: p.client_id,
      status: p.status,
    })),
  );

  const existing = new Map(links.map((l) => [l.chat_id, l]));
  let linked = 0; // groups newly linked to a project
  let classified = 0; // groups newly tagged client/technical from emoji

  for (const m of matches) {
    const row = existing.get(m.chatId);
    if (!row) continue;
    const update: Record<string, unknown> = {};

    // Project: only strong matches that resolved a project, never overwrite manual.
    const willLink =
      m.projectId && (m.confidence === "exact" || m.confidence === "high") && !row.project_id;
    if (willLink) {
      update.project_id = m.projectId;
      if (!row.client_id && m.clientId) update.client_id = m.clientId;
    }

    // Kind: 💫/📍 convention, only fill when blank (never override manual).
    const willClassify = m.groupKind && !row.group_kind;
    if (willClassify) update.group_kind = m.groupKind;

    if (Object.keys(update).length === 0) continue;
    update.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("wa_group_links")
      .update(update)
      .eq("organization_id", session.orgId)
      .eq("chat_id", m.chatId);
    if (error) continue;
    if (willLink) linked += 1;
    if (willClassify) classified += 1;

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
    metadata: { linked, classified, scanned: links.length },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
  return { ok: true, linked, classified, scanned: links.length };
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
        const hist = await fetchChatHistory(chatId, HISTORY_LIMIT);
        const msgs: NormalMessage[] = hist
          .filter((m) => m.body && m.body.trim().length > 0)
          .map((m) => ({
            chatId,
            chatName,
            waMessageId: m.id,
            sender: null,
            senderId: m.from,
            body: m.body,
            messageType: m.type,
            isFromMe: m.fromMe,
            sentAt: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : null,
          }));
        if (msgs.length > 0) {
          const res = await ingestWaMessages(msgs);
          imported += res.ingested;
        }
        // Successful fetch (even if the store returned nothing) → mark seeded so
        // the group isn't re-attempted forever. A thrown gateway error skips the
        // stamp below, leaving it null to retry on the next run.
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
