import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Client identity resolution for /satisfaction.
//
// The analysis is keyed on ONE client row, but a real brand is frequently
// SPLIT across rows: the contract/chat row (imported from the sheet) and the
// Odoo project row (a twin), tied only by clients.merged_into_client_id and/or
// the WhatsApp group→project link. Chats, contracts, tasks, the team roster and
// the brief must ALL resolve the same full identity so nothing is skipped.
//
// Lives in its own module (no imports from data/satisfaction.ts) so every
// consumer — satisfaction.ts, satisfaction-team.ts, satisfaction-brief.ts, the
// brief server actions — can share it without an import cycle.
// See [[project_satisfaction_contract_bridge]] / [[project_wa_group_multi_project]].
// =========================================================================

// child clientId → canonical (merged_into) clientId, for every merged row.
async function _getClientMergeMap(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, merged_into_client_id")
    .eq("organization_id", orgId)
    .not("merged_into_client_id", "is", null);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ id: string; merged_into_client_id: string | null }>) {
    if (r.merged_into_client_id) m.set(r.id, r.merged_into_client_id);
  }
  return m;
}
export const getClientMergeMap = cache(_getClientMergeMap);

// Every project the client's identity touches: owned + reached via its WhatsApp
// groups (legacy project_id mirror + 0203 many-to-many) + merged twins' projects.
// Returns NON-archived project ids (a fully archived project = dead cycle; archived
// TASKS inside a live project are handled by the snapshot's own filtering). This is
// the single source of truth so tasks/team/brief reach exactly the projects the
// chat + contract layers already do — otherwise a split client shows chats+contract
// but no delivery/task analysis (e.g. اتوز: contract + chats on one row, project +
// tasks on the twin).
async function _resolveClientProjectIds(orgId: string, clientId: string): Promise<string[]> {
  const merge = await getClientMergeMap(orgId);
  const canonical = merge.get(clientId) ?? clientId;
  const identity = new Set<string>([clientId, canonical]);
  for (const [child, parent] of merge) if (parent === canonical) identity.add(child);
  const idList = [...identity];

  const [ownedRes, linkRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, status")
      .eq("organization_id", orgId)
      .in("client_id", idList),
    supabaseAdmin
      .from("wa_group_links")
      .select("project_id, projects:wa_group_projects(project_id)")
      .eq("organization_id", orgId)
      .in("client_id", idList),
  ]);

  const statusById = new Map<string, string | null>();
  for (const p of (ownedRes.data ?? []) as Array<{ id: string; status: string | null }>)
    statusById.set(p.id, p.status);

  const linkedIds = new Set<string>();
  for (const l of (linkRes.data ?? []) as Array<{
    project_id: string | null;
    projects: { project_id: string }[] | null;
  }>) {
    if (l.project_id) linkedIds.add(l.project_id);
    for (const pj of l.projects ?? []) linkedIds.add(pj.project_id);
  }
  const unknown = [...linkedIds].filter((id) => !statusById.has(id));
  if (unknown.length) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id, status")
      .eq("organization_id", orgId)
      .in("id", unknown);
    for (const p of (data ?? []) as Array<{ id: string; status: string | null }>)
      statusById.set(p.id, p.status);
  }

  const out: string[] = [];
  for (const [id, status] of statusById) if (status !== "archived") out.push(id);
  return out;
}
export const resolveClientProjectIds = cache(_resolveClientProjectIds);
