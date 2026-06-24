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

// Schema fragment + cleaner for the per-stage owner map, embedded inline in
// create/update so the "تعديل مهمة القالب" modal sets per-phase owners in
// one save. Map: stage → role-key (or null). Unknown roles are rejected;
// unknown stages are dropped by cleanStageOwnerMap.
const StageOwnerMapSchema = z
  .record(z.string(), z.union([z.string().trim().max(64), z.null()]))
  .optional();

function cleanStageOwnerMap(
  raw: Record<string, string | null> | undefined | null,
): Record<string, string | null> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string | null> = {};
  for (const stage of STAGE_KEYS) out[stage] = raw[stage] ?? null;
  return out;
}

// Per-stage SLA in working minutes (0147). Map: stage → minutes(int) | null.
// Null = use org default (sla_rules) / N-A. Unknown stages dropped.
const StageSlaMapSchema = z
  .record(z.string(), z.union([z.number().int().min(0).max(100000), z.null()]))
  .optional();

function cleanStageSlaMap(
  raw: Record<string, number | null> | undefined | null,
): Record<string, number | null> | undefined {
  if (!raw) return undefined;
  const out: Record<string, number | null> = {};
  for (const stage of STAGE_KEYS) {
    const v = raw[stage];
    out[stage] = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
  }
  return out;
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
    .string().trim().min(1).max(64)
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
  duration_days: z.coerce.number().int().min(0).max(3650),
  // Upload deadline = deadline − this many days. null = task has no upload.
  upload_offset_days_before_deadline: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  priority: z.enum(PRIORITY_KEYS).default("medium"),
  stage_owner_positions: StageOwnerMapSchema,
  stage_sla_overrides: StageSlaMapSchema,
});

export type CreateItemResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createTaskTemplateItemAction(input: {
  templateId: string;
  title: string;
  description?: string | null;
  default_role_key?: string | null;
  default_department_id?: string | null;
  offset_days_from_project_start: number;
  duration_days: number;
  upload_offset_days_before_deadline?: number | null;
  priority?: (typeof PRIORITY_KEYS)[number];
  stage_owner_positions?: Record<string, string | null> | null;
  stage_sla_overrides?: Record<string, number | null> | null;
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
    upload_offset_days_before_deadline:
      input.upload_offset_days_before_deadline ?? null,
    priority: input.priority ?? "medium",
    stage_owner_positions: input.stage_owner_positions ?? undefined,
    stage_sla_overrides: input.stage_sla_overrides ?? undefined,
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

  // Omit stage_owner_positions when not supplied so the column default
  // (the Sky Light convention from migration 0077) applies.
  const stageOwners = cleanStageOwnerMap(parsed.data.stage_owner_positions);
  const stageSla = cleanStageSlaMap(parsed.data.stage_sla_overrides);

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
      upload_offset_days_before_deadline: parsed.data.upload_offset_days_before_deadline,
      priority: parsed.data.priority,
      order_index: nextOrder,
      ...(stageOwners ? { stage_owner_positions: stageOwners } : {}),
      ...(stageSla ? { stage_sla_overrides: stageSla } : {}),
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

// #10: edit an existing template item — Rwasem's project.category task tree
// is editable in place; ours was add/delete-only. Same validated fields as
// create, keyed by itemId.
const UpdateItemSchema = z.object({
  itemId: z.string().uuid(),
  title: z.string().trim().min(2, "العنوان قصير").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  default_role_key: z
    .string().trim().min(1).max(64)
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
  duration_days: z.coerce.number().int().min(0).max(3650),
  upload_offset_days_before_deadline: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  priority: z.enum(PRIORITY_KEYS).default("medium"),
  stage_owner_positions: StageOwnerMapSchema,
  stage_sla_overrides: StageSlaMapSchema,
});

export async function updateTaskTemplateItemAction(input: {
  itemId: string;
  title: string;
  description?: string | null;
  default_role_key?: string | null;
  default_department_id?: string | null;
  offset_days_from_project_start: number;
  duration_days: number;
  upload_offset_days_before_deadline?: number | null;
  priority?: (typeof PRIORITY_KEYS)[number];
  stage_owner_positions?: Record<string, string | null> | null;
  stage_sla_overrides?: Record<string, number | null> | null;
}): Promise<CreateItemResult> {
  let session;
  try {
    session = await requirePermission("templates.manage");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = UpdateItemSchema.safeParse({
    itemId: input.itemId,
    title: input.title,
    description: input.description ?? undefined,
    default_role_key: input.default_role_key ?? null,
    default_department_id: input.default_department_id ?? null,
    offset_days_from_project_start: input.offset_days_from_project_start,
    duration_days: input.duration_days,
    upload_offset_days_before_deadline:
      input.upload_offset_days_before_deadline ?? null,
    priority: input.priority ?? "medium",
    stage_owner_positions: input.stage_owner_positions ?? undefined,
    stage_sla_overrides: input.stage_sla_overrides ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة",
    };
  }

  // Org scope: confirm the item belongs to the caller's org before writing.
  const { data: existing } = await supabaseAdmin
    .from("task_template_items")
    .select("id, organization_id, task_template_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (!existing || existing.organization_id !== session.orgId) {
    return { ok: false, error: "البند غير موجود" };
  }

  // Only overwrite stage_owner_positions when the caller supplied a map —
  // a bare metadata edit must not wipe an existing per-phase owner config.
  const stageOwners = cleanStageOwnerMap(parsed.data.stage_owner_positions);
  const stageSla = cleanStageSlaMap(parsed.data.stage_sla_overrides);

  const { error } = await supabaseAdmin
    .from("task_template_items")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      default_role_key: parsed.data.default_role_key,
      default_department_id: parsed.data.default_department_id,
      offset_days_from_project_start: parsed.data.offset_days_from_project_start,
      duration_days: parsed.data.duration_days,
      upload_offset_days_before_deadline: parsed.data.upload_offset_days_before_deadline,
      priority: parsed.data.priority,
      ...(stageOwners ? { stage_owner_positions: stageOwners } : {}),
      ...(stageSla ? { stage_sla_overrides: stageSla } : {}),
    })
    .eq("id", parsed.data.itemId)
    .eq("organization_id", session.orgId);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task_template_item.update",
    entityType: "task_template_item",
    entityId: parsed.data.itemId,
    metadata: {
      template_id: existing.task_template_id,
      title: parsed.data.title,
    },
  });

  revalidatePath(`/task-templates/${existing.task_template_id}`);
  revalidatePath(`/task-templates`);
  return { ok: true, id: parsed.data.itemId };
}
