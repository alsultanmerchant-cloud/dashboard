import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildAgentPrioritySignals } from "@/lib/agent-priorities/signals";

// =========================================================================
// Technical-tip context builders.
//
// Feeds the AI enough grounding to produce a SPECIALIZATION-aware, actionable
// hint that moves a specialist's task forward:
//   - the task (title/stage/service)
//   - its project + client
//   - the project's sibling tasks (so the tip fits the wider deliverable)
//   - the specialist's specialization (their department, e.g. "السيو (SEO)")
// =========================================================================

const STAGE_LABELS: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
  done: "مكتملة",
};
export const stageLabel = (s: string) => STAGE_LABELS[s] ?? s;

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export interface TaskTipContext {
  task: { id: string; title: string; code: string | null; stage: string; service: string | null };
  project: { id: string | null; name: string | null; client: string | null } | null;
  siblings: { title: string; stage: string }[];
}

type RawTask = {
  id: string;
  title: string;
  task_code: string | null;
  stage: string;
  project_id: string | null;
  service: { name: string } | { name: string }[] | null;
  project: { id: string; name: string; client: { name: string } | { name: string }[] | null } | { id: string; name: string; client: { name: string } | { name: string }[] | null }[] | null;
};

/** Load a single task + its project + sibling tasks (other open tasks in the
 *  same project, capped) for tip grounding. Org-scoped. */
export async function loadTaskTipContext(orgId: string, taskId: string): Promise<TaskTipContext | null> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(
      "id, title, task_code, stage, project_id, service:services(name), project:projects(id, name, client:clients(name))",
    )
    .eq("organization_id", orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const t = data as unknown as RawTask;
  const project = one(t.project);
  const clientName = project ? one((project as { client?: { name: string } | { name: string }[] | null }).client ?? null)?.name ?? null : null;

  let siblings: { title: string; stage: string }[] = [];
  if (t.project_id) {
    const { data: sib } = await supabaseAdmin
      .from("tasks")
      .select("title, stage")
      .eq("organization_id", orgId)
      .eq("project_id", t.project_id)
      .neq("id", taskId)
      .neq("stage", "done")
      .limit(12);
    siblings = (sib ?? []).map((s) => ({ title: s.title as string, stage: s.stage as string }));
  }

  return {
    task: {
      id: t.id,
      title: t.title,
      code: t.task_code,
      stage: t.stage,
      service: one(t.service)?.name ?? null,
    },
    project: project ? { id: project.id, name: project.name, client: clientName } : null,
    siblings,
  };
}

export interface AgentTipContext {
  specialization: string; // the specialist's department, e.g. "السيو (SEO)"
  activeServices: string[]; // distinct service names across their open tasks
  focusTask: { id: string; title: string; code: string | null; stage: string } | null;
  focusContext: TaskTipContext | null; // full grounding for the focus task
}

/** Build the dashboard tip context: the specialist's specialization + their
 *  top-priority task (reusing the priority ranking) with full project grounding. */
export async function buildAgentTipContext(
  orgId: string,
  employeeId: string,
  locale: "ar" | "en" = "ar",
): Promise<AgentTipContext> {
  const [profileRes, signals] = await Promise.all([
    supabaseAdmin
      .from("employee_profiles")
      .select("department:departments!employee_profiles_department_id_fkey(name)")
      .eq("organization_id", orgId)
      .eq("id", employeeId)
      .maybeSingle(),
    buildAgentPrioritySignals(orgId, employeeId, locale),
  ]);

  const specialization =
    one(profileRes.data?.department as { name: string } | { name: string }[] | null)?.name ??
    (locale === "ar" ? "تخصصك" : "your specialty");

  const top = signals[0] ?? null;
  const focusContext = top ? await loadTaskTipContext(orgId, top.taskId) : null;
  // Service names that ground the general tip — the focus task's service plus
  // any distinct project/client framing we already loaded.
  const services = new Set<string>();
  if (focusContext?.task.service) services.add(focusContext.task.service);

  return {
    specialization,
    activeServices: [...services],
    focusTask: top
      ? { id: top.taskId, title: top.title, code: top.taskCode, stage: top.stage }
      : null,
    focusContext,
  };
}
