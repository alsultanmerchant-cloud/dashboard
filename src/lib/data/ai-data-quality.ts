import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// AI data-quality gate.
//
// The agency's data is Odoo-synced and has real, structural gaps: due_date is
// NULL on every task, dashboard_daily_snapshots can be empty (no week-over-week
// history), task_timesheets is empty, and ~25% of tasks sit in the "new" stage
// as an import artifact. Any AI surface that narrates metrics built on those
// columns produces *confident wrong numbers* — which is exactly the "most of
// its analyses are wrong" complaint.
//
// This module probes coverage ONCE and returns per-signal reliability flags +
// Arabic caveats. Signal builders consult it to suppress unreliable risks, and
// the AI generation prompt injects the caveats with a hard rule: never state an
// unreliable metric as fact. Fail-open: if a probe errors we assume the signal
// is usable rather than blanking the whole brief.
// =========================================================================

export type ReliabilityLevel = "reliable" | "partial" | "missing";

export interface SignalReliability {
  level: ReliabilityLevel;
  coverage: number; // 0..1 share of records with the field populated
}

export interface AiDataQuality {
  // Can we trust per-task due dates / on-time-vs-deadline math?
  dueDates: SignalReliability;
  // Do we have snapshot history for "better or worse this week"?
  weekOverWeek: SignalReliability;
  // Is the 30-day on-time % backed by a real snapshot?
  onTimePct: SignalReliability;
  // Is delay *duration* (days) populated, or only the overdue *flag*?
  delayDuration: SignalReliability;
  // Any time tracking at all (load/effort by hours)?
  timesheets: SignalReliability;
  // Human-readable Arabic caveats for the AI prompt (only the unreliable ones).
  caveats: string[];
}

function level(coverage: number, partialAt = 0.5, reliableAt = 0.9): ReliabilityLevel {
  if (coverage >= reliableAt) return "reliable";
  if (coverage >= partialAt) return "partial";
  return "missing";
}

// Resolve a head+count PostgREST query to a number. A probe error returns -1
// ("unknown") so callers can fail open rather than blank the whole brief.
async function toCount(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  try {
    const { count, error } = await query;
    return error ? -1 : count ?? 0;
  } catch {
    return -1;
  }
}

export async function getAiDataQuality(orgId: string): Promise<AiDataQuality> {
  const tasks = () => supabaseAdmin.from("tasks").select("*", { count: "exact", head: true });
  const snaps = () =>
    supabaseAdmin.from("dashboard_daily_snapshots").select("*", { count: "exact", head: true });

  const [
    tasksTotal,
    tasksWithDue,
    tasksWithDelay,
    tasksOverdueFlag,
    snapshotRows,
    snapshotsWithOnTime,
    timesheetRows,
  ] = await Promise.all([
    toCount(tasks().eq("organization_id", orgId)),
    toCount(tasks().eq("organization_id", orgId).not("due_date", "is", null)),
    toCount(tasks().eq("organization_id", orgId).gt("delay_days", 0)),
    toCount(tasks().eq("organization_id", orgId).eq("is_overdue", true)),
    toCount(snaps().eq("organization_id", orgId)),
    toCount(snaps().eq("organization_id", orgId).not("on_time_pct_30d", "is", null)),
    toCount(supabaseAdmin.from("task_timesheets").select("*", { count: "exact", head: true })),
  ]);

  // Fail-open helper: a -1 (probe error) is treated as full coverage so we never
  // blank a brief just because a count query hiccuped.
  const cov = (num: number, den: number): number => {
    if (num < 0 || den < 0) return 1;
    if (den === 0) return 0;
    return Math.min(1, num / den);
  };

  const dueCov = cov(tasksWithDue, tasksTotal);
  // delay *duration* is only meaningful relative to how many tasks are flagged
  // overdue — if 2,900 are overdue but only a fraction carry a delay_days value,
  // the average delay is unreliable.
  const delayCov = cov(tasksWithDelay, Math.max(tasksOverdueFlag, 1));
  // Two snapshots ≈ one week-over-week comparison is possible.
  const wowCov = snapshotRows < 0 ? 1 : snapshotRows >= 2 ? 1 : snapshotRows === 1 ? 0.5 : 0;
  const onTimeCov = snapshotsWithOnTime < 0 ? 1 : snapshotsWithOnTime >= 1 ? 1 : 0;
  const tsCov = timesheetRows < 0 ? 1 : timesheetRows > 0 ? 1 : 0;

  const dueDates: SignalReliability = { level: level(dueCov), coverage: round(dueCov) };
  const weekOverWeek: SignalReliability = { level: level(wowCov), coverage: round(wowCov) };
  const onTimePct: SignalReliability = { level: level(onTimeCov), coverage: round(onTimeCov) };
  const delayDuration: SignalReliability = { level: level(delayCov), coverage: round(delayCov) };
  const timesheets: SignalReliability = { level: level(tsCov), coverage: round(tsCov) };

  const caveats: string[] = [];
  if (dueDates.level === "missing")
    caveats.push(
      "لا توجد تواريخ استحقاق (due_date) على المهام — أي نسبة «التزام بالموعد» محسوبة من المواعيد غير موثوقة؛ اعتمد على عدّ المهام المتأخرة (is_overdue) فقط.",
    );
  if (weekOverWeek.level !== "reliable")
    caveats.push(
      "لا يوجد سجل لقطات يومية كافٍ — مقارنات «هذا الأسبوع مقابل الأسبوع الماضي» غير موثوقة؛ لا تذكر اتجاهًا أسبوعيًا كحقيقة.",
    );
  if (onTimePct.level === "missing")
    caveats.push(
      "نسبة الالتزام لآخر ٣٠ يومًا غير متوفّرة (لا لقطة) — لا تذكر رقم التزام مئوي إن لم يكن مُعطى صراحةً في البيانات.",
    );
  if (delayDuration.level === "missing")
    caveats.push(
      "مدة التأخير بالأيام (delay_days) غير مكتملة — تحدّث عن «عدد» المهام المتأخرة لا عن «متوسط أيام» التأخير.",
    );
  if (timesheets.level === "missing")
    caveats.push(
      "لا توجد سجلات وقت (timesheets) — لا تتحدّث عن ساعات العمل أو الجهد بالساعات؛ استخدم عدد المهام كمقياس للحمل.",
    );

  return { dueDates, weekOverWeek, onTimePct, delayDuration, timesheets, caveats };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
