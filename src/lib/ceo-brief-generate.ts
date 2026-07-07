import "server-only";
import { generateObject } from "ai";
import { gateway } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildCeoBriefSignals } from "@/lib/data/ceo-brief-signals";
import {
  buildKnowledgeBlock,
  getKnowledgeStamp,
  isStaleAgainstKnowledge,
} from "@/lib/data/ai-knowledge";
import type { z } from "zod";
import {
  sanitizeCeoBriefResult,
  type CeoBriefResult,
  type StoredCeoBrief,
} from "@/lib/ceo-brief-schema";
import {
  CEO_BRIEF_MODEL,
  trajectorySection,
  risksSection,
  actionsSection,
  synthesisSection,
  type SectionDef,
} from "@/lib/ceo-brief/sections";
import {
  mergeRisks,
  applyTrajectory,
  applyRisks,
  applyActions,
  applySynthesis,
} from "@/lib/ceo-brief/merge";


// Clicking "تحديث" (or a second cron pass) within this window returns the
// cached brief instead of burning a Gemini call. force=true bypasses.
export const CEO_BRIEF_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type BriefRunRow = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  result_json: CeoBriefResult | null;
};

function rowToStored(row: BriefRunRow): StoredCeoBrief {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    result: sanitizeCeoBriefResult(row.result_json),
  };
}

export async function getCurrentCeoBrief(orgId: string): Promise<StoredCeoBrief | null> {
  const { data } = await supabaseAdmin
    .from("ceo_brief_runs")
    .select("id, status, model, created_at, completed_at, error_message, result_json")
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as BriefRunRow | null;
  if (!row) return null;
  const stamp = await getKnowledgeStamp(orgId);
  return { ...rowToStored(row), stale: isStaleAgainstKnowledge(row.completed_at, stamp) };
}

