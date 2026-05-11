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

// Sky Light feedback #10: ad-hoc "create new task" inside a service chip on
// the project detail page. Mirrors the wizard's auto-generation but for one
// task at a time, scoped to a specific service the project is already
// subscribed to.
const CreateServiceTaskSchema = z.object({
  project_id: z.string().uuid(),
  service_id: z.string().uuid(),
  title: z.string().trim().min(2, { message: "عنوان المهمة قصير" }).max(200),
  due_date: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  // ≥1 assignee required (Sky Light spec). Each row carries role + optional
  // team manager so the team lead is captured per-task, not derived from the
  // employee's department head.
  assignees: z
    .array(
      z.object({
        employee_id: z.string().uuid(),
        role_type: z.enum([
          "specialist",
          "manager",
          "agent",
          "account_manager",
        ]),
        team_manager_employee_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1, { message: "يلزم إضافة مُسنَد واحد على الأقل" }),
});

export async function createServiceTaskAction(input: {
  projectId: string;
  serviceId: string;
  title: string;
  dueDate?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  assignees: Array<{
    employeeId: string;
    roleType: "specialist" | "manager" | "agent" | "account_manager";
    teamManagerEmployeeId?: string | null;
  }>;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreateServiceTaskSchema.safeParse({
    project_id: input.projectId,
    service_id: input.serviceId,
    title: input.title,
    due_date: input.dueDate || null,
    priority: input.priority ?? "medium",
    assignees: input.assignees.map((a) => ({
      employee_id: a.employeeId,
      role_type: a.roleType,
      team_manager_employee_id: a.teamManagerEmployeeId ?? null,
    })),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const supa = await createServerSupabaseClient();

  // Verify the project + service are in this org and the service is attached
  // (so we don't create orphan tasks on services the project never bought).
  const { data: project } = await supa
    .from("projects")
    .select("id, organization_id, name")
    .eq("id", parsed.data.project_id)
    .maybeSingle();
  if (!project || project.organization_id !== session.orgId) {
    return { error: "المشروع غير موجود" };
  }
  const { data: link } = await supa
    .from("project_services")
    .select("id")
    .eq("project_id", parsed.data.project_id)
    .eq("service_id", parsed.data.service_id)
    .maybeSingle();
  if (!link) return { error: "الخدمة غير مرتبطة بالمشروع" };

  const { data: inserted, error } = await supa
    .from("tasks")
    .insert({
      organization_id: session.orgId,
      project_id: parsed.data.project_id,
      service_id: parsed.data.service_id,
      title: parsed.data.title,
      priority: parsed.data.priority,
      due_date: parsed.data.due_date,
      created_by: session.userId,
    })
    .select("id, task_code")
    .single();
  if (error) return { error: error.message };

  // Insert assignee rows. Use the admin client so RLS doesn't block — the
  // permission check above (tasks.manage) already gated this.
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { error: aerr } = await supabaseAdmin
    .from("task_assignees")
    .insert(
      parsed.data.assignees.map((a) => ({
        organization_id: session.orgId,
        task_id: inserted.id,
        employee_id: a.employee_id,
        role_type: a.role_type,
        team_manager_employee_id: a.team_manager_employee_id ?? null,
        assigned_by: session.userId,
      })),
    );
  if (aerr) {
    // Roll back the orphan task — keeps the "every task has ≥1 assignee"
    // invariant intact even if the assignee insert fails mid-flight.
    await supabaseAdmin.from("tasks").delete().eq("id", inserted.id);
    return { error: aerr.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.create",
    entityType: "task",
    entityId: inserted.id,
    metadata: {
      project_id: parsed.data.project_id,
      service_id: parsed.data.service_id,
      via: "service_chip",
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "TASK_CREATED",
    entityType: "task",
    entityId: inserted.id,
    payload: {
      title: parsed.data.title,
      project_id: parsed.data.project_id,
      service_id: parsed.data.service_id,
    },
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
