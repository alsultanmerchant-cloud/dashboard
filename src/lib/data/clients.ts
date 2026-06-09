import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Lightweight clients-as-options fetcher for pickers (new-contract modal,
 * client cell editor). Skips the heavy projects(count) embed; just
 * returns id + name + external_id so the search field can match either
 * the display name or the legacy "C123" code from the sheet.
 */
export async function listClientOptions(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, name, external_id")
    .eq("organization_id", orgId)
    // Hide rows that were merged into a canonical client (de-dup tombstones).
    .is("merged_into_client_id", null)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listClients(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, name, contact_name, phone, email, status, created_at, projects(count)")
    .eq("organization_id", orgId)
    .is("merged_into_client_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getClient(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "*, projects ( id, name, status, priority, start_date, end_date, account_manager_employee_id )",
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Client de-duplication — candidates for the manual merge tool.
//
// Lists each sheet-imported client (excel-acc-sheet) that isn't yet merged,
// with: its linked-data counts (contracts / groups / projects) and the best
// Odoo-client name match so the team can confirm or override. The actual
// fuzzy ranking is done client-side in the merge workspace; here we return
// the raw rows + counts it needs.
// ---------------------------------------------------------------------------

export type MergeClient = {
  id: string;
  name: string;
  external_id: string | null;
  external_source: string | null;
  contracts: number;
  groups: number;
  projects: number;
};

export async function getClientMergeData(orgId: string): Promise<{
  sheetClients: MergeClient[];
  odooClients: MergeClient[];
}> {
  // All non-merged clients with their cross-module counts in one pass.
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "id, name, external_id, external_source, contracts(count), wa_group_links(count), projects(count)",
    )
    .eq("organization_id", orgId)
    .is("merged_into_client_id", null)
    .in("external_source", ["excel-acc-sheet", "odoo"]);
  if (error) throw error;

  type Row = {
    id: string;
    name: string;
    external_id: string | null;
    external_source: string | null;
    contracts: { count: number }[] | null;
    wa_group_links: { count: number }[] | null;
    projects: { count: number }[] | null;
  };
  const map = (r: Row): MergeClient => ({
    id: r.id,
    name: r.name,
    external_id: r.external_id,
    external_source: r.external_source,
    contracts: r.contracts?.[0]?.count ?? 0,
    groups: r.wa_group_links?.[0]?.count ?? 0,
    projects: r.projects?.[0]?.count ?? 0,
  });

  const rows = (data ?? []) as unknown as Row[];
  const sheetClients = rows
    .filter((r) => r.external_source === "excel-acc-sheet")
    .map(map)
    .sort((a, b) => b.contracts + b.groups - (a.contracts + a.groups));
  const odooClients = rows
    .filter((r) => r.external_source === "odoo")
    .map(map);
  return { sheetClients, odooClients };
}
