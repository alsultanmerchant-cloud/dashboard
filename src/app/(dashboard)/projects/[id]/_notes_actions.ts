"use server";

// Project-level log notes (migration 0099). Per-project notes for meetings,
// decisions, blockers — everything that isn't tied to a single task.
// Authors can edit/delete their own; projects.manage can override.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const BodySchema = z
  .string()
  .trim()
  .min(2, "النص قصير جدًا")
  .max(8000, "النص طويل جدًا");

export async function createProjectNoteAction(input: {
  projectId: string;
  body: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const idParsed = z.string().uuid().safeParse(input.projectId);
  const bodyParsed = BodySchema.safeParse(input.body);
  if (!idParsed.success) return { error: "معرف المشروع غير صالح" };
  if (!bodyParsed.success) {
    return { error: bodyParsed.error.issues[0]?.message ?? "نص غير صالح" };
  }

  // Verify the project belongs to this org.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("id", idParsed.data)
    .maybeSingle();
  if (!project) return { error: "المشروع غير موجود" };

  const { error } = await supabaseAdmin.from("project_log_notes").insert({
    organization_id: session.orgId,
    project_id: idParsed.data,
    author_user_id: session.userId,
    body: bodyParsed.data,
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.note_create",
    entityType: "project",
    entityId: idParsed.data,
    metadata: { length: bodyParsed.data.length },
  });

  revalidatePath(`/projects/${idParsed.data}`);
  return { ok: true };
}

export async function updateProjectNoteAction(input: {
  noteId: string;
  body: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const idParsed = z.string().uuid().safeParse(input.noteId);
  const bodyParsed = BodySchema.safeParse(input.body);
  if (!idParsed.success) return { error: "معرف الملاحظة غير صالح" };
  if (!bodyParsed.success) {
    return { error: bodyParsed.error.issues[0]?.message ?? "نص غير صالح" };
  }

  const { data: note } = await supabaseAdmin
    .from("project_log_notes")
    .select("id, project_id, author_user_id, organization_id")
    .eq("organization_id", session.orgId)
    .eq("id", idParsed.data)
    .maybeSingle();
  if (!note) return { error: "الملاحظة غير موجودة" };

  const canEdit =
    note.author_user_id === session.userId ||
    hasPermission(session, "projects.manage");
  if (!canEdit) return { error: "لا تملك صلاحية تعديل هذه الملاحظة" };

  const { error } = await supabaseAdmin
    .from("project_log_notes")
    .update({ body: bodyParsed.data })
    .eq("id", idParsed.data);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.note_update",
    entityType: "project",
    entityId: note.project_id,
    metadata: { note_id: idParsed.data },
  });

  revalidatePath(`/projects/${note.project_id}`);
  return { ok: true };
}

export async function deleteProjectNoteAction(input: {
  noteId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const idParsed = z.string().uuid().safeParse(input.noteId);
  if (!idParsed.success) return { error: "معرف الملاحظة غير صالح" };

  const { data: note } = await supabaseAdmin
    .from("project_log_notes")
    .select("id, project_id, author_user_id")
    .eq("organization_id", session.orgId)
    .eq("id", idParsed.data)
    .maybeSingle();
  if (!note) return { error: "الملاحظة غير موجودة" };

  const canDelete =
    note.author_user_id === session.userId ||
    hasPermission(session, "projects.manage");
  if (!canDelete) return { error: "لا تملك صلاحية حذف هذه الملاحظة" };

  const { error } = await supabaseAdmin
    .from("project_log_notes")
    .delete()
    .eq("id", idParsed.data);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.note_delete",
    entityType: "project",
    entityId: note.project_id,
    metadata: { note_id: idParsed.data },
  });

  revalidatePath(`/projects/${note.project_id}`);
  return { ok: true };
}
