"use server";

// Phase T7 — Renewal Cycles server actions.
//
// Lives in a sibling sub-folder to avoid touching the existing
// /projects/_actions.ts (per dispatch scope). Both actions follow the
// project's mutation contract: zod validate → check user → check org
// scope → audit_log + ai_event when business-relevant.
//
// READ-ONLY consumer of the T4 categories engine
// (src/lib/projects/generate-from-categories.ts) — we never modify those
// modules.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { generateTasksFromCategories } from "@/lib/projects/generate-from-categories";

export type RenewalActionState = {
  ok?: true;
  cycleId?: string;
  cycleNo?: number;
  taskCount?: number;
  error?: string;
};

const StartRenewalSchema = z.object({
  project_id: z.string().uuid(),
});

export async function startRenewalCycleAction(
  _prev: RenewalActionState | undefined,
  formData: FormData,
): Promise<RenewalActionState> {
  let session;
  try {
    session = await requirePermission("renewal.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = StartRenewalSchema.safeParse({
    project_id: formData.get("project_id"),
  });
  if (!parsed.success) {
    return { error: "بيانات غير صالحة" };
  }

  // Org-scope check: project must belong to the caller's org.
  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .select(
      "id, organization_id, start_date, account_manager_employee_id, " +
        "cycle_length_months, next_renewal_date",
    )
    .eq("id", parsed.data.project_id)
    .maybeSingle();
  if (projErr || !project) {
    return { error: projErr?.message ?? "المشروع غير موجود" };
  }
  if (project.organization_id !== session.orgId) {
    return { error: "ليس لديك صلاحية على هذا المشروع" };
  }

  // Pick the next cycle_no.
  const { data: existing } = await supabaseAdmin
    .from("renewal_cycles")
    .select("cycle_no")
    .eq("project_id", project.id)
    .order("cycle_no", { ascending: false })
    .limit(1);
  const nextCycleNo = (existing?.[0]?.cycle_no ?? 0) + 1;

  const today = new Date().toISOString().slice(0, 10);
  const startedAt =
    project.next_renewal_date && project.next_renewal_date <= today
      ? project.next_renewal_date
      : today;

  const { data: cycle, error: insErr } = await supabaseAdmin
    .from("renewal_cycles")
    .insert({
      project_id: project.id,
      cycle_no: nextCycleNo,
      started_at: startedAt,
      status: "active",
    })
    .select("id, cycle_no, started_at")
    .single();
  if (insErr || !cycle) {
    return { error: insErr?.message ?? "تعذّر بدء دورة التجديد" };
  }

  // Roll the project's next_renewal_date forward when we know the cadence.
  if (project.cycle_length_months && project.cycle_length_months > 0) {
    const next = new Date(`${startedAt}T00:00:00.000Z`);
    next.setUTCMonth(next.getUTCMonth() + project.cycle_length_months);
    const nextIso = next.toISOString().slice(0, 10);
    await supabaseAdmin
      .from("projects")
      .update({ next_renewal_date: nextIso })
      .eq("id", project.id);
  }

  // Auto-generate renewal-category tasks. Pull the project_services rows
  // so we hand the engine the same week_split / category metadata that
  // was used at creation time.
  const { data: pservices } = await supabaseAdmin
    .from("project_services")
    .select("service_id, category_id, week_split, weeks")
    .eq("project_id", project.id);

  let taskCount = 0;
  if ((pservices?.length ?? 0) > 0) {
    const result = await generateTasksFromCategories({
      organizationId: session.orgId,
      projectId: project.id,
      serviceSelections: (pservices ?? []).map((s) => ({
        serviceId: s.service_id,
        weekSplit: s.week_split ?? false,
        weeks: s.week_split ? s.weeks ?? null : null,
        categoryId: s.category_id ?? null,
      })),
      projectStartDate: startedAt,
      accountManagerEmployeeId: project.account_manager_employee_id,
      createdByUserId: session.userId,
    });
    taskCount = result.count;
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "renewal.start_cycle",
    entityType: "renewal_cycle",
    entityId: cycle.id,
    metadata: {
      project_id: project.id,
      cycle_no: cycle.cycle_no,
      task_count: taskCount,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "RENEWAL_CYCLE_STARTED",
    entityType: "project",
    entityId: project.id,
    payload: {
      cycle_id: cycle.id,
      cycle_no: cycle.cycle_no,
      started_at: cycle.started_at,
      task_count: taskCount,
    },
    importance: "high",
  });

  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { ok: true, cycleId: cycle.id, cycleNo: cycle.cycle_no, taskCount };
}

const SetCycleSchema = z.object({
  project_id: z.string().uuid(),
  cycle_length_months: z
    .union([z.coerce.number().int().min(1).max(36), z.literal("")])
    .transform((v) => (v === "" ? null : Number(v))),
  next_renewal_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
});

export async function setProjectCycleAction(
  _prev: RenewalActionState | undefined,
  formData: FormData,
): Promise<RenewalActionState> {
  let session;
  try {
    session = await requirePermission("renewal.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SetCycleSchema.safeParse({
    project_id: formData.get("project_id"),
    cycle_length_months: formData.get("cycle_length_months") ?? "",
    next_renewal_date: formData.get("next_renewal_date") ?? "",
  });
  if (!parsed.success) {
    return { error: "بيانات غير صالحة" };
  }

  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("id, organization_id")
    .eq("id", parsed.data.project_id)
    .maybeSingle();
  if (projErr || !project) {
    return { error: projErr?.message ?? "المشروع غير موجود" };
  }
  if (project.organization_id !== session.orgId) {
    return { error: "ليس لديك صلاحية على هذا المشروع" };
  }

  const { error: updErr } = await supabaseAdmin
    .from("projects")
    .update({
      cycle_length_months: parsed.data.cycle_length_months,
      next_renewal_date: parsed.data.next_renewal_date,
    })
    .eq("id", project.id);
  if (updErr) return { error: updErr.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "renewal.set_cycle",
    entityType: "project",
    entityId: project.id,
    metadata: {
      cycle_length_months: parsed.data.cycle_length_months,
      next_renewal_date: parsed.data.next_renewal_date,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_RENEWAL_SCHEDULE_SET",
    entityType: "project",
    entityId: project.id,
    payload: {
      cycle_length_months: parsed.data.cycle_length_months,
      next_renewal_date: parsed.data.next_renewal_date,
    },
    importance: "normal",
  });

  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { ok: true };
}
