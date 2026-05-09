"use server";

// Cross-task bulk operations from the /tasks list view.
//
// Three op kinds:
//   • stage          — UPDATE tasks.stage. The DB trigger
//                      assert_stage_transition_allowed (migration 0015)
//                      remains the canonical guard; per-task failures are
//                      reported back so the user sees which rows the
//                      role/edge check rejected. We intentionally bypass
//                      the interactive 5-min comment requirement (which is
//                      a per-task UX constraint, not a governance rule).
//   • priority       — bulk UPDATE tasks.priority.
//   • shift_deadline — UPDATE tasks.planned_date := planned_date + N days
//                      (rows without a planned_date are skipped silently).
//
// requirePermission("tasks.manage") gates the whole operation. We confirm
// every id belongs to the caller's organization before issuing UPDATEs.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { TASK_STAGES, PRIORITIES, isForwardStageMove, type TaskStage } from "@/lib/labels";

const StageOp = z.object({
  op: z.literal("stage"),
  ids: z.array(z.string().uuid()).min(1).max(200),
  stage: z.enum(TASK_STAGES),
});

const PriorityOp = z.object({
  op: z.literal("priority"),
  ids: z.array(z.string().uuid()).min(1).max(200),
  priority: z.enum(PRIORITIES),
});

const ShiftOp = z.object({
  op: z.literal("shift_deadline"),
  ids: z.array(z.string().uuid()).min(1).max(200),
  days: z.coerce.number().int().min(-365).max(365).refine((n) => n !== 0, "أدخل عددًا غير صفر"),
});

const Schema = z.discriminatedUnion("op", [StageOp, PriorityOp, ShiftOp]);

export type BulkResult =
  | {
      ok: true;
      changed: number;
      failed: Array<{ id: string; reason: string }>;
    }
  | { error: string };

export async function bulkUpdateTasksAction(input: z.infer<typeof Schema>): Promise<BulkResult> {
  let session;
  try {
    session = await requirePermission("tasks.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  const data = parsed.data;

  // Org-scope every id up front. Anything outside the org just doesn't show
  // up in this set and is dropped from subsequent UPDATEs.
  const { data: rows } = await supabaseAdmin
    .from("tasks")
    .select("id, stage, project_id, priority, planned_date")
    .eq("organization_id", session.orgId)
    .in("id", data.ids);
  const ownedIds = new Set((rows ?? []).map((r) => r.id));
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of data.ids) {
    if (!ownedIds.has(id)) failed.push({ id, reason: "خارج النطاق" });
  }

  let changed = 0;
  const projectIds = new Set<string>();

  if (data.op === "stage") {
    // Per-task UPDATE so the DB stage-transition trigger fires once per row
    // and we can report which ones it rejected.
    for (const row of rows ?? []) {
      if (row.stage === data.stage) continue;
      // Forward-only: skip rows that would regress to an earlier stage.
      if (!isForwardStageMove(row.stage as TaskStage, data.stage as TaskStage)) {
        failed.push({ id: row.id, reason: "لا يمكن إرجاع المهمة إلى مرحلة سابقة" });
        continue;
      }
      const { error } = await supabaseAdmin
        .from("tasks")
        .update({ stage: data.stage })
        .eq("id", row.id);
      if (error) {
        failed.push({ id: row.id, reason: error.message });
        continue;
      }
      changed++;
      if (row.project_id) projectIds.add(row.project_id);
    }
  } else if (data.op === "priority") {
    const targets = (rows ?? []).filter((r) => r.priority !== data.priority);
    if (targets.length > 0) {
      const { error } = await supabaseAdmin
        .from("tasks")
        .update({ priority: data.priority })
        .in("id", targets.map((r) => r.id));
      if (error) return { error: error.message };
      changed = targets.length;
      for (const r of targets) if (r.project_id) projectIds.add(r.project_id);
    }
  } else {
    // shift_deadline — rows without planned_date are silently skipped.
    const ms = data.days * 86_400_000;
    for (const row of rows ?? []) {
      if (!row.planned_date) continue;
      const next = new Date(new Date(row.planned_date).getTime() + ms)
        .toISOString()
        .slice(0, 10);
      const { error } = await supabaseAdmin
        .from("tasks")
        .update({ planned_date: next })
        .eq("id", row.id);
      if (error) {
        failed.push({ id: row.id, reason: error.message });
        continue;
      }
      changed++;
      if (row.project_id) projectIds.add(row.project_id);
    }
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "task.bulk_update",
    entityType: "task",
    entityId: null,
    metadata: {
      op: data.op,
      requested: data.ids.length,
      changed,
      failed: failed.length,
      ...(data.op === "stage" ? { stage: data.stage } : {}),
      ...(data.op === "priority" ? { priority: data.priority } : {}),
      ...(data.op === "shift_deadline" ? { days: data.days } : {}),
    },
  });

  revalidatePath("/tasks");
  for (const pid of projectIds) revalidatePath(`/projects/${pid}`);

  return { ok: true, changed, failed };
}
