import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export async function logAudit(params: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Json;
}) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    organization_id: params.organizationId,
    actor_user_id: params.actorUserId ?? null,
    action: params.action,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    metadata: (params.metadata ?? {}) as never,
  });
  if (error) console.error("[audit_log_failed]", params.action, error.message);

  // Activity-audit attribution (Phase 3): the ownership-episode triggers can't
  // see the real actor of a dashboard stage advance (moves run as service-role).
  // Stamp it here, best-effort, from the audited actor. Only fires for the two
  // relevant actions so unrelated audit writes pay no cost.
  if (params.actorUserId && params.entityId) {
    if (params.action === "task.stage_change") {
      const { error: e } = await supabaseAdmin.rpc("mark_episode_actor", {
        p_org: params.organizationId,
        p_task: params.entityId,
        p_user: params.actorUserId,
      });
      if (e) console.error("[mark_episode_actor_failed]", e.message);
    } else if (params.action === "task.comment_add") {
      const { error: e } = await supabaseAdmin.rpc("mark_episode_comment", {
        p_org: params.organizationId,
        p_task: params.entityId,
        p_user: params.actorUserId,
      });
      if (e) console.error("[mark_episode_comment_failed]", e.message);
    }
  }
}

export async function logAiEvent(params: {
  organizationId: string;
  actorUserId?: string | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Json;
  importance?: "low" | "normal" | "high" | "critical";
}) {
  const { error } = await supabaseAdmin.from("ai_events").insert({
    organization_id: params.organizationId,
    actor_user_id: params.actorUserId ?? null,
    event_type: params.eventType,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    payload: (params.payload ?? {}) as never,
    importance: params.importance ?? "normal",
  });
  if (error) console.error("[ai_event_failed]", params.eventType, error.message);
}

export async function createNotification(params: {
  organizationId: string;
  recipientUserId?: string | null;
  recipientEmployeeId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      organization_id: params.organizationId,
      recipient_user_id: params.recipientUserId ?? null,
      recipient_employee_id: params.recipientEmployeeId ?? null,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[notification_failed]", params.type, error.message);
    return null;
  }
  await logAiEvent({
    organizationId: params.organizationId,
    eventType: "NOTIFICATION_CREATED",
    entityType: "notification",
    entityId: data?.id ?? null,
    payload: { notification_type: params.type },
    importance: "low",
  });
  return data?.id ?? null;
}
