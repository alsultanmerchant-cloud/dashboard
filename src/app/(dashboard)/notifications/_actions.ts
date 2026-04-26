"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function markNotificationReadAction(id: string): Promise<{ ok: true } | { error: string }> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", session.orgId)
    .eq("recipient_user_id", session.userId);
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<{ ok: true; updated: number } | { error: string }> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", session.orgId)
    .eq("recipient_user_id", session.userId)
    .is("read_at", null)
    .select("id");
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true, updated: data?.length ?? 0 };
}
