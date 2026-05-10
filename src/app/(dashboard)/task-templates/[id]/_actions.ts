"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Sky Light feedback #10: in Odoo, "Service" = project.category with a
// one2many task_ids tree-editable on the category form. Operators add a new
// template task right there. Our equivalent is task_template (per-service)
// with task_template_items rows. This action lets the dashboard add a new
// item without leaving the template detail page — i.e. "create a new task
// inside this Service" in Odoo terms.

const STAGE_KEYS = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
] as const;

const ROLE_KEYS = [
  "specialist",
  "manager",
  "agent",
  "account_manager",
  "supporting_lead",
  "supporting_agent",
] as const;

const StageOwnerSchema = z.object({
  itemId: z.string().uuid(),
  // Map: stage → role-key (or null for "no owner"). Unknown stages are
  // ignored; unknown roles are rejected.
  mapping: z.record(z.string(), z.union([z.enum(ROLE_KEYS), z.null()])),
});

export type StageOwnerResult = { ok: true } | { ok: false; error: string };

export async function updateStageOwnerPositionsAction(
  input: { itemId: string; mapping: Record<string, string | null> },
): Promise<StageOwnerResult> {
  let session;
  try {
    session = await requirePermission("templates.manage");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = StageOwnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  // Filter the incoming mapping to known stage keys only — keeps the JSON
  // tidy and protects against typos in the client payload.
  const cleaned: Record<string, string | null> = {};
  for (const stage of STAGE_KEYS) {
    cleaned[stage] = (parsed.data.mapping[stage] ?? null) as string | null;
  }

  // Verify the item belongs to the caller's org BEFORE writing.
  const { data: existing } = await supabaseAdmin
    .from("task_template_items")
    .select("id, organization_id, task_template_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!existing || existing.organization_id !== session.orgId) {
    return { ok: false, error: "البند غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("task_template_items")
    .update({ stage_owner_positions: cleaned })
    .eq("id", parsed.data.itemId)
    .eq("organization_id", session.orgId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_template_item.update_stage_owners",
    entityType: "task_template_item",
    entityId: parsed.data.itemId,
    metadata: { mapping: cleaned, template_id: existing.task_template_id },
  });
  revalidatePath(`/task-templates/${existing.task_template_id}`);
  return { ok: true };
}

const PRIORITY_KEYS = ["low", "medium", "high", "urgent"] as const;

const CreateItemSchema = z.object({
  templateId: z.string().uuid(),
  title: z.string().trim().min(2, "العنوان قصير").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  default_role_key: z
    .enum(ROLE_KEYS)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  default_department_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  offset_days_from_project_start: z.coerce.number().int().min(0).max(3650),
  duration_days: z.coerce.number().int().min(1).max(3650),
  priority: z.enum(PRIORITY_KEYS).default("medium"),
});

export type CreateItemResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createTaskTemplateItemAction(input: {
  templateId: string;
  title: string;
  description?: string | null;
  default_role_key?: (typeof ROLE_KEYS)[number] | null;
  default_department_id?: string | null;
  offset_days_from_project_start: number;
  duration_days: number;
  priority?: (typeof PRIORITY_KEYS)[number];
}): Promise<CreateItemResult> {
  let session;
  try {
    session = await requirePermission("templates.manage");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = CreateItemSchema.safeParse({
    templateId: input.templateId,
    title: input.title,
    description: input.description ?? undefined,
    default_role_key: input.default_role_key ?? null,
    default_department_id: input.default_department_id ?? null,
    offset_days_from_project_start: input.offset_days_from_project_start,
    duration_days: input.duration_days,
    priority: input.priority ?? "medium",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة",
    };
  }

  const { data: template } = await supabaseAdmin
    .from("task_templates")
    .select("id, organization_id")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template || template.organization_id !== session.orgId) {
    return { ok: false, error: "القالب غير موجود" };
  }

  // Append to the end — read the current max order_index so a new row
  // becomes step N+1 rather than mid-sequence.
  const { data: maxRow } = await supabaseAdmin
    .from("task_template_items")
    .select("order_index")
    .eq("task_template_id", parsed.data.templateId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.order_index ?? -1) + 1;

  const { data: inserted, error } = await supabaseAdmin
    .from("task_template_items")
    .insert({
      organization_id: session.orgId,
      task_template_id: parsed.data.templateId,
      title: parsed.data.title,
      description: parsed.data.description,
      default_role_key: parsed.data.default_role_key,
      default_department_id: parsed.data.default_department_id,
      offset_days_from_project_start: parsed.data.offset_days_from_project_start,
      duration_days: parsed.data.duration_days,
      priority: parsed.data.priority,
      order_index: nextOrder,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "تعذر الحفظ" };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_template_item.create",
    entityType: "task_template_item",
    entityId: inserted.id,
    metadata: {
      template_id: parsed.data.templateId,
      title: parsed.data.title,
      order_index: nextOrder,
    },
  });

  revalidatePath(`/task-templates/${parsed.data.templateId}`);
  revalidatePath(`/task-templates`);
  return { ok: true, id: inserted.id };
}
