"use server";

// Client de-duplication merge action. The team uses the merge workspace to
// fold each sheet-imported client duplicate into its canonical Odoo client,
// re-pointing contracts / WhatsApp groups / projects so everything resolves
// to one company. Gated on clients.manage; logged to audit_log.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MergeResult =
  | { ok: true; moved: Record<string, number> }
  | { error: string };

const Schema = z.object({
  source_id: z.string().regex(UUID_RE),
  target_id: z.string().regex(UUID_RE),
});

export async function mergeClientsAction(input: {
  sourceId: string;
  targetId: string;
}): Promise<MergeResult> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = Schema.safeParse({
    source_id: input.sourceId,
    target_id: input.targetId,
  });
  if (!parsed.success) return { error: "معرّفات غير صالحة" };
  if (parsed.data.source_id === parsed.data.target_id) {
    return { error: "لا يمكن دمج العميل مع نفسه" };
  }

  // Snapshot names for the audit log before the merge.
  const { data: pair } = await supabaseAdmin
    .from("clients")
    .select("id, name, external_source, merged_into_client_id")
    .eq("organization_id", session.orgId)
    .in("id", [parsed.data.source_id, parsed.data.target_id]);
  const src = pair?.find((c) => c.id === parsed.data.source_id);
  const tgt = pair?.find((c) => c.id === parsed.data.target_id);
  if (!src || !tgt) return { error: "العميل غير موجود" };
  if (src.merged_into_client_id) return { error: "هذا العميل مدموج بالفعل" };

  const { data, error } = await supabaseAdmin.rpc("merge_clients", {
    p_source: parsed.data.source_id,
    p_target: parsed.data.target_id,
    p_org: session.orgId,
  });
  if (error) return { error: error.message };

  const moved = (data as { moved?: Record<string, number> })?.moved ?? {};

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.merge",
    entityType: "client",
    entityId: parsed.data.target_id,
    metadata: {
      merged_source: { id: src.id, name: src.name, source: src.external_source },
      into_target: { id: tgt.id, name: tgt.name },
      moved,
    },
  });

  revalidatePath("/clients/merge");
  revalidatePath("/clients");
  revalidatePath("/contracts");
  revalidatePath("/satisfaction/groups");
  return { ok: true, moved };
}

// Undo a merge — clears the tombstone so the source client reappears.
// References that were moved STAY on the target (we don't track which moved),
// so this is a "show the duplicate again" undo, not a full unwind. Surfaced
// for accidental merges; gated on clients.manage.
export async function unmergeClientAction(input: {
  sourceId: string;
}): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!UUID_RE.test(input.sourceId)) return { error: "معرّف غير صالح" };

  const { error } = await supabaseAdmin
    .from("clients")
    .update({ merged_into_client_id: null })
    .eq("organization_id", session.orgId)
    .eq("id", input.sourceId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.unmerge",
    entityType: "client",
    entityId: input.sourceId,
    metadata: {},
  });
  revalidatePath("/clients/merge");
  return { ok: true };
}
