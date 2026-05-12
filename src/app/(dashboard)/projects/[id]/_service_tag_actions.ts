"use server";

// Sky Light §3.1: service-level tag toggling. Reuses the org-wide
// project_tags catalog so HOLD/Urgent/etc. live in one place; this just
// attaches/detaches them onto a project_services row instead of the
// project itself.
//
// Permissions mirror _tag_actions.ts (projects.manage).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const Schema = z.object({
  project_id: z.string().uuid(),
  project_service_id: z.string().uuid(),
  tag_id: z.string().uuid(),
});

async function ensureLink(orgId: string, projectId: string, psId: string) {
  const { data } = await supabaseAdmin
    .from("project_services")
    .select("id")
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    .eq("id", psId)
    .maybeSingle();
  return Boolean(data);
}

export async function attachServiceTagAction(input: {
  projectId: string;
  projectServiceId: string;
  tagId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = Schema.safeParse({
    project_id: input.projectId,
    project_service_id: input.projectServiceId,
    tag_id: input.tagId,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };

  if (!(await ensureLink(session.orgId, parsed.data.project_id, parsed.data.project_service_id))) {
    return { error: "الخدمة غير موجودة في هذا المشروع" };
  }

  const { error } = await supabaseAdmin
    .from("project_service_tag_assignments")
    .insert({
      organization_id: session.orgId,
      project_service_id: parsed.data.project_service_id,
      tag_id: parsed.data.tag_id,
      created_by: session.userId,
    });
  if (error && error.code !== "23505") return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project_service.tag_attach",
    entityType: "project_service",
    entityId: parsed.data.project_service_id,
    metadata: { tag_id: parsed.data.tag_id, project_id: parsed.data.project_id },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}

export async function detachServiceTagAction(input: {
  projectId: string;
  projectServiceId: string;
  tagId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = Schema.safeParse({
    project_id: input.projectId,
    project_service_id: input.projectServiceId,
    tag_id: input.tagId,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };

  const { error } = await supabaseAdmin
    .from("project_service_tag_assignments")
    .delete()
    .eq("organization_id", session.orgId)
    .eq("project_service_id", parsed.data.project_service_id)
    .eq("tag_id", parsed.data.tag_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project_service.tag_detach",
    entityType: "project_service",
    entityId: parsed.data.project_service_id,
    metadata: { tag_id: parsed.data.tag_id, project_id: parsed.data.project_id },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}
