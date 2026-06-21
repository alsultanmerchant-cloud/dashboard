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

// Per-client search keywords for pickers: the names by which a human might look
// a client up — its project names + codes, WhatsApp group names, contract codes
// + the original sheet name, and the legacy external code. Lets the satisfaction
// picker resolve a client by ANY identifier (project / group / contract), not
// just its display name. Returns clientId → space-joined keyword blob.
export async function getClientSearchKeywords(orgId: string): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      // Pin the wa_group_links FK (2nd relationship via suggested_client_id
      // → PGRST201). See [[feedback_postgrest_ambiguous_embeds]].
      "id, external_id, projects(name, project_code), wa_group_links!wa_group_links_client_id_fkey(chat_name), contracts(contract_code, sheet_client_name)",
    )
    .eq("organization_id", orgId)
    .is("merged_into_client_id", null);
  if (error) throw error;

  type Row = {
    id: string;
    external_id: string | null;
    projects: { name: string | null; project_code: string | null }[] | null;
    wa_group_links: { chat_name: string | null }[] | null;
    contracts: { contract_code: string | null; sheet_client_name: string | null }[] | null;
  };

  const out = new Map<string, string>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const parts: (string | null)[] = [r.external_id];
    for (const p of r.projects ?? []) parts.push(p.name, p.project_code);
    for (const g of r.wa_group_links ?? []) parts.push(g.chat_name);
    for (const c of r.contracts ?? []) parts.push(c.contract_code, c.sheet_client_name);
    const blob = parts.filter(Boolean).join(" ").trim();
    if (blob) out.set(r.id, blob);
  }
  return out;
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

// ---------------------------------------------------------------------------
// listClientsPage — the centralized /clients listing. Reads the Supabase
// `clients` UNION (not Odoo-live), so it shows BOTH the accounting/contracts
// clients (external_source='excel-acc-sheet', carry contracts) AND the
// delivery clients (external_source='odoo', carry projects) — the same table
// the new-contract picker reads. Each row is labelled by where its data lives:
//   contracts  → has contracts, no project
//   delivery   → has a project, no contract
//   both       → genuinely linked on both sides (a merged / matched client)
//   other      → neither (manual rows, leads converted, etc.)
// The union is small (~400 rows) so we fetch all + count embeds once, then
// derive source / totals / filter / paginate in memory — accurate and simple.
// ---------------------------------------------------------------------------
export type ClientSource = "contracts" | "delivery" | "both" | "other";

export type ClientsPageRow = {
  id: string;
  name: string;
  external_id: string | null;
  external_source: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contracts: number;
  projects: number;
  source: ClientSource;
};

export type ClientsPage = {
  rows: ClientsPageRow[];
  total: number; // rows matching the active source filter
  page: number;
  pageSize: number;
  totals: {
    clients: number; // whole union
    contracts: number; // clients carrying ≥1 contract
    delivery: number; // clients carrying ≥1 project
    reachable: number; // clients with a phone or email
  };
};

export async function listClientsPage(
  orgId: string,
  opts: { page?: number; pageSize?: number; source?: ClientSource | "all" } = {},
): Promise<ClientsPage> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const source = opts.source ?? "all";

  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "id, name, external_id, external_source, phone, email, company_website, contracts(count), projects(count)",
    )
    .eq("organization_id", orgId)
    .is("merged_into_client_id", null)
    .order("name");
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    external_id: string | null;
    external_source: string | null;
    phone: string | null;
    email: string | null;
    company_website: string | null;
    contracts: { count: number }[] | null;
    projects: { count: number }[] | null;
  };

  const all: ClientsPageRow[] = ((data ?? []) as unknown as Raw[]).map((r) => {
    const contracts = r.contracts?.[0]?.count ?? 0;
    const projects = r.projects?.[0]?.count ?? 0;
    const src: ClientSource =
      contracts > 0 && projects > 0
        ? "both"
        : contracts > 0
          ? "contracts"
          : projects > 0
            ? "delivery"
            : "other";
    return {
      id: r.id,
      name: r.name,
      external_id: r.external_id,
      external_source: r.external_source,
      phone: r.phone,
      email: r.email,
      website: r.company_website,
      contracts,
      projects,
      source: src,
    };
  });

  const totals = {
    clients: all.length,
    contracts: all.filter((c) => c.contracts > 0).length,
    delivery: all.filter((c) => c.projects > 0).length,
    reachable: all.filter((c) => c.phone || c.email).length,
  };

  const filtered = source === "all" ? all : all.filter((c) => c.source === source);
  const total = filtered.length;
  const from = (page - 1) * pageSize;
  const rows = filtered.slice(from, from + pageSize);

  return { rows, total, page, pageSize, totals };
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
  // Cross-surface names that identify the same company: project names (odoo) /
  // WhatsApp group names (sheet). Fed to the matcher so brand-only-in-project /
  // group splits (e.g. «lip luster») are detected. See [[project_clients_centralization]].
  aliases: string[];
};

export async function getClientMergeData(orgId: string): Promise<{
  sheetClients: MergeClient[];
  odooClients: MergeClient[];
}> {
  // All non-merged clients with their cross-module counts AND the names of
  // their projects / groups (used as matcher aliases) in one pass. Pin the
  // wa_group_links FK — it has a 2nd relationship (suggested_client_id) so an
  // implicit embed fails with PGRST201. See [[feedback_postgrest_ambiguous_embeds]].
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "id, name, external_id, external_source, contracts(count), projects(name), wa_group_links!wa_group_links_client_id_fkey(chat_name)",
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
    projects: { name: string | null }[] | null;
    wa_group_links: { chat_name: string | null }[] | null;
  };
  const map = (r: Row): MergeClient => {
    const projectNames = (r.projects ?? []).map((p) => p.name).filter((n): n is string => !!n);
    const groupNames = (r.wa_group_links ?? [])
      .map((g) => g.chat_name)
      .filter((n): n is string => !!n);
    return {
      id: r.id,
      name: r.name,
      external_id: r.external_id,
      external_source: r.external_source,
      contracts: r.contracts?.[0]?.count ?? 0,
      groups: groupNames.length,
      projects: projectNames.length,
      // Odoo clients carry the delivery PROJECT names; sheet clients carry the
      // WhatsApp GROUP names — the surfaces where the shared brand actually lives.
      aliases: r.external_source === "odoo" ? projectNames : groupNames,
    };
  };

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
