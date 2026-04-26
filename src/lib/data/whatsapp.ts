import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type WhatsAppGroupKind = "client" | "internal";

export type WhatsAppGroup = {
  id: string;
  project_id: string;
  kind: WhatsAppGroupKind;
  name: string;
  invite_url: string | null;
  whatsapp_chat_id: string | null;
  notes: string | null;
  created_at: string;
};

export async function listProjectWhatsAppGroups(
  orgId: string,
  projectId: string,
): Promise<WhatsAppGroup[]> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_groups")
    .select(
      "id, project_id, kind, name, invite_url, whatsapp_chat_id, notes, created_at",
    )
    .eq("organization_id", orgId)
    .eq("project_id", projectId)
    .order("kind");
  if (error) throw error;
  return (data ?? []) as WhatsAppGroup[];
}

// Naming convention from the manual:
//   client group   →  إدارة نشاط | <client business name>
//   internal group →  <client business name>
export function suggestGroupName(
  kind: WhatsAppGroupKind,
  clientName: string,
): string {
  const trimmed = clientName.trim();
  if (kind === "client") return `إدارة نشاط | ${trimmed}`;
  return trimmed;
}