// Build the deterministic facts, ask Gemini to narrate them, merge, and store
// as the org's current brief. Returns the stored record. requestedBy is null
// for cron runs.
export async function generateAndStoreCeoBrief(
  orgId: string,
  requestedBy: string | null,
): Promise<StoredCeoBrief> {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("ceo_brief_runs")
    .insert({
      organization_id: orgId,
      requested_by: requestedBy,
      status: "running",
      model: CEO_BRIEF_MODEL,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message ?? "تعذّر إنشاء سجل الموجز");
  }
  const runId = inserted.id as string;

  try {
    const [signals, knowledge, prior] = await Promise.all([
      buildCeoBriefSignals(orgId),
      buildKnowledgeBlock(orgId),
      getCurrentCeoBrief(orgId), // prior brief → graceful fallback per section
    ]);
    const priorResult = prior?.result ?? null;

    // Each of the three visual questions is now its own Gemini call, built from
    // the per-section prompt. They run in parallel; one failing no longer blanks
    // the whole brief (the all-or-nothing crash) — a failed section keeps the
    // prior value and the others still persist. runSection preserves the
    // CEO_BRIEF_MODEL → GEMINI_MODEL fallback for a rejected model id.
    async function runSection<S extends z.ZodTypeAny>(
      def: SectionDef<S>,
    ): Promise<{ object: z.infer<S>; model: string }> {
      const prompt = def.buildPrompt(signals, knowledge);
      try {
        const { object } = await generateObject({
          model: gateway(CEO_BRIEF_MODEL),
          schema: def.schema,
          maxRetries: 2,
          prompt,
        });
        return { object: object as z.infer<S>, model: CEO_BRIEF_MODEL };
      } catch (err) {
        // The "stronger" CEO_BRIEF_MODEL is a best-effort upgrade. On ANY failure
        // (rejected model id, timeout, quota/429, transient error) degrade to the
        // known-good GEMINI_MODEL rather than blanking the whole brief — the narrow
        // regex used to only fall back on model-id errors, so a throttled/slow
        // stronger model silently failed all sections. If the fallback ALSO fails,
        // rethrow so per-section graceful-degradation (keep prior value) kicks in.
        if (CEO_BRIEF_MODEL !== GEMINI_MODEL) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[ceo-brief] model "${CEO_BRIEF_MODEL}" failed (${msg}); falling back to ${GEMINI_MODEL}`);
          const { object } = await generateObject({
            model: gateway(GEMINI_MODEL),
            schema: def.schema,
            maxRetries: 2,
            prompt,
          });
          return { object: object as z.infer<S>, model: GEMINI_MODEL };
        }
        throw err;
      }
    }

    const [trajRes, risksRes, actsRes, synthRes] = await Promise.allSettled([
      runSection(trajectorySection),
      runSection(risksSection),
      runSection(actionsSection),
      runSection(synthesisSection),
    ]);

    // Code-computed skeleton (identical to before); AI prose layered on below,
    // falling back to the prior brief where a section failed.
    let result: CeoBriefResult = {
      statusPct: signals.statusPct,
      grade: signals.grade,
      verdict: signals.verdict,
      emphasis: signals.emphasis,
      headline: priorResult?.headline ?? "",
      synthesis: priorResult?.synthesis ?? "",
      changes: signals.changes,
      risks: mergeRisks(signals.risks, []),
      criticalEvents: signals.criticalEvents,
      timelineEvents: signals.timelineEvents,
      recommendations: priorResult?.recommendations ?? [],
      bottomLine: priorResult?.bottomLine ?? "",
    };

    let modelUsed = CEO_BRIEF_MODEL;
    let anySucceeded = false;

    if (trajRes.status === "fulfilled") {
      result = applyTrajectory(result, trajRes.value.object);
      modelUsed = trajRes.value.model;
      anySucceeded = true;
    }

    if (risksRes.status === "fulfilled") {
      result = applyRisks(result, signals.risks, risksRes.value.object);
      anySucceeded = true;
    } else if (priorResult?.risks?.length) {
      // Keep prior interpretations, re-merged onto the CURRENT signal risks.
      result = applyRisks(result, signals.risks, {
        riskNotes: priorResult.risks.map((r) => ({ id: r.id, interpretation: r.interpretation })),
      });
    }

    if (actsRes.status === "fulfilled") {
      result = applyActions(result, actsRes.value.object);
      anySucceeded = true;
    }

    if (synthRes.status === "fulfilled") {
      result = applySynthesis(result, synthRes.value.object);
      anySucceeded = true;
    }

    // Preserve the old failure semantics: only mark the run failed if EVERY
    // section failed (otherwise we have a usable, partially-fresh brief).
    if (!anySucceeded) {
      const rejected = [trajRes, risksRes, actsRes].find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      throw rejected?.reason instanceof Error
        ? rejected.reason
        : new Error("فشل توليد جميع أقسام الموجز");
    }

    // snapshot_text parity: the union of the three sections' fact slices.
    const facts = {
      ...trajectorySection.pickSignals(signals),
      ...risksSection.pickSignals(signals),
      ...actionsSection.pickSignals(signals),
      ...synthesisSection.pickSignals(signals),
    };

    await supabaseAdmin
      .from("ceo_brief_runs")
      .update({ is_current: false })
      .eq("organization_id", orgId)
      .eq("is_current", true);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("ceo_brief_runs")
      .update({
        status: "ready",
        model: modelUsed,
        snapshot_text: JSON.stringify(facts, null, 2),
        result_json: result,
        completed_at: new Date().toISOString(),
        is_current: true,
        error_message: null,
      })
      .eq("id", runId)
      .select("id, status, model, created_at, completed_at, error_message, result_json")
      .single();
    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "تعذّر حفظ الموجز");
    }
    return rowToStored(updated as BriefRunRow);
  } catch (err) {
    await supabaseAdmin
      .from("ceo_brief_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : "فشل توليد الموجز",
        is_current: false,
      })
      .eq("id", runId);
    throw err;
  }
}
