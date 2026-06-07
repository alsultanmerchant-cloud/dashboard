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
  sender: string | null;
  senderId: string | null;
  body: string;
  messageType: string;
  isFromMe: boolean;
  sentAt: string | null; // ISO
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "_serialized" in v) {
    return String((v as { _serialized: unknown })._serialized);
  }
  return null;
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

export function normalizeWaEvents(payload: unknown): NormalMessage[] {
  const objs = pickMessageObjects(payload);
  const out: NormalMessage[] = [];
  for (const m of objs) {
    const chatId =
      str(m.chatId) ?? str(m.from) ?? str((m.chat as Record<string, unknown>)?.id) ?? null;
    if (!chatId) continue;
    // Only group chats (…@g.us). Skip 1:1 to avoid storing personal DMs.
    if (!chatId.endsWith("@g.us")) continue;

    const waMessageId = str(m.id) ?? str(m.messageId) ?? null;
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

    const sender =
      str((m.sender as Record<string, unknown>)?.pushname) ??
      str((m.sender as Record<string, unknown>)?.formattedName) ??
      str(m.notifyName) ??
      str(m.author) ??
      null;

    const tsRaw = m.timestamp ?? m.t ?? null;
    let sentAt: string | null = null;
    if (typeof tsRaw === "number") sentAt = new Date(tsRaw * 1000).toISOString();
    else if (typeof tsRaw === "string" && /^\d+$/.test(tsRaw))
      sentAt = new Date(parseInt(tsRaw, 10) * 1000).toISOString();

    out.push({
      chatId,
      chatName,
      waMessageId,
      sender,
      senderId: str(m.author) ?? str(m.participant) ?? null,
      body,
      messageType: type,
      isFromMe: m.fromMe === true,
      sentAt,
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

export async function ingestWaMessages(messages: NormalMessage[]): Promise<IngestResult> {
  if (messages.length === 0) return { ingested: 0, skipped: 0, chats: [] };
  const orgId = await getDefaultOrgId();

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
  const rows = messages.map((m) => {
    const link = links.get(m.chatId);
    return {
      organization_id: orgId,
      chat_id: m.chatId,
      wa_message_id: m.waMessageId,
      client_id: link?.clientId ?? null,
      group_kind: link?.groupKind ?? null,
      sender: m.sender,
      sender_id: m.senderId,
      body: m.body,
      message_type: m.messageType,
      is_from_me: m.isFromMe,
      sent_at: m.sentAt,
    };
  });

  const { data, error } = await supabaseAdmin
    .from("wa_messages")
    .upsert(rows, {
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
