"use server";

import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ActivityRow = {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: unknown;
  importance: string | null;
  created_at: string;
};

export type ActivityPage = {
  items: ActivityRow[];
  nextCursor: string | null;
};

const PAGE_SIZE = 30;

export async function loadMoreActivity(
  beforeIso: string | null,
): Promise<ActivityPage> {
  const session = await requireSession();
  let q = supabaseAdmin
    .from("ai_events")
    .select("id, event_type, entity_type, entity_id, payload, importance, created_at")
    .eq("organization_id", session.orgId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (beforeIso) q = q.lt("created_at", beforeIso);

  const { data } = await q;
  const rows = (data ?? []) as ActivityRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? items[items.length - 1].created_at : null;

  return { items, nextCursor };
}
