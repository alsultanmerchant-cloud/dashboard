"use server";

// Sky Light feedback #12: multi-package management after project creation.
// The wizard already supports multi-select; what was missing is the
// add/remove-service flow on an existing project. This file is the small
// server-action surface so the chip list on the project detail page can
// mutate project_services without a redirect.
//
// Importer note: `services` (the lookup table) is the canonical service
// catalog. Each row mirrors one Odoo `project.category` (mapped via the
// importer's `serviceIdMap`). project_services is the m2m link table.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logAudit, logAiEvent } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const AttachSchema = z.object({
  project_id: z.string().uuid(),
  service_id: z.string().uuid(),
});

const DetachSchema = z.object({
  project_id: z.string().uuid(),
  service_id: z.string().uuid(),
});

export async function attachProjectServiceAction(input: {
  projectId: string;
  serviceId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = AttachSchema.safeParse({
    project_id: input.projectId,
    service_id: input.serviceId,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();

  // Confirm the project lives in this org (RLS would also catch it, but a
  // friendlier message helps).
  const { data: project } = await supa
    .from("projects")
    .select("id, organization_id, name")
    .eq("id", parsed.data.project_id)
    .maybeSingle();
  if (!project || project.organization_id !== session.orgId) {
    return { error: "المشروع غير موجود" };
  }

  // Confirm the service exists.
  const { data: service } = await supa
    .from("services")
    .select("id, name")
    .eq("id", parsed.data.service_id)
    .maybeSingle();
  if (!service) return { error: "الخدمة غير موجودة" };

  const { error } = await supa.from("project_services").insert({
    organization_id: session.orgId,
    project_id: parsed.data.project_id,
    service_id: parsed.data.service_id,
    status: "active",
  });
  if (error) {
    if (error.code === "23505") {
      // Unique violation — already linked, treat as success.
      return { ok: true };
    }
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.service_attach",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { service_id: parsed.data.service_id, service_name: service.name },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_SERVICE_ATTACHED",
    entityType: "project",
    entityId: parsed.data.project_id,
    payload: { service_id: parsed.data.service_id, service_name: service.name },
    importance: "low",
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}

export async function detachProjectServiceAction(input: {
  projectId: string;
  serviceId: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = DetachSchema.safeParse({
    project_id: input.projectId,
    service_id: input.serviceId,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();
  const { error } = await supa
    .from("project_services")
    .delete()
    .eq("project_id", parsed.data.project_id)
    .eq("service_id", parsed.data.service_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.service_detach",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { service_id: parsed.data.service_id },
  });

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}
