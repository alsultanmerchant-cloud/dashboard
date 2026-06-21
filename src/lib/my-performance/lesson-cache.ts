import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getKnowledgeStamp, isStaleAgainstKnowledge } from "@/lib/data/ai-knowledge";
import type { MyFailureItem } from "@/lib/data/my-performance";
import type { FailureLesson } from "@/lib/my-performance/lesson-schema";

// =========================================================================
// Failure-lesson cache (migration 0207). Persists the last AI lesson per
// (org, employee, task) so re-opening a past miss is instant — no Gemini call.
// Invalidated two ways:
//   * signature — hash of the task's failure inputs; changes when the numbers
//                 move (re-run the deadline, more rework, longer dwell).
//   * knowledge — a lesson older than the org's latest taught instruction is
//                 stale (same rule the CEO brief / insights caches use).
// Written only here via the service-role client.
// =========================================================================

// Hash of exactly the inputs the prompt is grounded in.
export function lessonSignature(item: MyFailureItem): string {
  const basis = {
    k: item.kind,
    d: item.delayDays,
    r: item.reworkCount,
    m: item.maxDwellMinutes,
    s: item.stages.map((s) => [s.stage, s.dwellMinutes, s.count]),
  };
  return createHash("sha1").update(JSON.stringify(basis)).digest("hex");
}

export interface CachedLesson {
  lesson: FailureLesson;
  generatedAt: string;
  model: string | null;
}

export async function getCachedLesson(
  orgId: string,
  employeeId: string,
  taskId: string,
  signature: string,
): Promise<CachedLesson | null> {
  const { data, error } = await supabaseAdmin
    .from("ai_lesson_cache")
    .select("signature, result_json, generated_at, model")
    .eq("organization_id", orgId)
    .eq("employee_profile_id", employeeId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.signature !== signature) return null; // task numbers changed
  const stamp = await getKnowledgeStamp(orgId);
  if (isStaleAgainstKnowledge(data.generated_at as string, stamp)) return null; // instructions changed
  return {
    lesson: data.result_json as FailureLesson,
    generatedAt: data.generated_at as string,
    model: (data.model as string | null) ?? null,
  };
}

export async function saveCachedLesson(
  orgId: string,
  employeeId: string,
  taskId: string,
  signature: string,
  model: string,
  lesson: FailureLesson,
): Promise<void> {
  const { error } = await supabaseAdmin.from("ai_lesson_cache").upsert(
    {
      organization_id: orgId,
      employee_profile_id: employeeId,
      task_id: taskId,
      signature,
      model,
      result_json: lesson as never,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,employee_profile_id,task_id" },
  );
  if (error) throw error;
}
