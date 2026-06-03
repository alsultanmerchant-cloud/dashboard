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
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listClients(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, name, contact_name, phone, email, status, created_at, projects(count)")
    .eq("organization_id", orgId)
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
