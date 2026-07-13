import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface NonConnectedWaAccount {
  id: string;
  sessionId: string;
  displayName: string;
  status: string;
}

export async function listNonConnectedWaAccounts(
  orgId: string,
): Promise<NonConnectedWaAccount[]> {
  const { data, error } = await supabaseAdmin
    .from("wa_accounts")
    .select("id, session_id, phone, label, status")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[waAccounts.nonConnected]", error.message);
    return [];
  }

  return (data ?? [])
    .filter((account) => account.status.toUpperCase() !== "CONNECTED")
    .map((account) => ({
      id: account.id,
      sessionId: account.session_id,
      displayName: account.label || account.phone || account.session_id,
      status: account.status,
    }));
}
