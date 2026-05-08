"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createNotification, logAudit } from "@/lib/audit";

const SendInputSchema = z.object({
  recipientEmployeeId: z.string().uuid(),
  body: z.string().trim().max(8000).optional().nullable(),
  contextTaskId: z.string().uuid().optional().nullable(),
  contextProjectId: z.string().uuid().optional().nullable(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(512),
        mimetype: z.string().max(255).optional().nullable(),
        size_bytes: z.number().int().positive().optional().nullable(),
        storage_path: z.string().min(1).max(1024),
      }),
    )
    .max(8)
    .optional()
    .default([]),
});

export type SendDmResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// sendDirectMessageAction
// ─────────────────────────────────────────────────────────────────────────────

export async function sendDirectMessageAction(
  input: z.infer<typeof SendInputSchema>,
): Promise<SendDmResult> {
  let session;
  try {
    session = await requirePermission("notifications.view");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = SendInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  const { recipientEmployeeId, contextTaskId, contextProjectId, attachments } = parsed.data;
  const trimmedBody = parsed.data.body?.trim() || null;

  if (!trimmedBody && (!attachments || attachments.length === 0)) {
    return { ok: false, error: "اكتب نصًا أو أرفق ملفًا قبل الإرسال" };
  }

  // Resolve recipient employee → row (for auth.users.id if any, name, etc.)
  // Employees without auth.users still get DMs; the notification simply
  // can't be delivered until they sign in (we still write the row so it's
  // available when they do).
  const { data: recipient } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, user_id, full_name")
    .eq("organization_id", session.orgId)
    .eq("id", recipientEmployeeId)
    .maybeSingle();
  if (!recipient) {
    return { ok: false, error: "المستلم غير موجود" };
  }
  if (recipient.id === session.employeeId) {
    return { ok: false, error: "لا يمكنك مراسلة نفسك" };
  }

  const { data: message, error } = await supabaseAdmin
    .from("direct_messages")
    .insert({
      organization_id: session.orgId,
      sender_employee_id: session.employeeId,
      recipient_employee_id: recipient.id,
      sender_user_id: session.userId,
      recipient_user_id: recipient.user_id ?? null,
      body: trimmedBody,
      context_task_id: contextTaskId ?? null,
      context_project_id: contextProjectId ?? null,
    })
    .select("id")
    .single();
  if (error || !message) return { ok: false, error: error?.message ?? "تعذر الإرسال" };

  if (attachments && attachments.length > 0) {
    const rows = attachments.map((a) => ({
      organization_id: session.orgId,
      message_id: message.id,
      filename: a.filename,
      mimetype: a.mimetype ?? null,
      size_bytes: a.size_bytes ?? null,
      storage_path: a.storage_path,
      uploaded_by: session.userId,
    }));
    const { error: attErr } = await supabaseAdmin
      .from("direct_message_attachments")
      .insert(rows);
    if (attErr) console.warn("[dm_attachments_failed]", attErr.message);
  }

  // Notification — only deliverable to recipients who have signed in
  // (recipient_user_id is non-null).
  if (recipient.user_id) {
    const preview = trimmedBody
      ? trimmedBody.slice(0, 140)
      : `(${attachments?.length ?? 0} مرفق)`;
    await createNotification({
      organizationId: session.orgId,
      recipientUserId: recipient.user_id,
      type: "DM",
      title: `${session.fullName} أرسل لك رسالة`,
      body: preview,
      entityType: "direct_message",
      entityId: message.id,
    });
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "dm.send",
    entityType: "direct_message",
    entityId: message.id,
    metadata: {
      recipient_employee_id: recipient.id,
      context_task_id: contextTaskId ?? null,
      attachment_count: attachments?.length ?? 0,
    },
  });

  revalidatePath("/notifications");
  revalidatePath("/messages");
  return { ok: true, messageId: message.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// listConversationAction
// ─────────────────────────────────────────────────────────────────────────────

export type ConversationMessage = {
  id: string;
  body: string | null;
  sender_employee_id: string;
  recipient_employee_id: string;
  created_at: string;
  read_at: string | null;
  is_mine: boolean;
  attachments: {
    id: string;
    filename: string;
    mimetype: string | null;
    size_bytes: number | null;
    storage_path: string | null;
  }[];
};

export type ConversationResult =
  | { ok: true; messages: ConversationMessage[]; otherFullName: string; otherAvatarUrl: string | null; otherJobTitle: string | null }
  | { ok: false; error: string };

export async function listConversationAction(
  recipientEmployeeId: string,
  limit = 50,
): Promise<ConversationResult> {
  let session;
  try {
    session = await requirePermission("notifications.view");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const { data: other } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, avatar_url, job_title")
    .eq("organization_id", session.orgId)
    .eq("id", recipientEmployeeId)
    .maybeSingle();
  if (!other) {
    return { ok: false, error: "المستلم غير موجود" };
  }

  const me = session.employeeId;
  const { data: rows, error } = await supabaseAdmin
    .from("direct_messages")
    .select(
      "id, body, sender_employee_id, recipient_employee_id, created_at, read_at, direct_message_attachments ( id, filename, mimetype, size_bytes, storage_path )",
    )
    .eq("organization_id", session.orgId)
    .or(
      `and(sender_employee_id.eq.${me},recipient_employee_id.eq.${other.id}),and(sender_employee_id.eq.${other.id},recipient_employee_id.eq.${me})`,
    )
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return { ok: false, error: error.message };

  const unreadIds = (rows ?? [])
    .filter((m) => m.recipient_employee_id === me && m.read_at === null)
    .map((m) => m.id as string);
  if (unreadIds.length > 0) {
    await supabaseAdmin
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadIds);
  }

  const messages: ConversationMessage[] = (rows ?? []).map((m) => {
    const att = (m as { direct_message_attachments?: ConversationMessage["attachments"] })
      .direct_message_attachments ?? [];
    return {
      id: m.id as string,
      body: (m.body as string | null) ?? null,
      sender_employee_id: m.sender_employee_id as string,
      recipient_employee_id: m.recipient_employee_id as string,
      created_at: m.created_at as string,
      read_at: (m.read_at as string | null) ?? null,
      is_mine: m.sender_employee_id === me,
      attachments: Array.isArray(att) ? att : [],
    };
  });

  return {
    ok: true,
    messages,
    otherFullName: other.full_name as string,
    otherAvatarUrl: (other.avatar_url as string | null) ?? null,
    otherJobTitle: (other.job_title as string | null) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachment upload ticket
// ─────────────────────────────────────────────────────────────────────────────

export type DmAttachmentTicket =
  | { ok: true; storage_path: string; signed_url: string; signed_token: string }
  | { ok: false; error: string };

export async function getDmAttachmentTicketAction(
  filename: string,
): Promise<DmAttachmentTicket> {
  let session;
  try {
    session = await requirePermission("notifications.view");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const safe = filename.replace(/[^\w؀-ۿ.\-]+/g, "_").slice(0, 200);
  const path = `${session.orgId}/dm/${session.userId}/${Date.now()}-${safe}`;
  const { data, error } = await supabaseAdmin.storage
    .from("attachments")
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? "تعذر إنشاء رابط الرفع" };
  return {
    ok: true,
    storage_path: path,
    signed_url: data.signedUrl,
    signed_token: data.token,
  };
}
