"use server";

// Server actions for per-user saved task filters (migration 0052).
// Each user only ever reads/writes their own; RLS enforces it.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ActionResult = { ok: true } | { error: string };

const DefinitionSchema = z.object({
  filter: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
  view: z.enum(["kanban", "list", "calendar"]).optional(),
  groupBy: z.string().max(40).optional(),
  projectId: z.string().uuid().optional(),
}).strict();

const SaveSchema = z.object({
  name: z.string().trim().min(1, "اكتب اسمًا للفلتر").max(80),
  definition: DefinitionSchema,
  is_default: z.boolean().default(false),
});

const RenameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  definition: DefinitionSchema.optional(),
  is_default: z.boolean().optional(),
});

const IdSchema = z.object({ id: z.string().uuid() });

export async function saveTaskFilterAction(input: {
  name: string;
  definition: z.infer<typeof DefinitionSchema>;
  isDefault?: boolean;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = SaveSchema.safeParse({
    name: input.name,
    definition: input.definition,
    is_default: input.isDefault ?? false,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const supa = await createServerSupabaseClient();

  // If marking as default, unset any existing default first (the unique
  // partial index would otherwise reject the upsert).
  if (parsed.data.is_default) {
    await supa
      .from("user_task_filters")
      .update({ is_default: false })
      .eq("user_id", session.userId)
      .eq("organization_id", session.orgId)
      .eq("is_default", true);
  }

  // Upsert by (user_id, organization_id, name).
  const { error } = await supa.from("user_task_filters").upsert(
    {
      user_id: session.userId,
      organization_id: session.orgId,
      name: parsed.data.name,
      definition: parsed.data.definition,
      is_default: parsed.data.is_default,
    },
    { onConflict: "user_id,organization_id,name" },
  );
  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return { ok: true };
}

export async function updateTaskFilterAction(input: {
  id: string;
  name?: string;
  definition?: z.infer<typeof DefinitionSchema>;
  isDefault?: boolean;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RenameSchema.safeParse({
    id: input.id,
    name: input.name,
    definition: input.definition,
    is_default: input.isDefault,
  });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();

  if (parsed.data.is_default === true) {
    await supa
      .from("user_task_filters")
      .update({ is_default: false })
      .eq("user_id", session.userId)
      .eq("organization_id", session.orgId)
      .eq("is_default", true);
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.definition !== undefined) patch.definition = parsed.data.definition;
  if (parsed.data.is_default !== undefined) patch.is_default = parsed.data.is_default;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supa
    .from("user_task_filters")
    .update(patch)
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteTaskFilterAction(input: {
  id: string;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("tasks.view");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = IdSchema.safeParse({ id: input.id });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("user_task_filters").delete().eq("id", parsed.data.id);
  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return { ok: true };
}

export async function listTaskFiltersForUser(orgId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_task_filters")
    .select("id, name, definition, is_default, updated_at")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    name: string;
    definition: Record<string, string | undefined>;
    is_default: boolean;
    updated_at: string;
  }>;
}
