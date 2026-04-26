"use server";

import { revalidatePath } from "next/cache";
import { ProjectCreateSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { generateTasksForProjectFromServices } from "@/lib/workflows/generate-tasks";

export type ProjectFormState = {
  ok?: true;
  projectId?: string;
  taskCount?: number;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createProjectAction(
  _prev: ProjectFormState | undefined,
  formData: FormData,
): Promise<ProjectFormState> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const serviceIds = formData.getAll("service_ids").map(String).filter(Boolean);
  const generateTasks = formData.get("generate_tasks") !== "false";

  const parsed = ProjectCreateSchema.safeParse({
    client_id: formData.get("client_id"),
    name: formData.get("name"),
    description: formData.get("description"),
    priority: formData.get("priority") || "medium",
    status: formData.get("status") || "active",
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    account_manager_employee_id: formData.get("account_manager_employee_id"),
    service_ids: serviceIds,
    generate_tasks: generateTasks,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .insert({
      organization_id: session.orgId,
      created_by: session.userId,
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      description: parsed.data.description,
      priority: parsed.data.priority,
      status: parsed.data.status,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      account_manager_employee_id: parsed.data.account_manager_employee_id,
    })
    .select("id, name, start_date")
    .single();
  if (error || !project) {
    return { error: error?.message ?? "تعذر إنشاء المشروع" };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.create",
    entityType: "project",
    entityId: project.id,
    metadata: {
      client_id: parsed.data.client_id,
      service_ids: parsed.data.service_ids,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_CREATED",
    entityType: "project",
    entityId: project.id,
    payload: { name: project.name, services: parsed.data.service_ids.length },
  });

  if (parsed.data.service_ids.length > 0) {
    await supabaseAdmin.from("project_services").insert(
      parsed.data.service_ids.map((service_id) => ({
        organization_id: session!.orgId,
        project_id: project.id,
        service_id,
      })),
    );
    for (const sid of parsed.data.service_ids) {
      await logAiEvent({
        organizationId: session.orgId,
        actorUserId: session.userId,
        eventType: "PROJECT_SERVICE_ATTACHED",
        entityType: "project",
        entityId: project.id,
        payload: { service_id: sid },
        importance: "low",
      });
    }
  }

  // Add account manager as a project member if provided
  if (parsed.data.account_manager_employee_id) {
    await supabaseAdmin.from("project_members").insert({
      organization_id: session.orgId,
      project_id: project.id,
      employee_id: parsed.data.account_manager_employee_id,
      role_label: "مدير الحساب",
    });
  }

  let taskCount = 0;
  if (parsed.data.generate_tasks && parsed.data.service_ids.length > 0) {
    taskCount = await generateTasksForProjectFromServices({
      organizationId: session.orgId,
      projectId: project.id,
      serviceIds: parsed.data.service_ids,
      projectStartDate: project.start_date ?? null,
      accountManagerEmployeeId: parsed.data.account_manager_employee_id,
      createdByUserId: session.userId,
    });
  }

  revalidatePath("/projects");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true, projectId: project.id, taskCount };
}
