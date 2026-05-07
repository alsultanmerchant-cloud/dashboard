import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TaskStage } from "@/lib/labels";

// Avg dwell time per stage, computed from task_stage_history segments
// that have already exited. duration_seconds is trigger-maintained.
export async function getStageDwellAverages(
  orgId: string,
): Promise<Array<{ stage: TaskStage; avg_hours: number; segments: number }>> {
  const { data, error } = await supabaseAdmin
    .from("task_stage_history")
    .select("to_stage, duration_seconds")
    .eq("organization_id", orgId)
    .not("exited_at", "is", null);
  if (error) throw error;

  const sums = new Map<string, { total: number; count: number }>();
  for (const r of data ?? []) {
    const stage = (r as { to_stage: string }).to_stage;
    const dur = (r as { duration_seconds: number | null }).duration_seconds ?? 0;
    if (!stage || dur <= 0) continue;
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
      employee:employee_profiles ( id, full_name )
    `)
    .eq("organization_id", orgId)
    .eq("role_type", "agent");
  if (error) throw error;

  type Row = {
    employee_id: string;
    task: { id: string; stage: string; allocated_time_minutes: number | null }
      | { id: string; stage: string; allocated_time_minutes: number | null }[]
      | null;
    employee: { id: string; full_name: string }
      | { id: string; full_name: string }[]
      | null;
  };

  const agg = new Map<string, { name: string; count: number; minutes: number }>();
  for (const raw of (data ?? []) as Row[]) {
    const t = Array.isArray(raw.task) ? raw.task[0] : raw.task;
    const e = Array.isArray(raw.employee) ? raw.employee[0] : raw.employee;
    if (!t || !e) continue;
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
