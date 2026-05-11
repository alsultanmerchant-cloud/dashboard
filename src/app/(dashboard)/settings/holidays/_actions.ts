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

type ActionResult =
  | {
      ok: true;
      summary: {
        days_added: number;
        affected_tasks: number;
        affected_projects: number;
        start: string;
        end: string;
      };
    }
  | { error: string };

const CreateSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح")
      .optional(),
    name: z.string().trim().min(2, "الاسم قصير").max(120),
    recurring: z.boolean().default(false),
  })
  .refine(
    (v) => !v.end_date || v.end_date >= v.start_date,
    { message: "تاريخ النهاية يجب أن يكون بعد البداية", path: ["end_date"] },
  );

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

const IdSchema = z.object({ id: z.string().uuid() });

export async function createHolidayAction(input: {
  startDate: string;
  endDate?: string | null;
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
    start_date: input.startDate,
    end_date: input.endDate || undefined,
    name: input.name,
    recurring: input.recurring ?? false,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const start = parsed.data.start_date;
  const end = parsed.data.end_date ?? parsed.data.start_date;
  const dates = enumerateDates(start, end);

  const supa = await createServerSupabaseClient();
  // Insert one row per day in the range. ON CONFLICT-style idempotency via
  // upsert so re-adding a day inside a range that overlaps an existing
  // holiday doesn't fail the whole batch.
  const rows = dates.map((d) => ({
    organization_id: session.orgId,
    holiday_date: d,
    name: parsed.data.name,
    recurring: parsed.data.recurring,
    created_by: session.userId,
  }));
  const { error } = await supa
    .from("holidays")
    .upsert(rows, {
      onConflict: "organization_id,holiday_date,name",
      ignoreDuplicates: true,
    });
  if (error) return { error: error.message };

  // Push affected task deadlines forward. Migration 0098 handles the
  // working-day math; it returns counts so we can show a clear summary.
  const { data: shiftResult, error: shiftErr } = await supabaseAdmin.rpc(
    "shift_tasks_for_holidays",
    { p_org: session.orgId, p_dates: dates },
  );
  if (shiftErr) {
    console.error("shift_tasks_for_holidays failed", shiftErr);
  }
  const summaryRpc = (shiftResult ?? { affected_tasks: 0, affected_projects: 0 }) as {
    affected_tasks: number;
    affected_projects: number;
  };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "holiday.create",
    entityType: "holiday",
    entityId: null,
    metadata: {
      start,
      end,
      name: parsed.data.name,
      recurring: parsed.data.recurring,
      ...summaryRpc,
    },
  });

  await refreshDelayDays(session.orgId);
  revalidatePath("/settings/holidays");
  return {
    ok: true,
    summary: {
      days_added: dates.length,
      affected_tasks: summaryRpc.affected_tasks,
      affected_projects: summaryRpc.affected_projects,
      start,
      end,
    },
  };
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
