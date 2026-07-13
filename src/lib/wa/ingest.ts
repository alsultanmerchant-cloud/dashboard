import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// OpenWA → dashboard ingestion helpers.
//
// OpenWA (whatsapp-web.js based) posts message events to /api/wa/webhook.
// Payload shapes vary by version, so we normalise defensively. Messages are
// stored in wa_messages (idempotent on the WA message id) and chats are
// auto-registered in wa_group_links so the admin can map them to a client.

const DEFAULT_ORG_SLUG = process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? "rawasm-demo";

async function _getDefaultOrgId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", DEFAULT_ORG_SLUG)
    .maybeSingle();
  if (error || !data) throw new Error(`organization "${DEFAULT_ORG_SLUG}" not found`);
  return data.id as string;
}
export const getDefaultOrgId = cache(_getDefaultOrgId);

// ---- HMAC signature ------------------------------------------------------
// Accepts either a hex digest or the GitHub-style "sha256=<hex>" form.
export function verifyWaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[wa] WA_WEBHOOK_SECRET not set — skipping signature check (dev only)");
    return true;
  }
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Normalisation -------------------------------------------------------
export interface NormalMessage {
  chatId: string;
  chatName: string | null;
  waMessageId: string;
  waRawId: string | null; // original serialized id, kept for debugging
  sender: string | null;
  senderId: string | null;
  body: string;
  messageType: string;
  isFromMe: boolean;
  sentAt: string | null; // ISO
  media?: NormalMedia | null;
}

export interface NormalMedia {
  dataBase64: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "_serialized" in v) {
    return String((v as { _serialized: unknown })._serialized);
  }
  return null;
}

// Recover the STABLE bare message id (whatsapp-web.js `id.id`, e.g. "3EB0F1A2...").
//
// The WA id object is { fromMe, remote, id, _serialized }. The serialized form is
//   `<fromMe>_<remoteJid>_<bareId>[_<participant>]`
// The leading fromMe flag (and the group participant suffix) differ depending on
// WHICH connected number received the message, so we must NOT key on `_serialized`
// — the same message would be stored once per number. The bare `id` segment is
// sender-generated and identical across every recipient, so deduping on
// (chat_id, bareId) collapses a message seen by multiple numbers to one row.
export function bareWaMessageId(v: unknown): { id: string | null; raw: string | null } {
  if (v == null) return { id: null, raw: null };

  // Already an id object: trust `id.id`, keep `_serialized` as the raw form.
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const raw = typeof o._serialized === "string" ? o._serialized : null;
    if (typeof o.id === "string" && o.id.length > 0) {
      return { id: o.id, raw: raw ?? o.id };
    }
    if (raw) return { id: parseBareFromSerialized(raw), raw };
    return { id: null, raw: null };
  }

  // A plain serialized (or already-bare) string.
  if (typeof v === "string" && v.length > 0) {
    return { id: parseBareFromSerialized(v), raw: v };
  }
  return { id: null, raw: null };
}

// `<fromMe>_<remoteJid>_<bareId>[_<participant>]` → bareId.
// remoteJid contains no "_", so segment index 2 (0-based) is the bare id.
// If the string isn't in serialized form, it's already bare — return as-is.
function parseBareFromSerialized(s: string): string {
  const parts = s.split("_");
  if (parts.length >= 3 && (parts[0] === "true" || parts[0] === "false")) {
    return parts[2];
  }
  return s;
}

function pickMessageObjects(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.flatMap(pickMessageObjects);
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  // Common envelopes: { data: {...} }, { message: {...} }, { messages: [...] }, { body: {...} }
  if (Array.isArray(p.messages)) return p.messages.flatMap(pickMessageObjects);
  if (p.data) return pickMessageObjects(p.data);
  if (p.message && typeof p.message === "object") return pickMessageObjects(p.message);
  // A bare message object — must have an id and a chat reference.
  if (p.id || p.body !== undefined || p.from || p.chatId) return [p];
  return [];
}

function pickObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

function cleanBase64Data(value: string): string {
  const comma = value.indexOf(",");
  return (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s+/g, "");
}

