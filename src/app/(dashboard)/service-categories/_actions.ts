"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLoose = z.string().regex(UUID_RE);

const UpsertSchema = z.object({
  id: uuidLoose.optional(),
  key: z.string().trim().min(2).max(80),
  name_ar: z.string().trim().min(2).max(120),
  name_en: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  service_id: z.union([z.literal(""), uuidLoose]).optional().nullable().transform((v) => v || null),
  description: z.string().trim().max(400).optional().nullable().transform((v) => v || null),
  color: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  is_active: z.boolean().default(true),
});

export type CategoryActionState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function upsertCategoryAction(
  _prev: CategoryActionState | undefined,
  formData: FormData,
): Promise<CategoryActionState> {
  let session;
  try {
    session = await requirePermission("category.manage_templates");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = UpsertSchema.safeParse({
    id: formData.get("id") || undefined,
    key: formData.get("key"),
    name_ar: formData.get("name_ar"),
    name_en: formData.get("name_en"),
    service_id: formData.get("service_id"),
    description: formData.get("description"),
    color: formData.get("color"),
    is_active: formData.get("is_active") === "true",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  const isUpdate = !!parsed.data.id;
  const payload = {
    organization_id: session.orgId,
    key: parsed.data.key,
    name_ar: parsed.data.name_ar,
    name_en: parsed.data.name_en,
    service_id: parsed.data.service_id,
    description: parsed.data.description,
    color: parsed.data.color,
    is_active: parsed.data.is_active,
  };

  if (isUpdate) {
    const { error } = await supabaseAdmin
      .from("service_categories")
      .update(payload)
      .eq("id", parsed.data.id!)
      .eq("organization_id", session.orgId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabaseAdmin
      .from("service_categories")
      .insert(payload);
    if (error) return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: isUpdate ? "service_category.update" : "service_category.create",
    entityType: "service_category",
    entityId: parsed.data.id ?? null,
    metadata: { key: parsed.data.key, name_ar: parsed.data.name_ar },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: isUpdate ? "SERVICE_CATEGORY_UPDATED" : "SERVICE_CATEGORY_CREATED",
    entityType: "service_category",
    entityId: parsed.data.id ?? null,
    payload: { key: parsed.data.key },
    importance: "low",
  });

  revalidatePath("/service-categories");
  return { ok: true };
}

const ReorderSchema = z.object({
  id: uuidLoose,
  direction: z.enum(["up", "down"]),
});

export async function reorderCategoryAction(input: z.infer<typeof ReorderSchema>) {
  let session;
  try {
    session = await requirePermission("category.manage_templates");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = ReorderSchema.safeParse(input);
  if (!parsed.success) return { error: "إدخال غير صالح" };

  // Pull all categories for this org ordered, swap the target with its
  // neighbour. Idempotent and avoids a sparse sort_order.
  const { data: rows } = await supabaseAdmin
    .from("service_categories")
    .select("id, sort_order")
    .eq("organization_id", session.orgId)
    .order("sort_order", { ascending: true })
    .order("name_ar", { ascending: true });
  const list = rows ?? [];
  const idx = list.findIndex((r) => r.id === parsed.data.id);
  if (idx < 0) return { error: "غير موجود" };
  const swapWith = parsed.data.direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return { ok: true };

  const a = list[idx];
  const b = list[swapWith];
  await supabaseAdmin.from("service_categories").update({ sort_order: b.sort_order ?? swapWith })
    .eq("id", a.id).eq("organization_id", session.orgId);
  await supabaseAdmin.from("service_categories").update({ sort_order: a.sort_order ?? idx })
    .eq("id", b.id).eq("organization_id", session.orgId);

  // Resolve any ties by re-numbering the whole list (best-effort).
  await Promise.all(
    list.map((row, i) =>
      supabaseAdmin
        .from("service_categories")
        .update({ sort_order: row.id === a.id ? swapWith : row.id === b.id ? idx : i })
        .eq("id", row.id)
        .eq("organization_id", session!.orgId),
    ),
  );

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "service_category.reorder",
    entityType: "service_category",
    entityId: parsed.data.id,
    metadata: { direction: parsed.data.direction },
  });

  revalidatePath("/service-categories");
  return { ok: true };
}
