import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isLeadershipPosition } from "@/lib/data/leadership";
import type { TaskStage } from "@/lib/labels";

// Avg dwell time per stage, computed from task_stage_history segments
// that have already exited. Uses wall-clock (exited_at − entered_at), NOT
// the stored duration_seconds column: for Odoo-imported rows that column
// mirrors Odoo's working-hours `total_duration_seconds` (nights + weekends
// stripped), which under-reports dwell vs Odoo's own calendar stage pills.
// See project_stage_dwell_working_hours_bug.
export async function getStageDwellAverages(
  orgId: string,
): Promise<Array<{ stage: TaskStage; avg_hours: number; segments: number }>> {
  const { data, error } = await supabaseAdmin
    .from("task_stage_history")
    .select("to_stage, entered_at, exited_at")
    .eq("organization_id", orgId)
    .not("exited_at", "is", null);
  if (error) throw error;

  const sums = new Map<string, { total: number; count: number }>();
  for (const r of data ?? []) {
    const row = r as {
      to_stage: string;
      entered_at: string | null;
      exited_at: string | null;
    };
    const stage = row.to_stage;
    if (!stage || !row.entered_at || !row.exited_at) continue;
    const dur =
      (new Date(row.exited_at).getTime() -
        new Date(row.entered_at).getTime()) /
      1000;
    if (dur <= 0) continue;
    const cur = sums.get(stage) ?? { total: 0, count: 0 };
    cur.total += dur;
    cur.count += 1;
    sums.set(stage, cur);
  }

  return Array.from(sums.entries())
    .map(([stage, { total, count }]) => ({
      stage: stage as TaskStage,
      avg_hours: count > 0 ? total / count / 3600 : 0,
      segments: count,
    }))
    .sort((a, b) => b.avg_hours - a.avg_hours);
}

// Normalized set of leadership employee names — the only join key available to
// filter the Odoo People Board (Odoo res.users names ↔ Supabase full_name),
// which carries no position data. Name match is best-effort: same org, same
// Arabic names, so exact-after-trim matches in practice.
export async function getLeadershipNameSet(orgId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("full_name, position:positions ( role, name )")
    .eq("organization_id", orgId);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{
    full_name: string | null;
    position: { role: string | null; name: string | null } | { role: string | null; name: string | null }[] | null;
  }>) {
    const pos = Array.isArray(r.position) ? r.position[0] : r.position;
    if (r.full_name && isLeadershipPosition(pos)) {
      set.add(r.full_name.trim().replace(/\s+/g, " "));
    }
  }
  return set;
}

// Specialist load: open tasks per agent + summed allocated hours.
export async function getSpecialistLoad(
  orgId: string,
): Promise<Array<{
  employee_id: string;
  full_name: string;
  open_count: number;
  allocated_hours: number;
}>> {
  const { data, error } = await supabaseAdmin
    .from("task_assignees")
    .select(`
      employee_id,
      role_type,
      task:tasks!inner ( id, stage, allocated_time_minutes ),
      employee:employee_profiles!task_assignees_employee_id_fkey ( id, full_name, position:positions ( role, name ) )
    `)
    .eq("organization_id", orgId)
    .eq("role_type", "agent");
  if (error) throw error;

  type EmpEmbed = {
    id: string;
    full_name: string;
    position: { role: string | null; name: string | null } | { role: string | null; name: string | null }[] | null;
  };
  type Row = {
    employee_id: string;
    task: { id: string; stage: string; allocated_time_minutes: number | null }
      | { id: string; stage: string; allocated_time_minutes: number | null }[]
      | null;
    employee: EmpEmbed | EmpEmbed[] | null;
  };

  const agg = new Map<string, { name: string; count: number; minutes: number }>();
  for (const raw of (data ?? []) as Row[]) {
    const t = Array.isArray(raw.task) ? raw.task[0] : raw.task;
    const e = Array.isArray(raw.employee) ? raw.employee[0] : raw.employee;
    if (!t || !e) continue;
    // Agents-only performance: skip leadership (dept managers, CSO, leads).
    const pos = Array.isArray(e.position) ? e.position[0] : e.position;
    if (isLeadershipPosition(pos)) continue;
    if (t.stage === "done") continue;
    const cur = agg.get(e.id) ?? { name: e.full_name, count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += t.allocated_time_minutes ?? 0;
    agg.set(e.id, cur);
  }

  return Array.from(agg.entries())
    .map(([employee_id, v]) => ({
      employee_id,
      full_name: v.name,
      open_count: v.count,
      allocated_hours: Math.round((v.minutes / 60) * 10) / 10,
    }))
    .sort((a, b) => b.open_count - a.open_count)
    .slice(0, 15);
}

// Behind-schedule heatmap: open tasks bucketed by progress_slip_percent.
export type SlipBucket =
  | "ahead"
  | "on_track"
  | "minor"
  | "moderate"
  | "severe"
  | "critical";

const BUCKET_LABEL: Record<SlipBucket, string> = {
  ahead: "متقدّم",
  on_track: "على المسار",
  minor: "تأخّر طفيف 1-10%",
  moderate: "تأخّر متوسط 11-25%",
  severe: "تأخّر شديد 26-50%",
  critical: "حرج >50%",
};

export async function getBehindScheduleBuckets(
  orgId: string,
): Promise<Array<{ bucket: SlipBucket; label: string; count: number }>> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, progress_slip_percent, stage")
    .eq("organization_id", orgId)
    .neq("stage", "done");
  if (error) throw error;

  const buckets: Record<SlipBucket, number> = {
    ahead: 0,
    on_track: 0,
    minor: 0,
    moderate: 0,
    severe: 0,
    critical: 0,
  };
  for (const r of (data ?? []) as Array<{
    progress_slip_percent: number | string | null;
  }>) {
    const slip = Number(r.progress_slip_percent ?? 0);
    if (slip < -2) buckets.ahead += 1;
    else if (slip <= 0) buckets.on_track += 1;
    else if (slip <= 10) buckets.minor += 1;
    else if (slip <= 25) buckets.moderate += 1;
    else if (slip <= 50) buckets.severe += 1;
    else buckets.critical += 1;
  }
  const order: SlipBucket[] = [
    "ahead", "on_track", "minor", "moderate", "severe", "critical",
  ];
  return order.map((b) => ({
    bucket: b,
    label: BUCKET_LABEL[b],
    count: buckets[b],
  }));
}

