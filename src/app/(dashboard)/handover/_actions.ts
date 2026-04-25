"use server";

import { revalidatePath } from "next/cache";
import { HandoverSubmitSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent, createNotification } from "@/lib/audit";
import { generateTasksForProjectFromServices } from "@/lib/workflows/generate-tasks";

export type HandoverFormState = {
  ok?: true;
  handoverId?: string;
  projectId?: string;
  clientId?: string;
  taskCount?: number;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function submitHandoverAction(
  _prev: HandoverFormState | undefined,
  formData: FormData,
): Promise<HandoverFormState> {
  let session;
  try {
    session = await requirePermission("handover.create");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const serviceIds = formData.getAll("selected_service_ids").map(String).filter(Boolean);
  const parsed = HandoverSubmitSchema.safeParse({
    client_name: formData.get("client_name"),
    client_contact_name: formData.get("client_contact_name"),
    client_phone: formData.get("client_phone"),
    client_email: formData.get("client_email"),
    selected_service_ids: serviceIds,
    package_details: formData.get("package_details"),
    project_start_date: formData.get("project_start_date"),
    urgency_level: formData.get("urgency_level") || "normal",
    sales_notes: formData.get("sales_notes"),
    assigned_account_manager_employee_id: formData.get(
      "assigned_account_manager_employee_id",
    ),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }
  const data = parsed.data;

  // 1. Insert handover row first — even partial failures leave a trail.
  const { data: handover, error: handoverErr } = await supabaseAdmin
    .from("sales_handover_forms")
    .insert({
      organization_id: session.orgId,
      submitted_by: session.userId,
      client_name: data.client_name,
      client_contact_name: data.client_contact_name,
      client_phone: data.client_phone,
      client_email: data.client_email,
      selected_service_ids: data.selected_service_ids,
      package_details: data.package_details,
      project_start_date: data.project_start_date,
      urgency_level: data.urgency_level,
      sales_notes: data.sales_notes,
      assigned_account_manager_employee_id: data.assigned_account_manager_employee_id,
      status: "submitted",
    })
    .select("id")
    .single();
  if (handoverErr || !handover) {
    return { error: handoverErr?.message ?? "تعذر إرسال النموذج" };
  }

  // 2. Upsert client — match by phone OR email (case-insensitive) within the org.
  let clientId: string | null = null;
  if (data.client_phone || data.client_email) {
    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("organization_id", session.orgId)
      .or(
        [
          data.client_phone ? `phone.eq.${data.client_phone}` : null,
          data.client_email ? `email.ilike.${data.client_email}` : null,
        ].filter(Boolean).join(",") || "id.eq.00000000-0000-0000-0000-000000000000",
      )
      .limit(1)
      .maybeSingle();
    clientId = existing?.id ?? null;
  }
  if (!clientId) {
    const { data: created, error: clientErr } = await supabaseAdmin
      .from("clients")
      .insert({
        organization_id: session.orgId,
        created_by: session.userId,
        name: data.client_name,
        contact_name: data.client_contact_name,
        phone: data.client_phone,
        email: data.client_email,
        source: "sales_handover",
        status: "active",
      })
      .select("id")
      .single();
    if (clientErr || !created) {
      return { error: "تعذر إنشاء ملف العميل: " + (clientErr?.message ?? "") };
    }
    clientId = created.id;
    await logAiEvent({
      organizationId: session.orgId,
      actorUserId: session.userId,
      eventType: "CLIENT_CREATED",
      entityType: "client",
      entityId: clientId,
      payload: { name: data.client_name, source: "handover" },
    });
  }

  // 3. Map urgency_level → project priority.
  const priorityFromUrgency: Record<typeof data.urgency_level, "low" | "medium" | "high" | "urgent"> = {
    low: "low",
    normal: "medium",
    high: "high",
    critical: "urgent",
  };

  // 4. Create the project.
  const projectName = `${data.client_name} — ${
    new Date(data.project_start_date ?? Date.now()).toLocaleDateString("ar-SA", {
      month: "long",
      year: "numeric",
    })
  }`;

  const { data: project, error: projectErr } = await supabaseAdmin
    .from("projects")
    .insert({
      organization_id: session.orgId,
      created_by: session.userId,
      client_id: clientId,
      name: projectName,
      description: data.package_details,
      priority: priorityFromUrgency[data.urgency_level],
      status: "active",
      start_date: data.project_start_date,
      account_manager_employee_id: data.assigned_account_manager_employee_id,
    })
    .select("id, start_date")
    .single();
  if (projectErr || !project) {
    return { error: "تعذر إنشاء المشروع: " + (projectErr?.message ?? "") };
  }

  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_CREATED",
    entityType: "project",
    entityId: project.id,
    payload: { name: projectName, source: "handover", services: data.selected_service_ids.length },
  });

  // 5. Attach services + ai_events
  await supabaseAdmin.from("project_services").insert(
    data.selected_service_ids.map((service_id) => ({
      organization_id: session!.orgId,
      project_id: project.id,
      service_id,
    })),
  );
  await Promise.all(
    data.selected_service_ids.map((sid) =>
      logAiEvent({
        organizationId: session!.orgId,
        actorUserId: session!.userId,
        eventType: "PROJECT_SERVICE_ATTACHED",
        entityType: "project",
        entityId: project.id,
        payload: { service_id: sid, source: "handover" },
        importance: "low",
      }),
    ),
  );

  // 6. Add AM as project member
  if (data.assigned_account_manager_employee_id) {
    await supabaseAdmin.from("project_members").insert({
      organization_id: session.orgId,
      project_id: project.id,
      employee_id: data.assigned_account_manager_employee_id,
      role_label: "مدير الحساب",
    });
  }

  // 7. Generate tasks
  const taskCount = await generateTasksForProjectFromServices({
    organizationId: session.orgId,
    projectId: project.id,
    serviceIds: data.selected_service_ids,
    projectStartDate: project.start_date ?? null,
    createdByUserId: session.userId,
  });

  // 8. Update handover row with client + project IDs + accept it
  await supabaseAdmin
    .from("sales_handover_forms")
    .update({
      client_id: clientId,
      project_id: project.id,
      status: "accepted",
    })
    .eq("id", handover.id);

  // 9. Notify the assigned AM (or fall back to handover submitter)
  if (data.assigned_account_manager_employee_id) {
    const { data: am } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id")
      .eq("id", data.assigned_account_manager_employee_id)
      .maybeSingle();

    await createNotification({
      organizationId: session.orgId,
      recipientUserId: am?.user_id ?? null,
      recipientEmployeeId: data.assigned_account_manager_employee_id,
      type: "HANDOVER_SUBMITTED",
      title: `تسليم جديد من المبيعات — ${data.client_name}`,
      body: `${data.selected_service_ids.length} خدمة · ${taskCount} مهمة جاهزة`,
      entityType: "project",
      entityId: project.id,
    });
  }

  // 10. Audit + the marquee ai_event
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "handover.submit",
    entityType: "handover",
    entityId: handover.id,
    metadata: {
      client_id: clientId,
      project_id: project.id,
      services: data.selected_service_ids,
      tasks_generated: taskCount,
      urgency: data.urgency_level,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "HANDOVER_SUBMITTED",
    entityType: "handover",
    entityId: handover.id,
    payload: {
      client_id: clientId,
      project_id: project.id,
      services: data.selected_service_ids.length,
      tasks_generated: taskCount,
      urgency: data.urgency_level,
    },
    importance: data.urgency_level === "critical" ? "high" : "normal",
  });

  revalidatePath("/handover");
  revalidatePath("/projects");
  revalidatePath("/clients");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");

  return {
    ok: true,
    handoverId: handover.id,
    projectId: project.id,
    clientId,
    taskCount,
  };
}
