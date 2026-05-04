"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth-server";
import { logAudit } from "@/lib/audit";
import { createExpense, EXPENSE_CATEGORIES } from "@/lib/data/expenses";

export type ExpenseFormState = {
  ok?: true;
  expenseId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

const ExpenseCreateSchema = z.object({
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صحيحة")
    .refine(
      (v) => {
        const d = new Date(v + "T00:00:00.000Z");
        return !isNaN(d.getTime());
      },
      "تاريخ غير صحيح",
    ),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z
    .string()
    .min(1, "المبلغ مطلوب")
    .transform((v) => Number(v.replace(/,/g, "")))
    .refine((n) => Number.isFinite(n) && n >= 0, "مبلغ غير صحيح"),
  vendor: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
});

export async function createExpenseAction(
  _prev: ExpenseFormState | undefined,
  formData: FormData,
): Promise<ExpenseFormState> {
  let session;
  try {
    session = await requirePermission("finance.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ExpenseCreateSchema.safeParse({
    expense_date: formData.get("expense_date"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    vendor: formData.get("vendor") || null,
    description: formData.get("description") || null,
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
    result = await createExpense(session.orgId, session.userId, parsed.data);
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "expense.create",
    entityType: "expense",
    entityId: result.id,
    metadata: {
      category: parsed.data.category,
      amount: parsed.data.amount,
      vendor: parsed.data.vendor,
    },
  });

  revalidatePath("/finance");
  return { ok: true, expenseId: result.id };
}
