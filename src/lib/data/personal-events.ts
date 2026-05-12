import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Sky Light §6.2: per-user personal calendar events. Loader is used by the
// topbar calendar popover and the /my-activities page so the user sees
// their reminders alongside their task-driven activities.

export type PersonalEventRow = {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  note: string | null;
  color: number;
  created_at: string;
};

export async function listPersonalEvents(
  orgId: string,
  userId: string,
): Promise<PersonalEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("personal_events")
    .select("id, title, event_date, event_time, note, color, created_at")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PersonalEventRow[];
}
