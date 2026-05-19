import "server-only";

// Shared filter-param parser for the /tasks list AND the per-project task
// board on /projects/[id]. Same chip menu (SmartSearchBar) writes the same
// URL params on both surfaces; this keeps the server-side parsing in one
// place so the two pages can't drift.

import {
  DATE_FIELDS,
  SEARCH_FACET_FIELDS,
  type DateField,
  type SearchFacetField,
  type TaskFilters,
} from "@/lib/data/tasks";

const OPEN_STAGES = [
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
] as const;

export type FilterKey =
  | "open"
  | "all"
  | "overdue"
  | "done"
  | "mine"
  | "due_today"
  | "behind"
  | "ahead"
  | "critical"
  | "not_started"
  | "in_progress_pct"
  | "completed_pct"
  | "starred"
  | "followed"
  | "has_start_date"
  | "has_end_date"
  | "no_deadline"
  | "unassigned"
  | "over_timesheets"
  | "near_timesheets"
  | "archived";

const ALL_FILTER_KEYS: ReadonlySet<FilterKey> = new Set([
  "open", "all", "overdue", "done", "mine", "due_today", "behind", "ahead",
  "critical", "not_started", "in_progress_pct", "completed_pct", "starred", "followed",
  "has_start_date", "has_end_date", "no_deadline",
  "unassigned", "over_timesheets", "near_timesheets",
  "archived",
]);

export function parseFilterKeys(
  raw: string | undefined,
  legacy: string | undefined,
): Set<FilterKey> {
  const source = raw ?? legacy;
  if (source === undefined) return new Set(["open"]);
  if (source === "") return new Set();
  return new Set(
    source.split(",")
      .map((s) => s.trim())
      .filter((s): s is FilterKey => ALL_FILTER_KEYS.has(s as FilterKey)),
  );
}

function expandDateToken(token: string): { field: DateField; from: string; to: string } | null {
  const m = token.match(/^([a-z_]+):(\d{4})(?:(q)(\d)|(m)(\d{1,2}))?$/);
  if (!m) return null;
  const field = m[1] as DateField;
  if (!DATE_FIELDS.includes(field)) return null;
  const year = Number(m[2]);
  if (m[3] === "q" && m[4]) {
    const q = Number(m[4]);
    if (q < 1 || q > 4) return null;
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 3;
    return {
      field,
      from: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      to: endMonth > 12
        ? `${year + 1}-01-01`
        : `${year}-${String(endMonth).padStart(2, "0")}-01`,
    };
  }
  if (m[5] === "m" && m[6]) {
    const month = Number(m[6]);
    if (month < 1 || month > 12) return null;
    return {
      field,
      from: `${year}-${String(month).padStart(2, "0")}-01`,
      to: month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, "0")}-01`,
    };
  }
  return { field, from: `${year}-01-01`, to: `${year + 1}-01-01` };
}

export function parseDateFilters(raw: string | undefined) {
  if (!raw) return undefined;
  const out: Array<{ field: DateField; from: string; to: string }> = [];
  for (const token of raw.split(",")) {
    const expanded = expandDateToken(token.trim());
    if (expanded) out.push(expanded);
  }
  return out.length ? out : undefined;
}

export type TaskQueryParams = {
  view?: string;
  f?: string;
  d?: string;
  filter?: string;
  q?: string;
  sf?: string;
  groupBy?: string;
};

const FACET_FIELD_SET: ReadonlySet<string> = new Set(SEARCH_FACET_FIELDS);

/**
 * Parse the `sf` param — a JSON array of {field,value} search facets written
 * by the SmartSearchBar. Rejects unknown fields and empty values so a
 * hand-edited URL can't reach the RPC with garbage.
 */
export function parseSearchFacets(
  raw: string | undefined,
): Array<{ field: SearchFacetField; value: string }> | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const out: Array<{ field: SearchFacetField; value: string }> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const field = (entry as { field?: unknown }).field;
    const value = (entry as { value?: unknown }).value;
    if (typeof field !== "string" || !FACET_FIELD_SET.has(field)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    out.push({ field: field as SearchFacetField, value: value.trim() });
  }
  return out.length ? out : undefined;
}

/**
 * Build server-side TaskFilters from the URL-param surface used by both the
 * global tasks page and the per-project task board. `viewIsKanban` is needed
 * for the special "open + done → all stages" inference so the kanban "done"
 * column doesn't permanently render empty.
 */
export function buildTaskFiltersFromParams(
  sp: TaskQueryParams,
  opts: {
    userId: string;
    employeeId: string | null;
    projectId?: string;
  },
): { filters: TaskFilters; activeKeys: Set<FilterKey>; view: string } {
  const view = sp.view ?? "kanban";
  const active = parseFilterKeys(sp.f, sp.filter);
  const dateFilters = parseDateFilters(sp.d);
  const search = sp.q?.trim() || undefined;
  const searchFacets = parseSearchFacets(sp.sf);

  const stageFilter: string[] | undefined = (() => {
    if (active.has("all")) return undefined;
    const stages: string[] = [];
    if (active.has("open")) stages.push(...OPEN_STAGES);
    if (active.has("done")) stages.push("done");
    if (stages.length === 0) return undefined;
    return stages;
  })();

  const progressBuckets: Array<"not_started" | "in_progress" | "completed"> = [];
  if (active.has("not_started")) progressBuckets.push("not_started");
  if (active.has("in_progress_pct")) progressBuckets.push("in_progress");
  if (active.has("completed_pct")) progressBuckets.push("completed");

  const filters: TaskFilters = {
    stage: stageFilter,
    overdue: active.has("overdue"),
    dueToday: active.has("due_today"),
    behindSchedule: active.has("behind"),
    aheadSchedule: active.has("ahead"),
    criticalDelay: active.has("critical"),
    progressBuckets: progressBuckets.length ? progressBuckets : undefined,
    starred: active.has("starred"),
    hasStartDate: active.has("has_start_date"),
    hasEndDate: active.has("has_end_date"),
    noDeadline: active.has("no_deadline"),
    unassigned: active.has("unassigned"),
    overTimesheets: active.has("over_timesheets"),
    nearTimesheets: active.has("near_timesheets"),
    archived: active.has("archived"),
    followedByUserId: active.has("followed") ? opts.userId : undefined,
    assignedToEmployeeId: active.has("mine") ? (opts.employeeId ?? undefined) : undefined,
    projectId: opts.projectId,
    search,
    searchFacets,
    dateFilters,
  };

  return { filters, activeKeys: active, view };
}
