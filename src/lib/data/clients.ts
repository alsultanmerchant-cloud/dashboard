import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Lightweight clients-as-options fetcher for pickers (new-contract modal,
 * client cell editor). Skips the heavy projects(count) embed; just
 * returns id + name + external_id so the search field can match either
 * the display name or the legacy "C123" code from the sheet.
 */
export async function listClientOptions(orgId: string) {
  const [{ data, error }, displayNames] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("id, name, external_id")
      .eq("organization_id", orgId)
      // Hide rows that were merged into a canonical client (de-dup tombstones).
      .is("merged_into_client_id", null)
      .order("name"),
    // Contracts own client identity — every picker shows the contract-sheet name.
    getClientDisplayNameMap(orgId),
  ]);
  if (error) throw error;
  // Overlay the contract-sourced display name so pickers never show the raw Odoo
  // project name. Re-sort by the resolved name (the DB ordered by the raw name).
  return (data ?? [])
    .map((c) => ({ ...c, name: displayNames.get(c.id) ?? c.name }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ar"));
}

export async function listContractClientOptions(orgId: string) {
  const [clients, folded] = await Promise.all([
    listClientOptions(orgId),
    foldedContractsByCanonical(orgId),
  ]);
  return clients.filter((c) => (folded.get(c.id as string)?.length ?? 0) > 0);
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

// ---------------------------------------------------------------------------
// Contracts are the source of truth for a client's IDENTITY. Odoo-synced names
// (external_source='odoo') and manual rows must defer to the contract sheet:
// when such a client carries ≥1 contract, its display name is taken from the
// newest contract's `sheet_client_name`. Sheet-sourced clients keep their own
// `name` — that value was ALREADY imported from the contracts sheet (the
// unified client name) and is cleaner than the per-row service label stored on
// `sheet_client_name`, so we don't override it. Clients with no contract keep
// their existing name until linked.
// ---------------------------------------------------------------------------
export function resolveClientName(
  fallbackName: string,
  contracts: { sheet_client_name: string | null; start_date: string | null }[] | null | undefined,
  externalSource?: string | null,
): string {
  // Sheet clients already carry the contract-sourced name — leave it be.
  if (externalSource === "excel-acc-sheet") return fallbackName;
  const named = (contracts ?? [])
    .filter((c) => (c.sheet_client_name ?? "").trim().length > 0)
    .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
  return named[0]?.sheet_client_name?.trim() || fallbackName;
}

// ---------------------------------------------------------------------------
// Contract folding across the merge identity set.
//
// A real brand often exists as TWO client rows: the canonical (Odoo) row that
// carries the delivery project + WhatsApp chats, and a merged sheet twin
// (external_source='excel-acc-sheet', tombstoned via merged_into_client_id)
// that carries the contracts. merge_clients repoints contracts onto the
// canonical, but the nightly contracts-sheet sync re-attaches them to the sheet
// twin (it keys on the sheet client_id), so in steady state a merged client's
// contracts live on the tombstone and are invisible to a canonical-id lookup.
//
// This resolves, per NON-tombstone client, ALL contracts across its identity
// set (itself + every twin merged into it), so the contract sheet becomes the
// single source of truth for a client's display name and contract count no
// matter which row physically holds the contract. See
// [[project_satisfaction_contract_bridge]] and [[project_clients_centralization]].
// ---------------------------------------------------------------------------
export type FoldedContract = { id?: string; sheet_client_name: string | null; start_date: string | null };

async function _foldedContractsByCanonical(
  orgId: string,
): Promise<Map<string, FoldedContract[]>> {
  const [clientsRes, contractsRes] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("id, merged_into_client_id")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("contracts")
      .select("id, client_id, project_id, sheet_client_name, start_date, project:projects(client_id)")
      .eq("organization_id", orgId),
  ]);
  if (clientsRes.error) throw clientsRes.error;
  if (contractsRes.error) throw contractsRes.error;

  // tombstone id → canonical id (one hop; merge targets are never themselves merged).
  const mergeMap = new Map<string, string>();
  for (const c of (clientsRes.data ?? []) as Array<{ id: string; merged_into_client_id: string | null }>) {
    if (c.merged_into_client_id) mergeMap.set(c.id, c.merged_into_client_id);
  }

  type ContractRow = {
    id: string;
    client_id: string | null;
    project_id: string | null;
    sheet_client_name: string | null;
    start_date: string | null;
    project: { client_id: string | null } | { client_id: string | null }[] | null;
  };
  const out = new Map<string, FoldedContract[]>();
  const seen = new Map<string, Set<string>>();
  const add = (clientId: string | null | undefined, k: ContractRow) => {
    if (!clientId) return;
    const canon = mergeMap.get(clientId) ?? clientId;
    const key = k.id ?? `${k.sheet_client_name ?? ""}:${k.start_date ?? ""}`;
    const seenForClient = seen.get(canon) ?? new Set<string>();
    if (seenForClient.has(key)) return;
    seenForClient.add(key);
    seen.set(canon, seenForClient);
    const arr = out.get(canon) ?? [];
    arr.push({ id: k.id, sheet_client_name: k.sheet_client_name, start_date: k.start_date });
    out.set(canon, arr);
  };

  for (const k of (contractsRes.data ?? []) as unknown as ContractRow[]) {
    // Normal path: contract.client_id, canonicalized through merge tombstones.
    add(k.client_id, k);
    // Project bridge: some contracts stay on the sheet client while their
    // project points at the Odoo client. Contract names must still win on the
    // delivery/satisfaction side, so fold the same contract onto project.client_id.
    const p = Array.isArray(k.project) ? k.project[0] : k.project;
    add(p?.client_id, k);
  }
  return out;
}
export const foldedContractsByCanonical = cache(_foldedContractsByCanonical);

