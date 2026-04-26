"use server";

// Sky Light WhatsApp groups — upsert + delete actions for the per-project
// registry. The `name` defaults follow the manual's convention but can be
// edited from the UI.

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { WhatsAppGroupUpsertSchema } from "@/lib/schemas";

export async function upsertWhatsAppGroupAction(input: {
  projectId: string;
  kind: "client" | "internal";
  name: string;
  inviteUrl?: string | null;
  whatsappChatId?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { error: string }> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = WhatsAppGroupUpsertSchema.safeParse({
    project_id: input.projectId,
    kind: input.kind,
    name: input.name,
    invite_url: input.inviteUrl ?? null,
    whatsapp_chat_id: input.whatsappChatId ?? null,
    notes: input.notes ?? null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Verify project belongs to the org.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("id", parsed.data.project_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!project) return { error: "المشروع غير موجود" };

  // Upsert by (project_id, kind).
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_groups")
    .select("id")
    .eq("project_id", parsed.data.project_id)
    .eq("kind", parsed.data.kind)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from("whatsapp_groups")
      .update({
        name: parsed.data.name,
        invite_url: parsed.data.invite_url,
        whatsapp_chat_id: parsed.data.whatsapp_chat_id,
        notes: parsed.data.notes,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    await logAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      action: "whatsapp_group.update",
      entityType: "project",
      entityId: parsed.data.project_id,
      metadata: { kind: parsed.data.kind, group_id: existing.id },
    });
    revalidatePath(`/projects/${parsed.data.project_id}`);
    return { ok: true, id: existing.id };
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("whatsapp_groups")
    .insert({
      organization_id: session.orgId,
      project_id: parsed.data.project_id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      invite_url: parsed.data.invite_url,
      whatsapp_chat_id: parsed.data.whatsapp_chat_id,
      notes: parsed.data.notes,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { error: error?.message ?? "تعذر إنشاء القروب" };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "whatsapp_group.create",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { kind: parsed.data.kind, group_id: inserted.id },
  });
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true, id: inserted.id };
}

export async function deleteWhatsAppGroupAction(input: {
  projectId: string;
  groupId: string;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { error } = await supabaseAdmin
    .from("whatsapp_groups")
    .delete()
    .eq("id", input.groupId)
    .eq("organization_id", session.orgId)
    .eq("project_id", input.projectId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "whatsapp_group.delete",
    entityType: "project",
    entityId: input.projectId,
    metadata: { group_id: input.groupId },
  });
  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true };
}
