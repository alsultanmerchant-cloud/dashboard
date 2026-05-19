import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// A "position" is a job title in the org catalog. Each position maps to one
// of the 7 structural task roles (see TASK_OWNER_ROLE_KEYS) — that role is
// what task auto-assignment resolves against.
export type Position = {
  id: string;
  slug: string;
  name: string;
  role: string;
  is_system: boolean;
};

/** All positions for an org — system rows first, then alphabetical. */
export async function listPositions(
  organizationId: string,
): Promise<Position[]> {
  const { data, error } = await supabaseAdmin
    .from("positions")
    .select("id, slug, name, role, is_system")
    .eq("organization_id", organizationId)
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });
  if (error) {
    console.error("[listPositions]", error.message);
    return [];
  }
  return data ?? [];
}
