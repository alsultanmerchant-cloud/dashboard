"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

const HoldSchema = z.object({
  project_id: z.string().uuid({ message: "معرف المشروع غير صالح" }),
  reason: z
    .string()
    .trim()
    .min(3, "السبب قصير جدًا")
    .max(500, "السبب طويل جدًا (الحد الأقصى 500 حرف)"),
});

const ResumeSchema = z.object({
  project_id: z.string().uuid({ message: "معرف المشروع غير صالح" }),
});

export async function holdProjectAction(input: {
  projectId: string;
  reason: string;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = HoldSchema.safeParse({
    project_id: input.projectId,
    reason: input.reason,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: existing } = await supabaseAdmin
    .from("projects")
    .select("id, status, organization_id")
    .eq("id", parsed.data.project_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!existing) return { error: "المشروع غير موجود" };
  if (existing.status === "on_hold") {
    return { error: "المشروع موقوف بالفعل" };
  }

  const heldAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      status: "on_hold",
      hold_reason: parsed.data.reason,
      held_at: heldAt,
    })
    .eq("id", parsed.data.project_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.hold",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { reason: parsed.data.reason, from_status: existing.status },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_HELD",
    entityType: "project",
    entityId: parsed.data.project_id,
    payload: {
      reason: parsed.data.reason,
      from_status: existing.status,
      held_at: heldAt,
    },
    importance: "high",
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}

export async function resumeProjectAction(input: {
  projectId: string;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ResumeSchema.safeParse({ project_id: input.projectId });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const { data: existing } = await supabaseAdmin
    .from("projects")
    .select("id, status, hold_reason, held_at, organization_id")
    .eq("id", parsed.data.project_id)
    .eq("organization_id", session.orgId)
    .maybeSingle();
  if (!existing) return { error: "المشروع غير موجود" };
  if (existing.status !== "on_hold") {
    return { error: "المشروع ليس في حالة إيقاف" };
  }

  const { error } = await supabaseAdmin
    .from("projects")
    .update({
      status: "active",
      hold_reason: null,
      held_at: null,
    })
    .eq("id", parsed.data.project_id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.resume",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: {
      previous_reason: existing.hold_reason,
      previous_held_at: existing.held_at,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "PROJECT_RESUMED",
    entityType: "project",
    entityId: parsed.data.project_id,
    payload: {
      previous_reason: existing.hold_reason,
      previous_held_at: existing.held_at,
    },
    importance: "normal",
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}
