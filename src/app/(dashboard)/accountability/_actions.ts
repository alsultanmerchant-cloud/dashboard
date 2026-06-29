"use server";

import { revalidatePath } from "next/cache";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// On-demand refresh of the accountability_scorecard cache (otherwise pg_cron
// every 10 min). Lets a manager pull the latest numbers immediately after work
// moves in Rwasem instead of waiting for the next scheduled refresh.
export async function refreshAccountabilityScorecardAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return { ok: false, error: "Unauthorized" };
  }
  const { error } = await supabaseAdmin.rpc("refresh_accountability_scorecard");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accountability");
  return { ok: true };
}
