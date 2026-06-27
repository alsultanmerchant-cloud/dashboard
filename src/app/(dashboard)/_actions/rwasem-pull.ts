"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { odooFromEnv } from "@/lib/odoo/client";
import { runImport, syncOneTask, syncOneProject } from "@/lib/odoo/importer";

// On-demand "Pull from Rwasem (Odoo)" server actions. Single-entity pulls
// refresh one task/project; the list-level pulls run a fast incremental sync
// (a full re-pull would take many minutes and hang the request).

type PullResult = { ok: true; detail: string } | { error: string };

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

// List-level pull: fast incremental refresh of tasks (+ their comments).
export async function pullTasksIncrementalAction(): Promise<PullResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const slug = await resolveSlug(session.orgId);
  if (!slug) return { error: "تعذر تحديد بيانات المنظمة" };

  let summary;
  try {
    summary = await runImport(odooFromEnv(), slug, ["tasks", "comments"], "incremental");
  } catch (e) {
    return { error: `تعذر الاتصال بـ Rwasem: ${(e as Error).message}` };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.pull_odoo_bulk",
    entityType: "organization",
    entityId: session.orgId,
    metadata: { tasks: summary.tasks, comments: summary.taskComments, errors: summary.errors.length },
  });

  revalidatePath("/tasks");
  return {
    ok: true,
    detail: `تم تحديث ${summary.tasks} مهمة و ${summary.taskComments} تعليق`,
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
