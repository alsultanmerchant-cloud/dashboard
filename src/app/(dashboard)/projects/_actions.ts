"use server";

import { revalidatePath } from "next/cache";
import { ProjectCreateSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { generateTasksForProjectFromServices } from "@/lib/workflows/generate-tasks";
import { generateTasksFromCategories } from "@/lib/projects/generate-from-categories";

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

  // T4: per-service week-split metadata is shipped as a JSON blob on the
  // form to avoid n form-fields per service. The shape is validated by zod
  // below; the dialog/page builds it client-side.
  let serviceWeekSplits: unknown[] = [];
  const splitsRaw = formData.get("service_week_splits");
  if (typeof splitsRaw === "string" && splitsRaw.length > 0) {
    try {
      const parsed = JSON.parse(splitsRaw);
      if (Array.isArray(parsed)) serviceWeekSplits = parsed;
    } catch {
      // ignore — schema validation will surface the issue.
    }
  }

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
    service_week_splits: serviceWeekSplits,
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

  // Build a quick lookup of per-service overrides supplied via the form.
  const splitBySid = new Map<string, { week_split: boolean; weeks: number | null; category_id: string | null }>();
  for (const s of parsed.data.service_week_splits) {
    splitBySid.set(s.service_id, {
      week_split: s.week_split,
      weeks: s.weeks ?? null,
      category_id: s.category_id ?? null,
    });
  }

  if (parsed.data.service_ids.length > 0) {
    await supabaseAdmin.from("project_services").insert(
      parsed.data.service_ids.map((service_id) => {
        const split = splitBySid.get(service_id);
        return {
          organization_id: session!.orgId,
          project_id: project.id,
          service_id,
          category_id: split?.category_id ?? null,
          week_split: split?.week_split ?? false,
          weeks: split?.week_split ? split?.weeks ?? null : null,
        };
      }),
    );
    for (const sid of parsed.data.service_ids) {
      await logAiEvent({
        organizationId: session.orgId,
        actorUserId: session.userId,
        eventType: "PROJECT_SERVICE_ATTACHED",
        entityType: "project",
        entityId: project.id,
        payload: { service_id: sid, week_split: splitBySid.get(sid)?.week_split ?? false },
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
    // T4 path: when any per-service override is present (week_split or
    // category) use the categories engine which honours those signals.
    // Otherwise fall back to the original handover/generate-tasks helper
    // so existing flows keep behaving exactly as before.
    const useCategoriesEngine = parsed.data.service_week_splits.some(
      (s) => s.week_split || s.category_id,
    );
    if (useCategoriesEngine) {
      const result = await generateTasksFromCategories({
        organizationId: session.orgId,
        projectId: project.id,
        serviceSelections: parsed.data.service_ids.map((sid) => {
          const split = splitBySid.get(sid);
          return {
            serviceId: sid,
            weekSplit: split?.week_split ?? false,
            weeks: split?.week_split ? split?.weeks ?? null : null,
            categoryId: split?.category_id ?? null,
          };
        }),
        projectStartDate: project.start_date ?? null,
        accountManagerEmployeeId: parsed.data.account_manager_employee_id,
        createdByUserId: session.userId,
      });
      taskCount = result.count;
    } else {
      taskCount = await generateTasksForProjectFromServices({
        organizationId: session.orgId,
        projectId: project.id,
        serviceIds: parsed.data.service_ids,
        projectStartDate: project.start_date ?? null,
        accountManagerEmployeeId: parsed.data.account_manager_employee_id,
        createdByUserId: session.userId,
      });
    }
  }

  revalidatePath("/projects");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true, projectId: project.id, taskCount };
}