// Org-wide map: canonical clientId → its contract-sourced DISPLAY name. Contracts
// own client identity, so any client with ≥1 contract (directly or via a merged
// twin) is named from the newest contract's sheet_client_name; unlinked clients
// keep their existing name. This is the single resolver every client-name
// surface (/clients, /satisfaction, group-mapping admin) should use so the whole
// app shows names "as written on the contract", not the Odoo project name.
async function _getClientDisplayNameMap(orgId: string): Promise<Map<string, string>> {
  const [clientsRes, folded] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("id, name, external_source")
      .eq("organization_id", orgId)
      .is("merged_into_client_id", null),
    foldedContractsByCanonical(orgId),
  ]);
  if (clientsRes.error) throw clientsRes.error;

  const m = new Map<string, string>();
  for (const c of (clientsRes.data ?? []) as Array<{
    id: string;
    name: string;
    external_source: string | null;
  }>) {
    m.set(c.id, resolveClientName(c.name, folded.get(c.id), c.external_source));
  }
  return m;
}
export const getClientDisplayNameMap = cache(_getClientDisplayNameMap);

// Every client id that shares this client's commercial identity: itself, its
// canonical parent (if it is a merged sheet twin), and every sibling merged into
// that parent. A client's contracts/logs are gathered across this whole set,
// because the contract sheet keys them on the twin while the delivery data lives
// on the canonical row. Mirrors the satisfaction bridge so /clients and
// /satisfaction resolve a client's portfolio identically.
async function _getClientIdentityIds(orgId: string, clientId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, merged_into_client_id")
    .eq("organization_id", orgId)
    .not("merged_into_client_id", "is", null);
  const parentOf = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ id: string; merged_into_client_id: string | null }>) {
    if (r.merged_into_client_id) parentOf.set(r.id, r.merged_into_client_id);
  }
  const canonical = parentOf.get(clientId) ?? clientId; // walk up one hop
  const ids = new Set<string>([clientId, canonical]);
  for (const [child, parent] of parentOf) if (parent === canonical) ids.add(child);
  return Array.from(ids);
}
export const getClientIdentityIds = cache(_getClientIdentityIds);

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

  const [{ data, error }, folded] = await Promise.all([
    supabaseAdmin
      .from("clients")
      // Contracts are folded in separately (they may live on a merged sheet
      // twin, invisible to a direct embed), so here we only need the scalar
      // client fields + the delivery project count.
      .select("id, name, external_id, external_source, phone, email, company_website, projects(count)")
      .eq("organization_id", orgId)
      .is("merged_into_client_id", null)
      .order("name"),
    foldedContractsByCanonical(orgId),
  ]);
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    external_id: string | null;
    external_source: string | null;
    phone: string | null;
    email: string | null;
    company_website: string | null;
    projects: { count: number }[] | null;
  };

  const all: ClientsPageRow[] = ((data ?? []) as unknown as Raw[]).map((r) => {
    const foldedContracts = folded.get(r.id) ?? [];
    const contracts = foldedContracts.length;
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
      // Contracts own the identity: Odoo/manual names defer to the contract.
      name: resolveClientName(r.name, foldedContracts, r.external_source),
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

  // Re-sort by the resolved (contract-sourced) name — the DB ordered by the
  // raw clients.name, which may differ once contracts override it.
  all.sort((a, b) => a.name.localeCompare(b.name, "ar"));

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
      "*, projects ( id, name, project_code, status, priority, start_date, end_date, account_manager_employee_id ), contracts ( sheet_client_name, start_date )",
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Connect pickers — the options for linking a project / contract to a client.
// Both list EVERY non-tombstone row org-wide (with its current owner name as a
// hint), so an operator can re-home a mis-attributed project/contract onto the
// right contract-client. Small tables (~300 rows each) → fetch all, filter in UI.
// ---------------------------------------------------------------------------
export type ConnectableProject = {
  id: string;
  name: string;
  project_code: string | null;
  client_id: string;
  client_name: string | null;
};

export type ConnectableContract = {
  id: string;
  contract_code: string | null;
  sheet_client_name: string | null;
  client_id: string;
  client_name: string | null;
};

export async function listConnectableProjects(orgId: string): Promise<ConnectableProject[]> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, project_code, client_id, client:clients(name)")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string;
    name: string;
    project_code: string | null;
    client_id: string;
    client: { name: string | null } | { name: string | null }[] | null;
  }>).map((r) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    return {
      id: r.id,
      name: r.name,
      project_code: r.project_code,
      client_id: r.client_id,
      client_name: c?.name ?? null,
    };
  });
}

export async function listConnectableContracts(orgId: string): Promise<ConnectableContract[]> {
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select("id, contract_code, sheet_client_name, client_id, client:clients(name)")
    .eq("organization_id", orgId)
    .order("contract_code");
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string;
    contract_code: string | null;
    sheet_client_name: string | null;
    client_id: string;
    client: { name: string | null } | { name: string | null }[] | null;
  }>).map((r) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    return {
      id: r.id,
      contract_code: r.contract_code,
      sheet_client_name: r.sheet_client_name,
      client_id: r.client_id,
      client_name: c?.name ?? null,
    };
  });
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
