import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Data for the "Unlinked tasks" review queue (/task-templates/unlinked).
// Surfaces the ~9% of tasks the matcher could not confidently tie to a template
// item (see match-templates.ts): `unmatched` (has a service but no title match),
// `ambiguous` (>1 candidate with conflicting owner maps), and `ad_hoc` (no
// service at all). These fall back to a role-based generic owner map, so nobody
// is mis-attributed — but linking them makes accountability template-accurate
// and teaches an alias so future same-title tasks auto-link.

export const UNLINKED_STATUSES = ["unmatched", "ambiguous", "ad_hoc"] as const;
export type UnlinkedStatus = (typeof UNLINKED_STATUSES)[number];

const PAGE_SIZE = 1_000;

export interface MatchCoverage {
  total: number;
  linked: number; // exact + alias + fuzzy + manual
  unmatched: number;
  ambiguous: number;
  adHoc: number;
  linkedPct: number; // 0..100
}

/** Coverage counters over LIVE (non-archived) tasks — the actionable set. */
export async function getMatchCoverage(orgId: string): Promise<MatchCoverage> {
  // Use exact head-counts (not a row scan) so nothing is capped by PostgREST's
  // 1,000-row response limit.
  const countLive = (
    build: (
      q: ReturnType<typeof baseLiveQuery>,
    ) => ReturnType<typeof baseLiveQuery>,
  ) =>
    build(baseLiveQuery()).then(({ count, error }) => {
      if (error) throw error;
      return count ?? 0;
    });
  function baseLiveQuery() {
    return supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null);
  }

  const LINKED = ["linked_exact", "linked_alias", "linked_fuzzy", "manual"];
  const [total, linked, unmatched, ambiguous, adHoc] = await Promise.all([
    countLive((q) => q),
    countLive((q) => q.in("template_match_status", LINKED)),
    countLive((q) => q.eq("template_match_status", "unmatched")),
    countLive((q) => q.eq("template_match_status", "ambiguous")),
    countLive((q) => q.eq("template_match_status", "ad_hoc")),
  ]);

  return {
    total,
    linked,
    unmatched,
    ambiguous,
    adHoc,
    linkedPct: total > 0 ? Math.round((linked / total) * 1000) / 10 : 0,
  };
}

export interface UnlinkedTask {
  id: string;
  taskCode: string | null;
  title: string | null;
  stage: string;
  status: UnlinkedStatus;
  serviceId: string | null;
  serviceName: string | null;
  projectName: string | null;
  clientName: string | null;
}

/** Live unlinked tasks, newest project activity first. */
export async function listUnlinkedTasks(
  orgId: string,
  opts: { status?: UnlinkedStatus; serviceId?: string } = {},
): Promise<UnlinkedTask[]> {
  const rows: UnlinkedTask[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabaseAdmin
      .from("tasks")
      .select(
        `id, task_code, title, stage, template_match_status, service_id,
         service:services ( name ),
         project:projects ( name, client:clients ( name ) )`,
      )
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    q = opts.status
      ? q.eq("template_match_status", opts.status)
      : q.in("template_match_status", UNLINKED_STATUSES as unknown as string[]);
    if (opts.serviceId) q = q.eq("service_id", opts.serviceId);
    const { data, error } = await q;
    if (error) throw error;
    const page = data ?? [];
    for (const r of page as unknown as RawRow[]) {
      const service = pickOne<{ name: string }>(r.service);
      const project = pickOne<{ name: string; client: unknown }>(r.project);
      const client = project ? pickOne<{ name: string }>(project.client) : null;
      rows.push({
        id: r.id,
        taskCode: r.task_code,
        title: r.title,
        stage: r.stage,
        status: r.template_match_status as UnlinkedStatus,
        serviceId: r.service_id,
        serviceName: service?.name ?? null,
        projectName: project?.name ?? null,
        clientName: client?.name ?? null,
      });
    }
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface TemplateItemOption {
  id: string;
  title: string;
  serviceId: string | null;
  serviceName: string | null;
}

/** All template items (for the manual-link picker), with their service. */
export async function listTemplateItemOptions(
  orgId: string,
): Promise<TemplateItemOption[]> {
  const { data, error } = await supabaseAdmin
    .from("task_template_items")
    .select(
      `id, title, task_template:task_templates ( service:services ( id, name ) )`,
    )
    .eq("organization_id", orgId)
    .order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const tmpl = pickOne((r as { task_template: unknown }).task_template) as
      | { service: unknown }
      | null;
    const service = tmpl ? (pickOne(tmpl.service) as { id: string; name: string } | null) : null;
    return {
      id: r.id as string,
      title: r.title as string,
      serviceId: service?.id ?? null,
      serviceName: service?.name ?? null,
    };
  });
}

/* -- PostgREST embeds arrive as object OR single-element array; normalise. -- */
interface RawRow {
  id: string;
  task_code: string | null;
  title: string | null;
  stage: string;
  template_match_status: string;
  service_id: string | null;
  service: unknown;
  project: unknown;
}
function pickOne<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}
