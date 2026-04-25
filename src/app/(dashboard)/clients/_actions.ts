"use server";

import { revalidatePath } from "next/cache";
import { ClientCreateSchema } from "@/lib/schemas";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

export type ClientFormState = {
  ok?: true;
  clientId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createClientAction(
  _prev: ClientFormState | undefined,
  formData: FormData,
): Promise<ClientFormState> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ClientCreateSchema.safeParse({
    name: formData.get("name"),
    contact_name: formData.get("contact_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    company_website: formData.get("company_website"),
    source: formData.get("source"),
    status: formData.get("status") || "active",
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") fieldErrors[path] = issue.message;
    }
    return { error: "تحقق من بيانات النموذج", fieldErrors };
  }

  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      organization_id: session.orgId,
      created_by: session.userId,
      ...parsed.data,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { error: error?.message ?? "تعذر إنشاء العميل" };
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.create",
    entityType: "client",
    entityId: data.id,
    metadata: { name: parsed.data.name, status: parsed.data.status },
  });
  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "CLIENT_CREATED",
    entityType: "client",
    entityId: data.id,
    payload: { name: parsed.data.name },
  });

  revalidatePath("/clients");
  return { ok: true, clientId: data.id };
}
