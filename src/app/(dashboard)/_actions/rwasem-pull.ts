"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { odooFromEnv } from "@/lib/odoo/client";
import {
  reconcileOdooDeletions,
  runImport,
  syncOneTask,
  syncOneProject,
} from "@/lib/odoo/importer";

// On-demand "Pull from Rwasem (Odoo)" server actions. Single-entity pulls
// refresh one task/project; the list-level pulls run a fast incremental sync
// (a full re-pull would take many minutes and hang the request).

type PullResult = { ok: true; detail: string } | { error: string };
const optionalProjectIdSchema = z.string().uuid().optional();

async function resolveSlug(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .maybeSingle();
  return (data?.slug as string) ?? null;
}

function asPositiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Pull one task: stage/fields + comments + assignees + stage history.
export async function pullTaskAction(odooTaskId: number): Promise<PullResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const id = asPositiveInt(odooTaskId);
  if (!id) return { error: "معرّف مهمة غير صالح" };
  const slug = await resolveSlug(session.orgId);
  if (!slug) return { error: "تعذر تحديد بيانات المنظمة" };

  let res: Awaited<ReturnType<typeof syncOneTask>>;
  try {
    res = await syncOneTask(odooFromEnv(), slug, id);
  } catch (e) {
    return { error: `تعذر الاتصال بـ Rwasem: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: res.error ?? "فشل التحديث" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.pull_odoo",
    entityType: "task",
    entityId: res.taskId ?? null,
    metadata: { odooTaskId: id, comments: res.comments ?? 0 },
  });

  if (res.taskId) revalidatePath(`/tasks/${res.taskId}`);
  revalidatePath("/tasks");
  return { ok: true, detail: `تم تحديث المهمة (${res.comments ?? 0} تعليق)` };
}

// Pull one project: status + fields + tags/services/members.
export async function pullProjectAction(odooProjectId: number): Promise<PullResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const id = asPositiveInt(odooProjectId);
  if (!id) return { error: "معرّف مشروع غير صالح" };
  const slug = await resolveSlug(session.orgId);
  if (!slug) return { error: "تعذر تحديد بيانات المنظمة" };

  let res: Awaited<ReturnType<typeof syncOneProject>>;
  try {
    res = await syncOneProject(odooFromEnv(), slug, id);
  } catch (e) {
    return { error: `تعذر الاتصال بـ Rwasem: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: res.error ?? "فشل التحديث" };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.pull_odoo",
    entityType: "project",
    entityId: res.projectId ?? null,
    metadata: { odooProjectId: id },
  });

  if (res.projectId) revalidatePath(`/projects/${res.projectId}`);
  revalidatePath("/projects");
  return { ok: true, detail: "تم تحديث المشروع" };
}

// List-level pull: fast incremental refresh of tasks (+ their comments), then
// an id-only reconciliation so tasks hard-deleted in Odoo disappear here too.
export async function pullTasksIncrementalAction(projectId?: string): Promise<PullResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const slug = await resolveSlug(session.orgId);
  if (!slug) return { error: "تعذر تحديد بيانات المنظمة" };

  const parsedProjectId = optionalProjectIdSchema.safeParse(projectId);
  if (!parsedProjectId.success) return { error: "معرّف مشروع غير صالح" };

  let taskProjectOdooId: number | undefined;
  if (parsedProjectId.data) {
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("external_id")
      .eq("id", parsedProjectId.data)
      .eq("organization_id", session.orgId)
      .eq("external_source", "odoo")
      .maybeSingle();
    if (error) return { error: `تعذر تحديد المشروع: ${error.message}` };
    const externalId = Number(project?.external_id);
    if (!Number.isInteger(externalId) || externalId <= 0) {
      return { error: "هذا المشروع غير مرتبط بمشروع في رواسم" };
    }
    taskProjectOdooId = externalId;
  }

  let summary;
  let reconciliation;
  try {
    const odoo = odooFromEnv();
    summary = await runImport(odoo, slug, ["tasks", "comments"], "incremental");
    reconciliation = await reconcileOdooDeletions(odoo, slug, {
      scope: "tasks",
      // A manual Odoo pull only reconciles Odoo-sourced rows. Locally created
      // tasks are outside this button's deletion contract.
      deleteNative: false,
      taskProjectOdooId,
    });
  } catch (e) {
    return { error: `تعذر الاتصال بـ Rwasem: ${(e as Error).message}` };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.pull_odoo_bulk",
    entityType: "organization",
    entityId: session.orgId,
    metadata: {
      tasks: summary.tasks,
      comments: summary.taskComments,
      tasksDeleted: reconciliation.tasksDeleted,
      taskProjectOdooId: taskProjectOdooId ?? null,
      errors: summary.errors.length + reconciliation.errors.length,
      reconciliationErrors: reconciliation.errors,
    },
  });

  revalidatePath("/tasks");
  if (reconciliation.errors.length > 0) {
    return {
      error: `تم جلب التحديثات، لكن تعذرت مطابقة المهام المحذوفة: ${reconciliation.errors.join("; ")}`,
    };
  }
  return {
    ok: true,
    detail: `تم تحديث ${summary.tasks} مهمة و ${summary.taskComments} تعليق، وحذف ${reconciliation.tasksDeleted} مهمة لم تعد موجودة في رواسم`,
  };
}

// List-level pull: fast incremental refresh of projects (status + fields).
export async function pullProjectsIncrementalAction(): Promise<PullResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const slug = await resolveSlug(session.orgId);
  if (!slug) return { error: "تعذر تحديد بيانات المنظمة" };

  let summary;
  try {
    summary = await runImport(odooFromEnv(), slug, ["projects"], "incremental");
  } catch (e) {
    return { error: `تعذر الاتصال بـ Rwasem: ${(e as Error).message}` };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.pull_odoo_bulk",
    entityType: "organization",
    entityId: session.orgId,
    metadata: { projects: summary.projects, errors: summary.errors.length },
  });

  revalidatePath("/projects");
  return { ok: true, detail: `تم تحديث ${summary.projects} مشروع` };
}
