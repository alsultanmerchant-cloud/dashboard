"use server";

// Global Project Manager picker — Sky Light manual treats the PM as
// "usually fixed" for the whole agency. We store it on the organization row.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Schema = z.object({
  employee_id: z
    .union([z.literal(""), z.null(), z.string().regex(UUID_RE)])
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
});

export async function setOrgProjectManagerAction(input: {
  employeeId: string | null;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("settings.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = Schema.safeParse({ employee_id: input.employeeId ?? null });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  if (parsed.data.employee_id) {
    const { data: emp } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("id", parsed.data.employee_id)
      .eq("organization_id", session.orgId)
      .maybeSingle();
    if (!emp) return { error: "الموظف غير موجود" };
  }

  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ project_manager_employee_id: parsed.data.employee_id })
    .eq("id", session.orgId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "org.project_manager_change",
    entityType: "organization",
    entityId: session.orgId,
    metadata: { employee_id: parsed.data.employee_id },
  });

  revalidatePath("/settings");
  return { ok: true };
}
