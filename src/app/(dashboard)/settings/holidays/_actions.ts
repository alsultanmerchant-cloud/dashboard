"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// recompute_task_delay_days(p_org) recomputes tasks.delay_days using the
// working-day calendar (migrations 0055/0057). Fire-and-forget after a
// holiday mutation so reports stay accurate without manual triggers.
async function refreshDelayDays(orgId: string) {
  const { error } = await supabaseAdmin.rpc("recompute_task_delay_days", {
    p_org: orgId,
  });
  if (error) {
    // Don't fail the parent action — log and move on. The cron in 0053
    // will eventually correct any drift.
    console.error("recompute_task_delay_days failed", error);
  }
}

type ActionResult = { ok: true } | { error: string };

const CreateSchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  name: z.string().trim().min(2, "الاسم قصير").max(120),
  recurring: z.boolean().default(false),
});

const IdSchema = z.object({ id: z.string().uuid() });

export async function createHolidayAction(input: {
  date: string;
  name: string;
  recurring?: boolean;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = CreateSchema.safeParse({
    holiday_date: input.date,
    name: input.name,
    recurring: input.recurring ?? false,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("holidays").insert({
    organization_id: session.orgId,
    holiday_date: parsed.data.holiday_date,
    name: parsed.data.name,
    recurring: parsed.data.recurring,
    created_by: session.userId,
  });
  if (error) {
    if (error.code === "23505") return { error: "هذا التاريخ مسجل بالفعل بهذا الاسم" };
    return { error: error.message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "holiday.create",
    entityType: "holiday",
    entityId: null,
    metadata: parsed.data,
  });

  await refreshDelayDays(session.orgId);
  revalidatePath("/settings/holidays");
  return { ok: true };
}

export async function deleteHolidayAction(input: { id: string }): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = IdSchema.safeParse({ id: input.id });
  if (!parsed.success) return { error: "بيانات غير صالحة" };

  const supa = await createServerSupabaseClient();
  const { error } = await supa.from("holidays").delete().eq("id", parsed.data.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "holiday.delete",
    entityType: "holiday",
    entityId: parsed.data.id,
    metadata: {},
  });

  await refreshDelayDays(session.orgId);
  revalidatePath("/settings/holidays");
  return { ok: true };
}
