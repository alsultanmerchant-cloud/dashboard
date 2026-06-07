"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { parseWhatsAppChat } from "@/lib/whatsapp/parse";
import { listGroups, waConfigured } from "@/lib/wa/openwa-client";

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
  groupKind: z.enum(["client", "technical"]).nullable(),
  isActive: z.boolean(),
});

export type MapState = { ok?: true; error?: string };

export async function mapWaGroupAction(input: {
  chatId: string;
  clientId: string | null;
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
  const { chatId, clientId, groupKind, isActive } = parsed.data;

  const { error } = await supabaseAdmin
    .from("wa_group_links")
    .update({
      client_id: clientId,
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
    metadata: { clientId, groupKind, isActive },
  });

  revalidatePath("/satisfaction/groups");
  revalidatePath("/satisfaction");
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
    const { data: existing } = await supabaseAdmin
      .from("wa_group_links")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("chat_id", g.id)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("wa_group_links")
        .update({ chat_name: g.name, updated_at: new Date().toISOString() })
        .eq("organization_id", session.orgId)
        .eq("chat_id", g.id);
    } else {
      await supabaseAdmin
        .from("wa_group_links")
        .insert({ organization_id: session.orgId, chat_id: g.id, chat_name: g.name });
    }
  }

  revalidatePath("/satisfaction/groups");
  return { ok: true, found: groups.length };
}
