"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
  const followerEmployeeIds = formData
    .getAll("follower_employee_ids")
    .map(String)
    .filter(Boolean);

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

  // Per-service position → employee assignment from the ServiceTeamPanel.
  type TeamEntry = {
    serviceId: string;
    positionSlug: string;
    employeeId: string;
    isExtra: boolean;
  };
  let serviceTeam: TeamEntry[] = [];
  const teamRaw = formData.get("service_team");
  if (typeof teamRaw === "string" && teamRaw.length > 0) {
    try {
      const parsedTeam = JSON.parse(teamRaw);
      if (Array.isArray(parsedTeam)) {
        serviceTeam = parsedTeam.filter(
          (e): e is TeamEntry =>
            !!e &&
            typeof e.serviceId === "string" &&
            typeof e.positionSlug === "string" &&
            typeof e.employeeId === "string",
        );
      }
    } catch {
      // ignore — an unparseable blob just means no team assignment.
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
    social_specialist_id: formData.get("social_specialist_id"),
    media_specialist_id: formData.get("media_specialist_id"),
    seo_specialist_id: formData.get("seo_specialist_id"),
    social_manager_id: formData.get("social_manager_id"),
    media_manager_id: formData.get("media_manager_id"),
    seo_manager_id: formData.get("seo_manager_id"),
    service_ids: serviceIds,
    generate_tasks: generateTasks,
    service_week_splits: serviceWeekSplits,
    package_name: formData.get("package_name"),
    duration_label: formData.get("duration_label"),
    follower_employee_ids: followerEmployeeIds,
    constant_assignee_employee_id: formData.get("constant_assignee_employee_id"),
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
      social_specialist_id: parsed.data.social_specialist_id,
      media_specialist_id: parsed.data.media_specialist_id,
      seo_specialist_id: parsed.data.seo_specialist_id,
      social_manager_id: parsed.data.social_manager_id,
      media_manager_id: parsed.data.media_manager_id,
      seo_manager_id: parsed.data.seo_manager_id,
      package_name: parsed.data.package_name,
      duration_label: parsed.data.duration_label,
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

  // Persist the per-service team assignment. Each (service, position) maps to
  // one employee; task generation reads this to fill task_assignees.
  const teamForServices = serviceTeam.filter((e) =>
    parsed.data.service_ids.includes(e.serviceId),
  );
  if (teamForServices.length > 0) {
    const slugs = Array.from(new Set(teamForServices.map((e) => e.positionSlug)));
    const { data: positionRows } = await supabaseAdmin
      .from("positions")
      .select("id, slug")
      .eq("organization_id", session.orgId)
      .in("slug", slugs);
    const positionIdBySlug = new Map(
      (positionRows ?? []).map((p) => [p.slug, p.id]),
    );
    // Dedupe on (service, position) — the table's unique key.
    const seen = new Set<string>();
    const teamRows = teamForServices
      .map((e) => {
        const positionId = positionIdBySlug.get(e.positionSlug);
        if (!positionId) return null;
        const key = `${e.serviceId}|${positionId}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          organization_id: session!.orgId,
          project_id: project.id,
          service_id: e.serviceId,
          position_id: positionId,
          employee_id: e.employeeId,
          is_extra: e.isExtra === true,
          created_by: session!.userId,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (teamRows.length > 0) {
      const { error: teamErr } = await supabaseAdmin
        .from("project_service_team")
        .insert(teamRows);
      if (teamErr) {
        console.error("[createProject_team_failed]", teamErr.message);
      }
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

  // Followers picked at create time → project_followers (org-scoped, RLS-gated).
  if (parsed.data.follower_employee_ids.length > 0) {
    await supabaseAdmin.from("project_followers").insert(
      parsed.data.follower_employee_ids.map((eid) => ({
        organization_id: session!.orgId,
        project_id: project.id,
        employee_id: eid,
        added_by: session!.userId,
      })),
    );
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
        socialSpecialistEmployeeId: parsed.data.social_specialist_id,
        mediaSpecialistEmployeeId: parsed.data.media_specialist_id,
        seoSpecialistEmployeeId: parsed.data.seo_specialist_id,
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

  // Constant assignee — every task on this project gets this employee as
  // an extra agent assignee. Idempotent: skip rows that already exist.
  if (
    parsed.data.constant_assignee_employee_id &&
    parsed.data.generate_tasks &&
    taskCount > 0
  ) {
    const { data: createdTasks } = await supabaseAdmin
      .from("tasks")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("project_id", project.id);
    if (createdTasks && createdTasks.length > 0) {
      const rows = createdTasks.map((t) => ({
        organization_id: session!.orgId,
        task_id: t.id as string,
        employee_id: parsed.data.constant_assignee_employee_id!,
        role_type: "agent" as const,
      })).filter((row) => row.employee_id !== parsed.data.account_manager_employee_id);
      // Insert ignoring conflicts on (task_id, employee_id, role_type) — the
      // unique index prevents dupes when generate-tasks already added them.
      const { error: caErr } = await supabaseAdmin
        .from("task_assignees")
        .upsert(rows, {
          onConflict: "task_id,employee_id,role_type",
          ignoreDuplicates: true,
        });
      if (caErr) console.warn(`constant_assignee: ${caErr.message}`);
    }
  }

  revalidatePath("/projects");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true, projectId: project.id, taskCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline "create client" used by the new-project wizard.
// Returns { id, name } so the picker can select the freshly-created row.
// ─────────────────────────────────────────────────────────────────────────────

const QuickClientSchema = z.object({
  name: z.string().trim().min(2, { message: "اسم العميل قصير" }),
  phone: z.string().trim().optional().nullable().transform((v) => v || null),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || null),
});

export type QuickClientResult =
  | { ok: true; client: { id: string; name: string } }
  | { ok: false; error: string };

export async function createClientQuickAction(
  input: { name: string; phone?: string; email?: string },
): Promise<QuickClientResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const parsed = QuickClientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      organization_id: session.orgId,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      status: "active",
      created_by: session.userId,
    })
    .select("id, name")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "تعذر الإنشاء" };
  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.create",
    entityType: "client",
    entityId: data.id,
    metadata: { source: "new_project_wizard" },
  });
  revalidatePath("/clients");
  revalidatePath("/projects/new");
  return { ok: true, client: { id: data.id, name: data.name } };
}