function extractMedia(m: Record<string, unknown>): NormalMedia | null {
  const media = pickObj(m.media) ?? pickObj(m.mediaData) ?? pickObj(m._data);
  const data = firstString(
    m.data,
    m.fileData,
    media?.data,
    media?.body,
    media?.fileData,
  );
  if (!data) return null;

  const mimeType =
    firstString(m.mimetype, m.mimeType, media?.mimetype, media?.mimeType) ??
    "application/octet-stream";
  const filename = firstString(m.filename, m.fileName, media?.filename, media?.fileName);
  const sizeBytes = firstNumber(m.size, m.filesize, m.fileSize, media?.size, media?.fileSize);

  return {
    dataBase64: cleanBase64Data(data),
    mimeType,
    filename,
    sizeBytes,
  };
}

export function normalizeWaEvents(payload: unknown): NormalMessage[] {
  const objs = pickMessageObjects(payload);
  const out: NormalMessage[] = [];
  for (const m of objs) {
    const chatId =
      str(m.chatId) ?? str(m.from) ?? str((m.chat as Record<string, unknown>)?.id) ?? null;
    if (!chatId) continue;
    // Only group chats (…@g.us). Skip 1:1 to avoid storing personal DMs.
    if (!chatId.endsWith("@g.us")) continue;

    const { id: waMessageId, raw: waRawId } = bareWaMessageId(m.id ?? m.messageId ?? null);
    if (!waMessageId) continue;

    const type = (str(m.type) ?? "chat").toLowerCase();
    const body =
      typeof m.body === "string"
        ? m.body
        : typeof m.content === "string"
          ? (m.content as string)
          : typeof m.caption === "string"
            ? (m.caption as string)
            : "";

    // Group subject only — NOT notifyName (that's the sender's push name).
    const chatName =
      str((m.chat as Record<string, unknown>)?.name) ??
      str((m.chat as Record<string, unknown>)?.formattedTitle) ??
      str(m.chatName) ??
      null;

    const senderObj = (m.sender as Record<string, unknown>) ?? {};
    const senderIdObj = (senderObj.id as Record<string, unknown>) ?? {};
    const sender =
      str(senderObj.pushname) ??
      str(senderObj.pushName) ??
      str(senderObj.formattedName) ??
      str(senderObj.name) ??
      str(m.notifyName) ??
      str(m.author) ??
      null;
    // Prefer a real phone JID exposed by the contact object over `author`.
    // Modern WhatsApp often emits author as an opaque @lid, which cannot be
    // compared with employee_profiles.phone. Fall back to it only when the
    // contact payload has no phone/c.us identity.
    const contactSenderId =
      str(senderObj.phoneNumber) ??
      str(senderObj.phone) ??
      str(senderObj.contactId) ??
      str(senderIdObj._serialized) ??
      str(senderIdObj.serialized) ??
      (str(senderIdObj.user) && str(senderIdObj.server)
        ? `${str(senderIdObj.user)}@${str(senderIdObj.server)}`
        : null);

    const tsRaw = m.timestamp ?? m.t ?? null;
    let sentAt: string | null = null;
    if (typeof tsRaw === "number") sentAt = new Date(tsRaw * 1000).toISOString();
    else if (typeof tsRaw === "string" && /^\d+$/.test(tsRaw))
      sentAt = new Date(parseInt(tsRaw, 10) * 1000).toISOString();

    out.push({
      chatId,
      chatName,
      waMessageId,
      waRawId,
      sender,
      senderId:
        (contactSenderId && !contactSenderId.endsWith("@lid") ? contactSenderId : null) ??
        str(m.author) ??
        str(m.participant) ??
        contactSenderId ??
        null,
      body,
      messageType: type,
      isFromMe: m.fromMe === true,
      sentAt,
      media: extractMedia(m),
    });
  }
  return out;
}

// ---- Ingest --------------------------------------------------------------
export interface IngestResult {
  ingested: number;
  skipped: number;
  chats: string[];
}

const MAX_WA_MEDIA_BYTES = 15 * 1024 * 1024;

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "file";
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "video/mp4") return "mp4";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/ogg" || mime === "audio/opus") return "ogg";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

