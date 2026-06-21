import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listMyUploadQueue } from "@/lib/data/uploads";

// =========================================================================
// Agent "Today Priorities" — hybrid AI section.
//
// This module does ALL the ranking in code (deterministic, verifiable). The
// model never reorders and never invents numbers: it only writes the Arabic
// `reason` + `suggestedAction` prose, keyed by taskId. Every field a row
// needs to render (title, code, heuristic reason/action fallback) is computed
// here so the section degrades gracefully if the AI call fails.
// =========================================================================

const TOP_N = 5;
const DAY_MS = 86_400_000;

// Roles that "own" a task while it sits in a given stage. Mirrors
// STAGE_OWNER_ROLES in cockpit.ts / ROLE_STAGES in accountability.ts.
const STAGE_OWNER_ROLES: Record<string, string[]> = {
  new: ["agent", "specialist", "supporting_agent"],
  in_progress: ["agent", "specialist", "supporting_agent"],
  manager_review: ["manager"],
  specialist_review: ["specialist"],
  ready_to_send: ["account_manager"],
  sent_to_client: ["account_manager"],
  client_changes: ["agent", "specialist", "supporting_agent"],
};
const REVIEW_STAGES = new Set(["manager_review", "specialist_review"]);
const DELIVERY_STAGES = new Set(["ready_to_send", "sent_to_client"]);

export interface PrioritySignal {
  taskId: string;
  title: string;
  taskCode: string | null;
  stage: string;
  projectName: string | null;
  clientName: string | null;
  dueDate: string | null;
  dueDeltaDays: number | null; // negative = overdue, 0 = today
  isOverdue: boolean;
  slaOverByHours: number | null; // >0 when the current stage SLA is breached
  idleDays: number; // days since the task entered its current stage
  uploadSoon: boolean; // an upload deadline is today or already overdue
  dependentsCount: number; // tasks blocked until this one finishes
  ownsStage: boolean; // the employee is responsible at the current stage
  score: number;
  reasonHint: string; // Arabic fallback reason (used if AI omits the row)
  actionHint: string; // Arabic fallback suggested action
}

