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

// ---------------------------------------------------------------------------
// Connect projects / contracts to a client.
//
// Contracts own client identity; projects come from Odoo. This lets an operator
// re-home a mis-attributed project/contract onto the correct client by
// re-pointing its FK. If moving a project/contract empties its former owner
// (0 projects AND 0 contracts left), we fold that now-orphan client into the
// target via merge_clients — sweeping any remaining refs (WhatsApp groups,
// activity, …) and tombstoning it. Gated on clients.manage; audit-logged.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConnectLinksResult =
  | { ok: true; movedProjects: number; movedContracts: number; foldedClients: number }
  | { error: string };

export async function getConnectOptionsAction(): Promise<
  | {
      ok: true;
      projects: Awaited<ReturnType<typeof import("@/lib/data/clients").listConnectableProjects>>;
      contracts: Awaited<ReturnType<typeof import("@/lib/data/clients").listConnectableContracts>>;
    }
  | { error: string }
> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { listConnectableProjects, listConnectableContracts } = await import("@/lib/data/clients");
  const [projects, contracts] = await Promise.all([
    listConnectableProjects(session.orgId),
    listConnectableContracts(session.orgId),
  ]);
  return { ok: true, projects, contracts };
}

export async function connectClientLinksAction(input: {
  clientId: string;
  projectIds: string[];
  contractIds: string[];
}): Promise<ConnectLinksResult> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const clientId = input.clientId;
  const projectIds = [...new Set((input.projectIds ?? []).filter((x) => UUID_RE.test(x)))];
  const contractIds = [...new Set((input.contractIds ?? []).filter((x) => UUID_RE.test(x)))];
  if (!UUID_RE.test(clientId)) return { error: "معرّف العميل غير صالح" };
  if (projectIds.length === 0 && contractIds.length === 0) {
    return { error: "لم يتم اختيار أي مشروع أو عقد" };
  }

  // Target must exist, be in-org, and not itself a tombstone.
  const { data: target } = await supabaseAdmin
    .from("clients")
    .select("id, name, merged_into_client_id")
    .eq("organization_id", session.orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (!target) return { error: "العميل غير موجود" };
  if (target.merged_into_client_id) return { error: "هذا العميل مدموج بالفعل" };

  // Snapshot the current owners so we can tell which get emptied.
  const formerOwners = new Set<string>();
  if (projectIds.length) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("client_id")
      .eq("organization_id", session.orgId)
      .in("id", projectIds);
    for (const r of data ?? []) if (r.client_id) formerOwners.add(r.client_id);
  }
  if (contractIds.length) {
    const { data } = await supabaseAdmin
      .from("contracts")
      .select("client_id")
      .eq("organization_id", session.orgId)
      .in("id", contractIds);
    for (const r of data ?? []) if (r.client_id) formerOwners.add(r.client_id);
  }
  formerOwners.delete(clientId);

  // Re-point the selected rows onto the target client.
  let movedProjects = 0;
  if (projectIds.length) {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .update({ client_id: clientId })
      .eq("organization_id", session.orgId)
      .in("id", projectIds)
      .select("id");
    if (error) return { error: error.message };
    movedProjects = data?.length ?? 0;
  }
  let movedContracts = 0;
  if (contractIds.length) {
    const { data, error } = await supabaseAdmin
      .from("contracts")
      .update({ client_id: clientId })
      .eq("organization_id", session.orgId)
      .in("id", contractIds)
      .select("id");
    if (error) return { error: error.message };
    movedContracts = data?.length ?? 0;
  }

  // Fold any now-empty former owners (no projects AND no contracts left) into
  // the target — this also sweeps their remaining refs and tombstones them.
  let foldedClients = 0;
  for (const src of formerOwners) {
    const [{ count: pc }, { count: cc }] = await Promise.all([
      supabaseAdmin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", session.orgId)
        .eq("client_id", src),
      supabaseAdmin
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", session.orgId)
        .eq("client_id", src),
    ]);
    if ((pc ?? 0) === 0 && (cc ?? 0) === 0) {
      const { error } = await supabaseAdmin.rpc("merge_clients", {
        p_source: src,
        p_target: clientId,
        p_org: session.orgId,
      });
      if (!error) foldedClients += 1;
    }
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.connect_links",
    entityType: "client",
    entityId: clientId,
    metadata: {
      target: { id: target.id, name: target.name },
      movedProjects,
      movedContracts,
      foldedClients,
    },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/contracts");
  revalidatePath("/projects");
  return { ok: true, movedProjects, movedContracts, foldedClients };
}