async function persistWaMedia(orgId: string, message: NormalMessage) {
  if (!message.media) return null;

  const bytes = Buffer.from(message.media.dataBase64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_WA_MEDIA_BYTES) return null;

  const filename =
    message.media.filename ??
    `${message.waMessageId}.${extensionForMime(message.media.mimeType)}`;
  const storagePath = [
    orgId,
    safePathSegment(message.chatId),
    `${safePathSegment(message.waMessageId)}-${safePathSegment(filename)}`,
  ].join("/");

  const { error } = await supabaseAdmin.storage.from("wa-media").upload(storagePath, bytes, {
    contentType: message.media.mimeType,
    upsert: true,
  });
  if (error) {
    console.warn(`[wa] media upload failed for ${message.waMessageId}: ${error.message}`);
    return null;
  }

  return {
    media_storage_path: storagePath,
    media_mime_type: message.media.mimeType,
    media_filename: filename,
    media_size_bytes: message.media.sizeBytes ?? bytes.byteLength,
  };
}

// OpenWA may carry a session identifier on the event envelope (shape varies by
// version). The webhook prefers the ?account=<name> query tag we register the
// webhook URL with; this is the fallback when that tag is absent.
export function extractSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const data = (p.data as Record<string, unknown>) ?? null;
  return (
    (typeof p.session === "string" ? p.session : null) ??
    (typeof p.sessionId === "string" ? p.sessionId : null) ??
    (typeof p.sessionName === "string" ? p.sessionName : null) ??
    (data && typeof data.session === "string" ? data.session : null) ??
    null
  );
}

export type IngestedWaSessionStatus =
  | "INITIALIZING"
  | "SCAN_QR"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "FAILED";

// OpenWA sends `session.status` through the same webhook as messages. Keep the
// parsing deliberately narrow so message delivery/read statuses can never be
// mistaken for the connection status of the whole WhatsApp number.
export function extractWaSessionStatus(payload: unknown): IngestedWaSessionStatus | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const data = p.data && typeof p.data === "object"
    ? (p.data as Record<string, unknown>)
    : null;
  const eventPayload = p.payload && typeof p.payload === "object"
    ? (p.payload as Record<string, unknown>)
    : null;
  const event = firstString(p.event, p.eventName, p.type, data?.event, data?.eventName)
    ?.toLowerCase()
    .replace(/[-_]/g, ".");
  if (event !== "session.status") return null;

  const raw = firstString(
    p.status,
    p.state,
    data?.status,
    data?.state,
    eventPayload?.status,
    eventPayload?.state,
  )
    ?.toLowerCase()
    .replace(/-/g, "_");
  switch (raw) {
    case "created":
    case "initializing":
    case "starting":
      return "INITIALIZING";
    case "qr_ready":
    case "scan_qr":
    case "scan_code":
      return "SCAN_QR";
    case "authenticating":
    case "connecting":
      return "CONNECTING";
    case "ready":
    case "connected":
    case "working":
      return "CONNECTED";
    case "disconnected":
    case "logged_out":
    case "stopped":
      return "DISCONNECTED";
    case "failed":
    case "auth_failure":
    case "error":
      return "FAILED";
    default:
      return null;
  }
}