type RawTask = {
  id: string;
  title: string;
  task_code: string | null;
  stage: string;
  due_date: string | null;
  planned_date: string | null;
  is_overdue: boolean | null;
  stage_entered_at: string | null;
  archived_at: string | null;
  project: { name: string; client: { name: string } | { name: string }[] | null } | { name: string; client: { name: string } | { name: string }[] | null }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function projName(p: RawTask["project"]): string | null {
  return one(p)?.name ?? null;
}
function clientName(p: RawTask["project"]): string | null {
  const proj = one(p);
  if (!proj) return null;
  return one((proj as { client?: { name: string } | { name: string }[] | null }).client ?? null)?.name ?? null;
}

function actionVerb(stage: string, uploadSoon: boolean, locale: "ar" | "en"): string {
  if (REVIEW_STAGES.has(stage)) return locale === "ar" ? "راجع" : "Review";
  if (DELIVERY_STAGES.has(stage)) return locale === "ar" ? "سلّم" : "Deliver";
  if (uploadSoon) return locale === "ar" ? "ارفع" : "Upload";
  return locale === "ar" ? "ابدأ" : "Start";
}

async function _buildAgentPrioritySignals(
  orgId: string,
  employeeId: string,
  locale: "ar" | "en" = "ar",
): Promise<PrioritySignal[]> {
  const [assigneeRes, slaRes, uploadQueue] = await Promise.all([
    supabaseAdmin
      .from("task_assignees")
      .select(
        "role_type, task:tasks!inner(id, title, task_code, stage, due_date, planned_date, is_overdue, stage_entered_at, archived_at, project:projects(name, client:clients(name)))",
      )
      .eq("organization_id", orgId)
      .eq("employee_id", employeeId)
      .neq("task.stage", "done")
      .is("task.archived_at", null),
    supabaseAdmin.from("sla_rules").select("stage_key, max_minutes").eq("organization_id", orgId),
    listMyUploadQueue(orgId, employeeId),
  ]);
  if (assigneeRes.error) throw assigneeRes.error;
  if (slaRes.error) throw slaRes.error;

  const slaByStage = new Map<string, number>();
  for (const r of slaRes.data ?? []) slaByStage.set(r.stage_key as string, r.max_minutes as number);

  // Upload deadlines that are due today or overdue → the uploadSoon signal.
  const uploadSoonIds = new Set(
    uploadQueue.filter((r) => r.bucket === "overdue" || r.bucket === "today").map((r) => r.id),
  );

  // Dedup assignments to one row per task, preferring the role that owns the
  // current stage (so a reviewer task is scored as a review, not execution).
  const byTask = new Map<string, { task: RawTask; ownsStage: boolean }>();
  for (const row of (assigneeRes.data ?? []) as unknown as { role_type: string; task: RawTask | RawTask[] | null }[]) {
    const t = one(row.task);
    if (!t || t.archived_at || t.stage === "done") continue;
    const owns = (STAGE_OWNER_ROLES[t.stage] ?? []).includes(row.role_type);
    const prev = byTask.get(t.id);
    if (!prev) byTask.set(t.id, { task: t, ownsStage: owns });
    else if (owns && !prev.ownsStage) prev.ownsStage = true;
  }

  // Count downstream dependents (tasks blocked until mine finishes).
  const taskIds = [...byTask.keys()];
  const dependentsByTask = new Map<string, number>();
  if (taskIds.length > 0) {
    const { data: links } = await supabaseAdmin
      .from("task_links")
      .select("source_task_id")
      .eq("organization_id", orgId)
      .in("source_task_id", taskIds);
    for (const l of links ?? []) {
      const id = l.source_task_id as string;
      dependentsByTask.set(id, (dependentsByTask.get(id) ?? 0) + 1);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  const signals: PrioritySignal[] = [];
  for (const { task: t, ownsStage } of byTask.values()) {
    const due = t.due_date ?? t.planned_date;
    const dueDeltaDays = due
      ? Math.round((new Date(due).getTime() - new Date(todayStr).getTime()) / DAY_MS)
      : null;
    const isOverdue = !!t.is_overdue || (due != null && due < todayStr);
    const enteredMs = t.stage_entered_at ? new Date(t.stage_entered_at).getTime() : now;
    const idleDays = Math.max(0, Math.floor((now - enteredMs) / DAY_MS));
    const dwellMin = (now - enteredMs) / 60000;
    const slaMin = ownsStage ? slaByStage.get(t.stage) ?? null : null;
    const slaOverByHours = slaMin != null && dwellMin > slaMin
      ? Math.round(((dwellMin - slaMin) / 60) * 10) / 10
      : null;
    const uploadSoon = uploadSoonIds.has(t.id);
    const dependentsCount = dependentsByTask.get(t.id) ?? 0;

    // ---- Deterministic priority score (higher = more urgent) -------------
    let score = 0;
    if (slaOverByHours != null) score += 120 + Math.min(slaOverByHours, 48);
    if (isOverdue) score += 70 + Math.min(dueDeltaDays != null ? -dueDeltaDays : 0, 30);
    else if (dueDeltaDays === 0) score += 50;
    else if (dueDeltaDays != null && dueDeltaDays <= 2) score += 25;
    if (uploadSoon) score += 40;
    if (dependentsCount > 0) score += Math.min(dependentsCount, 5) * 12;
    score += Math.min(idleDays, 14) * 2;

    // ---- Heuristic prose (fallback when the AI row is missing) -----------
    const verb = actionVerb(t.stage, uploadSoon, locale);
    let reasonHint: string;
    if (locale === "ar") {
      if (slaOverByHours != null) reasonHint = `تجاوزت SLA لمرحلتها الحالية بـ ${slaOverByHours} ساعة`;
      else if (isOverdue) reasonHint = `متأخرة ${dueDeltaDays != null ? -dueDeltaDays : 0} يوم عن موعد التسليم`;
      else if (dueDeltaDays === 0) reasonHint = "موعد التسليم اليوم";
      else if (uploadSoon) reasonHint = "اقترب موعد رفع الملف";
      else if (dependentsCount > 0) reasonHint = `${dependentsCount} مهمة تعتمد على إنجازها`;
      else if (idleDays >= 3) reasonHint = `بدون تحديث منذ ${idleDays} يوم`;
      else reasonHint = "ضمن أولوياتك القادمة";
    } else {
      if (slaOverByHours != null) reasonHint = `The current stage SLA is exceeded by ${slaOverByHours} hours`;
      else if (isOverdue) reasonHint = `${dueDeltaDays != null ? -dueDeltaDays : 0} days past the delivery deadline`;
      else if (dueDeltaDays === 0) reasonHint = "The delivery deadline is today";
      else if (uploadSoon) reasonHint = "The upload deadline is approaching";
      else if (dependentsCount > 0) reasonHint = `${dependentsCount} tasks depend on its completion`;
      else if (idleDays >= 3) reasonHint = `No update for ${idleDays} days`;
      else reasonHint = "This is one of your next priorities";
    }
    const actionHint = locale === "ar" ? `${verb} المهمة الآن` : `${verb} this task now`;

    signals.push({
      taskId: t.id,
      title: t.title,
      taskCode: t.task_code,
      stage: t.stage,
      projectName: projName(t.project),
      clientName: clientName(t.project),
      dueDate: due,
      dueDeltaDays,
      isOverdue,
      slaOverByHours,
      idleDays,
      uploadSoon,
      dependentsCount,
      ownsStage,
      score,
      reasonHint,
      actionHint,
    });
  }

  signals.sort((a, b) => b.score - a.score);
  return signals.slice(0, TOP_N);
}

export const buildAgentPrioritySignals = cache(_buildAgentPrioritySignals);
