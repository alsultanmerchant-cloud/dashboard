import { streamObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildCeoBriefSignals } from "@/lib/data/ceo-brief-signals";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { SECTION_DEFS, isBriefSection } from "@/lib/ceo-brief/sections";
import {
  applyTrajectoryFromSignals,
  applyRisks,
  applyActions,
} from "@/lib/ceo-brief/merge";
import type { CeoBriefResult, RisksAi } from "@/lib/ceo-brief-schema";
import { logAiEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

// Re-analyze ONE brief section, streamed. We deliberately use the fast shared
// model (low time-to-first-token) so the user sees text streaming in — the
// stronger CEO_BRIEF_MODEL has an ~8s TTFT that makes streaming invisible.
// Signals are rebuilt FRESH from the live DB each click, so the section's
// code-computed numbers (statusPct/changes/risk set) reflect current state —
// re-analyze genuinely re-reads the data, not a frozen snapshot. The client
// (experimental_useObject) renders the partial prose live; on finish we persist
// ONLY this section (fresh code fields + AI prose), leaving the others intact.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ section: string }> },
) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { section } = await ctx.params; // Next 16: params is a Promise
  if (!isBriefSection(section)) {
    return new Response(JSON.stringify({ error: "قسم غير معروف" }), { status: 400 });
  }

  const orgId = session.orgId;
  const userId = session.userId;
  const def = SECTION_DEFS[section];

  // Fresh signals from the live DB (not the frozen snapshot) so numbers/risks
  // are current. The full knowledge block is appended so taught lessons apply.
  const [signals, knowledge] = await Promise.all([
    buildCeoBriefSignals(orgId),
    buildKnowledgeBlock(orgId),
  ]);
  const prompt = def.buildPrompt(signals, knowledge);

  const result = streamObject({
    model: google(GEMINI_MODEL),
    schema: def.schema,
    maxRetries: 2,
    prompt,
    onFinish: async ({ object, error }) => {
      if (error || !object) return; // generation failed → keep prior value
      // Re-read the live current row so a concurrent inline-edit / dismissRisk
      // isn't clobbered — we only replace this section's fields.
      const { data: live } = await supabaseAdmin
        .from("ceo_brief_runs")
        .select("id, result_json")
        .eq("organization_id", orgId)
        .eq("is_current", true)
        .eq("status", "ready")
        .maybeSingle();
      const current = (live?.result_json ?? null) as CeoBriefResult | null;
      if (!live || !current) return;

      let next = current;
      if (section === "trajectory") {
        // Refresh Q1 code fields (statusPct/grade/verdict/changes) + headline.
        next = applyTrajectoryFromSignals(current, signals, object as { headline: string });
      } else if (section === "risks") {
        // Rebuild the risk SET from fresh signals + overlay AI interpretations
        // by id — new risks appear, resolved ones drop.
        next = applyRisks(current, signals.risks, object as RisksAi);
      } else {
        next = applyActions(current, object as Parameters<typeof applyActions>[1]);
      }

      const { error: updateError } = await supabaseAdmin
        .from("ceo_brief_runs")
        .update({ result_json: next })
        .eq("id", live.id as string);
      if (updateError) {
        console.warn(`[ceo-brief] section persist failed (${section}): ${updateError.message}`);
        return;
      }
      await logAiEvent({
        organizationId: orgId,
        actorUserId: userId,
        eventType: "CEO_BRIEF_SECTION_REANALYZED",
        entityType: "ceo_brief_runs",
        entityId: live.id as string,
        payload: { section },
        importance: "low",
      });
    },
  });

  return result.toTextStreamResponse();
}
