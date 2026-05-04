"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { logAudit } from "@/lib/audit";
import { createLead, updateLeadStatus, LEAD_STATUSES } from "@/lib/data/leads";

export type LeadFormState = {
  ok?: true;
  leadId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

const LeadCreateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(200),
  contact_name: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().email("بريد غير صحيح").optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(50).optional().nullable(),
  status: z.enum(LEAD_STATUSES).default("new"),
  source: z.string().trim().max(100).optional().nullable(),
  estimated_value: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? Number(String(v).replace(/,/g, "")) : 0))
    .refine((n) => Number.isFinite(n) && n >= 0, "قيمة غير صحيحة"),
  next_step_at: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.length ? v : null)),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createLeadAction(
  _prev: LeadFormState | undefined,
  formData: FormData,
): Promise<LeadFormState> {
  let session;
  try {
    session = await requirePermission("sales.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = LeadCreateSchema.safeParse({
    name: formData.get("name"),
    contact_name: formData.get("contact_name") || null,
    email: formData.get("email") || null,
    phone: formData.get("phone") || null,
    status: formData.get("status") || "new",
    source: formData.get("source") || null,
    estimated_value: formData.get("estimated_value") || "0",
    next_step_at: formData.get("next_step_at") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  let result;
  try {
    result = await createLead(session.orgId, session.userId, {
      ...parsed.data,
      email: parsed.data.email || null,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "lead.create",
    entityType: "lead",
    entityId: result.id,
    metadata: {
      name: parsed.data.name,
      status: parsed.data.status,
      value: parsed.data.estimated_value,
    },
  });

  revalidatePath("/sales");
  revalidatePath("/sales/leads");
  return { ok: true, leadId: result.id };
}

export async function moveLeadStageAction(
  leadId: string,
  status: (typeof LEAD_STATUSES)[number],
): Promise<{ ok?: true; error?: string }> {
  let session;
  try {
    session = await requirePermission("sales.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  try {
    await updateLeadStatus(session.orgId, leadId, status);
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "lead.status_change",
    entityType: "lead",
    entityId: leadId,
    metadata: { status },
  });

  revalidatePath("/sales");
  revalidatePath("/sales/leads");
  return { ok: true };
}