export async function ingestWaSessionStatus(
  status: IngestedWaSessionStatus,
  accountSessionId: string | null,
): Promise<boolean> {
  if (!accountSessionId) return false;
  const orgId = await getDefaultOrgId();
  const { data, error } = await supabaseAdmin
    .from("wa_accounts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("session_id", accountSessionId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

export async function ingestWaMessages(
  messages: NormalMessage[],
  accountSessionId?: string | null,
): Promise<IngestResult> {
  if (messages.length === 0) return { ingested: 0, skipped: 0, chats: [] };
  const orgId = await getDefaultOrgId();

  // Resolve which connected number delivered these events (provenance only —
  // never part of the dedup key). Bumps the account's heartbeat.
  let accountId: string | null = null;
  if (accountSessionId) {
    const { data: acct } = await supabaseAdmin
      .from("wa_accounts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("session_id", accountSessionId)
      .maybeSingle();
    accountId = (acct?.id as string | null) ?? null;
    if (accountId) {
      await supabaseAdmin
        .from("wa_accounts")
        .update({ last_seen_at: new Date().toISOString(), status: "CONNECTED" })
        .eq("id", accountId);
    }
  }

  // Resolve / auto-register each chat → link (client_id + group_kind).
  const byChat = new Map<string, NormalMessage[]>();
  for (const m of messages) {
    const arr = byChat.get(m.chatId) ?? [];
    arr.push(m);
    byChat.set(m.chatId, arr);
  }

  const links = new Map<string, { clientId: string | null; groupKind: string | null }>();
  for (const [chatId, msgs] of byChat) {
    const name = msgs.find((m) => m.chatName)?.chatName ?? null;
    const lastAt = msgs.reduce<string | null>(
      (acc, m) => (m.sentAt && (!acc || m.sentAt > acc) ? m.sentAt : acc),
      null,
    );
    // Fetch existing link.
    const { data: existing } = await supabaseAdmin
      .from("wa_group_links")
      .select("client_id, group_kind")
      .eq("organization_id", orgId)
      .eq("chat_id", chatId)
      .maybeSingle();

    if (existing) {
      links.set(chatId, {
        clientId: (existing.client_id as string | null) ?? null,
        groupKind: (existing.group_kind as string | null) ?? null,
      });
      await supabaseAdmin
        .from("wa_group_links")
        .update({
          chat_name: name ?? undefined,
          last_message_at: lastAt ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId)
        .eq("chat_id", chatId);
    } else {
      links.set(chatId, { clientId: null, groupKind: null });
      await supabaseAdmin.from("wa_group_links").insert({
        organization_id: orgId,
        chat_id: chatId,
        chat_name: name,
        last_message_at: lastAt,
      });
    }
  }

  // Upsert messages (idempotent on org+chat+wa_message_id).
  const mediaByMessageId = new Map<string, Awaited<ReturnType<typeof persistWaMedia>>>();
  for (const m of messages) {
    mediaByMessageId.set(m.waMessageId, await persistWaMedia(orgId, m));
  }

  const rows = messages.map((m) => {
    const link = links.get(m.chatId);
    const media = mediaByMessageId.get(m.waMessageId);
    return {
      organization_id: orgId,
      chat_id: m.chatId,
      wa_message_id: m.waMessageId,
      wa_raw_id: m.waRawId,
      first_seen_account_id: accountId,
      client_id: link?.clientId ?? null,
      group_kind: link?.groupKind ?? null,
      sender: m.sender,
      sender_id: m.senderId,
      body: m.body,
      message_type: m.messageType,
      is_from_me: m.isFromMe,
      sent_at: m.sentAt,
      media_storage_path: media?.media_storage_path ?? null,
      media_mime_type: media?.media_mime_type ?? m.media?.mimeType ?? null,
      media_filename: media?.media_filename ?? m.media?.filename ?? null,
      media_size_bytes: media?.media_size_bytes ?? m.media?.sizeBytes ?? null,
    };
  });

  const { data, error } = await supabaseAdmin
    .from("wa_messages")
    .upsert(rows as never, {
      onConflict: "organization_id,chat_id,wa_message_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;

  const ingested = data?.length ?? 0;
  // Refresh each touched link's stored message_count from the source of truth.
  for (const chatId of byChat.keys()) {
    const { count } = await supabaseAdmin
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("chat_id", chatId);
    if (count !== null) {
      await supabaseAdmin
        .from("wa_group_links")
        .update({ message_count: count })
        .eq("organization_id", orgId)
        .eq("chat_id", chatId);
    }
  }

  return { ingested, skipped: messages.length - ingested, chats: Array.from(byChat.keys()) };
}

// Enrich rows that already existed before a history refresh learned a sender's
// phone/name (for example by resolving an @lid through OpenWA contacts). A
// minimal upsert updates only identity columns and preserves bodies/media.
export async function enrichWaMessageSenders(
  orgId: string,
  messages: NormalMessage[],
): Promise<void> {
  const rows = messages.flatMap((message) => {
    if (!message.senderId && !message.sender) return [];
    const { id } = bareWaMessageId(message.waMessageId);
    if (!id) return [];
    return [{
      organization_id: orgId,
      chat_id: message.chatId,
      wa_message_id: id,
      sender: message.sender,
      sender_id: message.senderId,
    }];
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("wa_messages").upsert(rows.slice(i, i + 500), {
      onConflict: "organization_id,chat_id,wa_message_id",
      ignoreDuplicates: false,
      defaultToNull: false,
    });
    if (error) throw error;
  }
}
