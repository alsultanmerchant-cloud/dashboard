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

// ---------------------------------------------------------------------------
// bulkMergeHighConfidence — merge every sheet client whose best Odoo match
// scores >= minScore, the match is unambiguous (clearly ahead of the runner-
// up), and the target carries a project. Uses the SAME matcher the page shows,
// so "merge all ≥85%" does exactly what the visible confidence promises.
// Returns how many merged + a sample, so the UI can report.
// ---------------------------------------------------------------------------
export async function bulkMergeHighConfidenceAction(input: {
  minScore: number;
}): Promise<
  | { ok: true; merged: number; moved: Record<string, number>; samples: string[] }
  | { error: string }
> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const min = Math.min(1, Math.max(0.7, input.minScore || 0.85));

  const { getClientMergeData } = await import("@/lib/data/clients");
  const { bestClientMatch } = await import("@/lib/match/client-match");
  const { sheetClients, odooClients } = await getClientMergeData(session.orgId);
  const odooById = new Map(odooClients.map((o) => [o.id, o]));

  // Build the merge list: best >= min, unambiguous (lead >= 0.05 over 2nd or
  // an exact/alias 0.95+), and the target actually has a project.
  const plan: Array<{ source: string; target: string; label: string }> = [];
  for (const s of sheetClients) {
    const { best, secondScore } = bestClientMatch(s, odooClients);
    if (!best || best.score < min) continue;
    const tgt = odooById.get(best.client.id);
    if (!tgt || tgt.projects <= 0) continue;
    const unambiguous = best.score >= 0.95 || best.score - secondScore >= 0.05;
    if (!unambiguous) continue;
    plan.push({ source: s.id, target: best.client.id, label: `${s.name} → ${tgt.name}` });
  }

  let merged = 0;
  const moved: Record<string, number> = {};
  const samples: string[] = [];
  for (const p of plan) {
    const { data, error } = await supabaseAdmin.rpc("merge_clients", {
      p_source: p.source,
      p_target: p.target,
      p_org: session.orgId,
    });
    if (error) continue; // skip failures (e.g. target became merged mid-run)
    merged += 1;
    if (samples.length < 8) samples.push(p.label);
    const m = (data as { moved?: Record<string, number> })?.moved ?? {};
    for (const [k, v] of Object.entries(m)) moved[k] = (moved[k] ?? 0) + (v as number);
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "client.bulk_merge",
    entityType: "client",
    entityId: session.orgId,
    metadata: { min_score: min, merged, moved },
  });

  revalidatePath("/clients/merge");
  revalidatePath("/clients");
  revalidatePath("/contracts");
  revalidatePath("/satisfaction/groups");
  return { ok: true, merged, moved, samples };
}

// Preview the bulk-merge plan at a threshold WITHOUT applying — so the team
// (and the confirm dialog) can see exactly which pairs will merge first.
export async function previewBulkMergeAction(input: {
  minScore: number;
}): Promise<
  | { ok: true; pairs: Array<{ from: string; to: string; score: number }> }
  | { error: string }
> {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }
  const min = Math.min(1, Math.max(0.7, input.minScore || 0.85));
  const { getClientMergeData } = await import("@/lib/data/clients");
  const { bestClientMatch } = await import("@/lib/match/client-match");
  const { sheetClients, odooClients } = await getClientMergeData(session.orgId);
  const odooById = new Map(odooClients.map((o) => [o.id, o]));
  const pairs: Array<{ from: string; to: string; score: number }> = [];
  for (const s of sheetClients) {
    const { best, secondScore } = bestClientMatch(s, odooClients);
    if (!best || best.score < min) continue;
    const tgt = odooById.get(best.client.id);
    if (!tgt || tgt.projects <= 0) continue;
    if (!(best.score >= 0.95 || best.score - secondScore >= 0.05)) continue;
    pairs.push({ from: s.name, to: tgt.name, score: Math.round(best.score * 100) / 100 });
  }
  pairs.sort((a, b) => b.score - a.score);
  return { ok: true, pairs };
}
