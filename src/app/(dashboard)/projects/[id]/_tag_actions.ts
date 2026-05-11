"use server";

// Project-tag CRUD (Sky Light feedback: easy ad-hoc tagging on projects).
// The `project_tags` table is shared org-wide (e.g. HOLD, Urgent, LOST were
// seeded from Odoo). `project_tag_assignments` links a tag to a project.
//   • createOrAttachTagAction — find-or-create a tag by name, attach to project
//   • attachExistingTagAction — attach an existing tag to a project
//   • detachTagAction        — remove the assignment (tag definition kept)
//   • updateTagAction        — rename / recolor a tag definition (org-wide)
//
// Permission model mirrors the rest of the project detail page: caller needs
// `projects.manage` OR ownership. Tag *creation* (org-wide effect) needs the
// same — we don't gate it more strictly because the team explicitly asked
// for it to be easy.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const ATTACH_SCHEMA = z.object({
  project_id: z.string().uuid({ message: "معرف المشروع غير صالح" }),
  tag_id: z.string().uuid({ message: "معرف الوسم غير صالح" }),
});

const CREATE_SCHEMA = z.object({
  project_id: z.string().uuid({ message: "معرف المشروع غير صالح" }),
  name: z
    .string()
    .trim()
    .min(1, "الاسم مطلوب")
    .max(60, "الاسم طويل جدًا"),
  // Odoo color palette — see ODOO_COLORS in project-card.tsx (12 entries).
  color: z.number().int().min(0).max(11),
});

const UPDATE_SCHEMA = z.object({
  tag_id: z.string().uuid({ message: "معرف الوسم غير صالح" }),
  name: z
    .string()
    .trim()
    .min(1, "الاسم مطلوب")
    .max(60, "الاسم طويل جدًا"),
  color: z.number().int().min(0).max(11),
});

async function ensureProjectInOrg(orgId: string, projectId: string) {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", projectId)
    .maybeSingle();
  return Boolean(data);
}

export async function createOrAttachTagAction(input: {
  projectId: string;
  name: string;
  color: number;
}): Promise<{ ok: true; tagId: string } | { error: string }> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CREATE_SCHEMA.safeParse({
    project_id: input.projectId,
    name: input.name,
    color: input.color,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  if (!(await ensureProjectInOrg(session.orgId, parsed.data.project_id))) {
    return { error: "المشروع غير موجود" };
  }

  // Case-insensitive name match within the org. Avoids accidental duplicate
  // tags ("hold" vs "HOLD") which clutter the picker.
  const { data: existing } = await supabaseAdmin
    .from("project_tags")
    .select("id, name, color")
    .eq("organization_id", session.orgId)
    .ilike("name", parsed.data.name)
    .maybeSingle();

  let tagId: string;
  if (existing) {
    tagId = existing.id as string;
  } else {
    const { data: created, error: cErr } = await supabaseAdmin
      .from("project_tags")
      .insert({
        organization_id: session.orgId,
        name: parsed.data.name,
        color: parsed.data.color,
      })
      .select("id")
      .single();
    if (cErr || !created) return { error: cErr?.message ?? "تعذّر إنشاء الوسم" };
    tagId = created.id as string;
    await logAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      action: "project_tag.create",
      entityType: "project_tag",
      entityId: tagId,
      metadata: { name: parsed.data.name, color: parsed.data.color },
    });
  }

  // Attach (idempotent — ignore duplicate-key on the composite PK).
  const { error: aErr } = await supabaseAdmin
    .from("project_tag_assignments")
    .insert({
      project_id: parsed.data.project_id,
      tag_id: tagId,
      organization_id: session.orgId,
    });
  if (aErr && aErr.code !== "23505") return { error: aErr.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.tag_attach",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { tag_id: tagId, name: parsed.data.name },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath("/projects");
  return { ok: true, tagId };
}

export async function attachExistingTagAction(input: {
  projectId: string;
  tagId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ATTACH_SCHEMA.safeParse({
    project_id: input.projectId,
    tag_id: input.tagId,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  if (!(await ensureProjectInOrg(session.orgId, parsed.data.project_id))) {
    return { error: "المشروع غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("project_tag_assignments")
    .insert({
      project_id: parsed.data.project_id,
      tag_id: parsed.data.tag_id,
      organization_id: session.orgId,
    });
  if (error && error.code !== "23505") return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.tag_attach",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { tag_id: parsed.data.tag_id },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath("/projects");
  return { ok: true };
}

export async function detachTagAction(input: {
  projectId: string;
  tagId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ATTACH_SCHEMA.safeParse({
    project_id: input.projectId,
    tag_id: input.tagId,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { error } = await supabaseAdmin
    .from("project_tag_assignments")
    .delete()
    .eq("organization_id", session.orgId)
    .eq("project_id", parsed.data.project_id)
    .eq("tag_id", parsed.data.tag_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.tag_detach",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { tag_id: parsed.data.tag_id },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath("/projects");
  return { ok: true };
}

export async function updateTagAction(input: {
  projectId: string;
  tagId: string;
  name: string;
  color: number;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = UPDATE_SCHEMA.safeParse({
    tag_id: input.tagId,
    name: input.name,
    color: input.color,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { error } = await supabaseAdmin
    .from("project_tags")
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq("organization_id", session.orgId)
    .eq("id", parsed.data.tag_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project_tag.update",
    entityType: "project_tag",
    entityId: parsed.data.tag_id,
    metadata: { name: parsed.data.name, color: parsed.data.color },
  });

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}
