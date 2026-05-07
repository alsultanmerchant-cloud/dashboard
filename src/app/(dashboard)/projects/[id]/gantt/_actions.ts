"use server";

// Gantt-specific actions: per-project rendering preferences.
// Stored in projects.gantt_prefs (jsonb, migration 0062).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { error: string };

const Weekday = z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);

const GanttPrefs = z.object({
  show_today_line: z.boolean().optional(),
  show_dependency_arrows: z.boolean().optional(),
  show_weekend_shading: z.boolean().optional(),
  weekend_days: z.array(Weekday).max(7).optional(),
});

const Schema = z.object({
  project_id: z.string().uuid(),
  prefs: GanttPrefs,
});

export async function updateGanttPrefsAction(input: {
  projectId: string;
  prefs: Record<string, unknown>;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("projects.manage");
  } catch {
    return { error: "ليس لديك صلاحية تعديل المشروع." };
  }

  const parsed = Schema.safeParse({
    project_id: input.projectId,
    prefs: input.prefs,
  });
  if (!parsed.success) return { error: "مدخلات غير صالحة." };

  // Org-scope check.
  const { data: project, error: loadErr } = await supabaseAdmin
    .from("projects")
    .select("id, organization_id, gantt_prefs")
    .eq("id", parsed.data.project_id)
    .maybeSingle();
  if (loadErr) return { error: loadErr.message };
  if (!project || project.organization_id !== session.orgId) {
    return { error: "المشروع غير موجود." };
  }

  // Merge: keep existing keys, overlay new ones.
  const merged = {
    ...((project.gantt_prefs as Record<string, unknown> | null) ?? {}),
    ...parsed.data.prefs,
  };

  const { error: updErr } = await supabaseAdmin
    .from("projects")
    .update({ gantt_prefs: merged })
    .eq("id", parsed.data.project_id);
  if (updErr) return { error: updErr.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "project.gantt_prefs.update",
    entityType: "project",
    entityId: parsed.data.project_id,
    metadata: { prefs: parsed.data.prefs },
  });

  revalidatePath(`/projects/${parsed.data.project_id}/gantt`);
  return { ok: true };
}
