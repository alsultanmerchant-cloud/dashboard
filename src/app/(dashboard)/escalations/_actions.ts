"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent, createNotification } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLoose = z.string().regex(UUID_RE, { message: "معرّف غير صالح" });

const OpenExceptionSchema = z.object({
  task_id: uuidLoose,
  kind: z.enum(["client", "deadline", "quality", "resource"]),
  reason: z.string().trim().min(3, { message: "اشرح سبب الاستثناء" }).max(2000),
});

const ResolveExceptionSchema = z.object({
  id: uuidLoose,
  note: z.string().trim().min(3, { message: "أضف ملاحظة الإغلاق" }).max(2000),
});

const AcknowledgeSchema = z.object({
  id: uuidLoose,
});

export type EscalationActionState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string>;
  exceptionId?: string;
};

function fieldErrors(parsed: z.SafeParseError<unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const k = issue.path[0];
    if (typeof k === "string") out[k] = issue.message;
  }
  return out;
}

export async function openExceptionAction(
  _prev: EscalationActionState | undefined,
  formData: FormData,
): Promise<EscalationActionState> {
  let session;
  try {
    session = await requirePermission("exception.open");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = OpenExceptionSchema.safeParse({
    task_id: formData.get("task_id"),
    kind: formData.get("kind"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: "تحقق من بيانات النموذج", fieldErrors: fieldErrors(parsed) };
  }

  // Org-scope check: task must belong to caller's org.
  const { data: task } = await supabaseAdmin
    .from("tasks")
    .select("id, organization_id, stage_entered_at, title")
    .eq("id", parsed.data.task_id)
    .maybeSingle();
  if (!task || task.organization_id !== session.orgId) {
    return { error: "المهمة غير موجودة" };
  }

  const { data: exc, error } = await supabaseAdmin
    .from("exceptions")
    .insert({
      organization_id: session.orgId,
      task_id: parsed.data.task_id,
      kind: parsed.data.kind,
      reason: parsed.data.reason,
      opened_by: session.userId,
      stage_entered_at: task.stage_entered_at,
    })
    .select("id")
    .single();
  if (error || !exc) {
    return { error: "تعذر فتح الاستثناء: " + (error?.message ?? "") };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "exception.open",
    entityType: "exception",
    entityId: exc.id,
    metadata: {
      task_id: parsed.data.task_id,
      kind: parsed.data.kind,
      reason: parsed.data.reason,
    },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "EXCEPTION_OPENED",
    entityType: "task",
    entityId: parsed.data.task_id,
    payload: {
      exception_id: exc.id,
      kind: parsed.data.kind,
    },
    importance: "high",
  });

  revalidatePath(`/tasks/${parsed.data.task_id}`);
  revalidatePath("/escalations");
  revalidatePath("/dashboard");
  return { ok: true, exceptionId: exc.id };
}

export async function resolveExceptionAction(
  _prev: EscalationActionState | undefined,
  formData: FormData,
): Promise<EscalationActionState> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ResolveExceptionSchema.safeParse({
    id: formData.get("id"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: "تحقق من بيانات النموذج", fieldErrors: fieldErrors(parsed) };
  }

  const { data: exc } = await supabaseAdmin
    .from("exceptions")
    .select("id, organization_id, task_id, opened_by, resolved_at, kind")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!exc || exc.organization_id !== session.orgId) {
    return { error: "الاستثناء غير موجود" };
  }
  if (exc.resolved_at) {
    return { error: "الاستثناء مغلق مسبقًا" };
  }

  // Permission gate: opener OR escalation.view_all (admin/manager/owner).
  const canResolve =
    exc.opened_by === session.userId ||
    session.isOwner ||
    session.permissions.has("escalation.view_all");
  if (!canResolve) {
    return { error: "صلاحية مفقودة لإغلاق الاستثناء" };
  }

  const { error } = await supabaseAdmin
    .from("exceptions")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: session.userId,
      resolution_note: parsed.data.note,
    })
    .eq("id", parsed.data.id)
    .eq("organization_id", session.orgId);
  if (error) return { error: error.message };

  // Auto-close any open escalations tied to this exception.
  await supabaseAdmin
    .from("escalations")
    .update({ status: "closed" })
    .eq("exception_id", parsed.data.id)
    .eq("status", "open");

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "exception.resolve",
    entityType: "exception",
    entityId: parsed.data.id,
    metadata: { note: parsed.data.note, kind: exc.kind },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "EXCEPTION_RESOLVED",
    entityType: "task",
    entityId: exc.task_id,
    payload: { exception_id: parsed.data.id, kind: exc.kind },
    importance: "normal",
  });

  revalidatePath(`/tasks/${exc.task_id}`);
  revalidatePath("/escalations");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function acknowledgeEscalationAction(
  input: z.infer<typeof AcknowledgeSchema>,
): Promise<EscalationActionState> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = AcknowledgeSchema.safeParse(input);
  if (!parsed.success) return { error: "إدخال غير صالح" };

  const { data: esc } = await supabaseAdmin
    .from("escalations")
    .select("id, organization_id, task_id, raised_to_user_id, status")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!esc || esc.organization_id !== session.orgId) {
    return { error: "التصعيد غير موجود" };
  }
  const canAck =
    esc.raised_to_user_id === session.userId ||
    session.isOwner ||
    session.permissions.has("escalation.acknowledge");
  if (!canAck) return { error: "صلاحية مفقودة" };
  if (esc.status !== "open") return { ok: true };

  const { error } = await supabaseAdmin
    .from("escalations")
    .update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: session.userId,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  // Notify the original opener (if any) — best-effort.
  await createNotification({
    organizationId: session.orgId,
    recipientUserId: null,
    type: "ESCALATION_ACKNOWLEDGED",
    title: `تم الإقرار بتصعيد على مهمة`,
    body: null,
    entityType: "task",
    entityId: esc.task_id,
  });

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "escalation.acknowledge",
    entityType: "escalation",
    entityId: parsed.data.id,
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "ESCALATION_ACKNOWLEDGED",
    entityType: "escalation",
    entityId: parsed.data.id,
    payload: {},
    importance: "normal",
  });

  revalidatePath("/escalations");
  revalidatePath("/dashboard");
  return { ok: true };
}