// Designer monthly output: for the given YYYY-MM, sum design_count and
// revision_count over every task whose completed_at falls in that month,
// grouped by each task's assignees (every role_type — the same task can be
// shared between a designer + reviewer). Used by the monthly closing flow:
// the manager picks a month and reads off totals per employee.
export async function getDesignerMonthlyOutput(
  orgId: string,
  year: number,
  month: number,
): Promise<Array<{
  employee_id: string;
  full_name: string;
  job_title: string | null;
  design_total: number;
  revision_total: number;
  task_count: number;
}>> {
  // Month range: [YYYY-MM-01, next-month-01).
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const end = new Date(Date.UTC(year, month, 1)).toISOString();

  // Tasks closed in the window that have at least one count > 0.
  const { data: tasks, error: tErr } = await supabaseAdmin
    .from("tasks")
    .select("id, design_count, revision_count")
    .eq("organization_id", orgId)
    .gte("completed_at", start)
    .lt("completed_at", end)
    .or("design_count.gt.0,revision_count.gt.0");
  if (tErr) throw tErr;

  if (!tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id as string);
  const taskMap = new Map<
    string,
    { design: number; revision: number }
  >();
  for (const t of tasks) {
    taskMap.set(t.id as string, {
      design: (t as { design_count: number }).design_count ?? 0,
      revision: (t as { revision_count: number }).revision_count ?? 0,
    });
  }

  // Pull every assignee on those tasks.
  const { data: assignees, error: aErr } = await supabaseAdmin
    .from("task_assignees")
    .select(
      "task_id, employee:employee_profiles!task_assignees_employee_id_fkey ( id, full_name, job_title, position:positions ( role, name ) )",
    )
    .eq("organization_id", orgId)
    .in("task_id", taskIds);
  if (aErr) throw aErr;

  // Aggregate per employee. The same employee on multiple roles for one task
  // must only count once for that task's totals — dedupe with a Set keyed on
  // (employee_id, task_id).
  const totals = new Map<
    string,
    {
      employee_id: string;
      full_name: string;
      job_title: string | null;
      design_total: number;
      revision_total: number;
      task_count: number;
    }
  >();
  const seen = new Set<string>();

  type DesignerEmp = {
    id: string;
    full_name: string;
    job_title: string | null;
    position: { role: string | null; name: string | null } | { role: string | null; name: string | null }[] | null;
  };
  for (const row of (assignees ?? []) as Array<{
    task_id: string;
    employee: DesignerEmp | DesignerEmp[] | null;
  }>) {
    const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    if (!emp) continue;
    // Agents-only performance: skip leadership.
    const pos = Array.isArray(emp.position) ? emp.position[0] : emp.position;
    if (isLeadershipPosition(pos)) continue;
    const dedupeKey = `${emp.id}:${row.task_id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const taskCounts = taskMap.get(row.task_id);
    if (!taskCounts) continue;

    const entry = totals.get(emp.id) ?? {
      employee_id: emp.id,
      full_name: emp.full_name,
      job_title: emp.job_title ?? null,
      design_total: 0,
      revision_total: 0,
      task_count: 0,
    };
    entry.design_total += taskCounts.design;
    entry.revision_total += taskCounts.revision;
    entry.task_count += 1;
    totals.set(emp.id, entry);
  }

  return Array.from(totals.values()).sort(
    (a, b) =>
      b.design_total + b.revision_total - (a.design_total + a.revision_total),
  );
}
