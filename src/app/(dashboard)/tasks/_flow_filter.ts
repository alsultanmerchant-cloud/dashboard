import "server-only";

// Resolver for the stage-transition drill-down used by the dashboard
// "حركة المهام بين المراحل" (regressions) card. That card counts stage-transition
// EVENTS from `task_stage_history` within the dashboard window — a population a
// plain current-stage `/tasks` filter can't reproduce. So the drill-down carries
// a named `flow` filter that we resolve here to the exact task ids that made the
// from→to transition in that window, then feed through the existing
// `customFilterTaskIds` (→ RPC `p_task_ids`) plumbing.
//
// URL shape (kept re-derivable/shareable, not a raw id list):
//   /tasks?f=all&flow=<from_stage>~<to_stage>&fw=<since>~<until>
// `fw` (flow window) bounds the transitions to the same dates the card counted.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { riyadhNextDayStartUtcIso, riyadhStartOfDayUtcIso } from "@/lib/tz";

export type FlowFilter = {
  from: string;
  to: string;
  // ISO dates (YYYY-MM-DD); empty string means "unbounded on this side".
  since: string;
  until: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFlowParam(
  flow: string | undefined,
  window: string | undefined,
): FlowFilter | null {
  if (!flow) return null;
  const [from, to] = flow.split("~").map((s) => s.trim());
  if (!from || !to) return null;
  const [since, until] = (window ?? "").split("~").map((s) => s.trim());
  return {
    from,
    to,
    since: ISO_DATE.test(since ?? "") ? since : "",
    until: ISO_DATE.test(until ?? "") ? until : "",
  };
}

// Task ids that transitioned from→to within the window. De-duplicated (a task can
// bounce the same edge more than once). Returns [] on error or no matches so the
// drill-down shows an honest empty set rather than the whole stage.
export async function resolveFlowTaskIds(
  orgId: string,
  flow: FlowFilter,
): Promise<string[]> {
  // PAGINATED: a busy edge can have MORE transition rows than tasks (a task can
  // bounce the same edge repeatedly), so a single query would hit the 1000-row
  // cap and return fewer task ids than the card counted. Page until exhausted.
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin
      .from("task_stage_history")
      .select("task_id")
      .eq("organization_id", orgId)
      .eq("from_stage", flow.from)
      .eq("to_stage", flow.to)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (flow.since) q = q.gte("entered_at", riyadhStartOfDayUtcIso(flow.since));
    if (flow.until) q = q.lt("entered_at", riyadhNextDayStartUtcIso(flow.until));

    const { data, error } = await q;
    if (error) return from === 0 ? [] : Array.from(ids);
    for (const r of data ?? []) ids.add(r.task_id as string);
    if (!data || data.length < PAGE) break;
  }
  return Array.from(ids);
}

// Intersect a freshly-resolved flow-id set with any pre-existing custom-filter id
// set. null flow → passthrough; null existing → flow wins.
export function combineTaskIdSets(
  existing: string[] | null,
  flowIds: string[] | null,
): string[] | null {
  if (flowIds == null) return existing;
  if (existing == null) return flowIds;
  const keep = new Set(flowIds);
  return existing.filter((id) => keep.has(id));
}
