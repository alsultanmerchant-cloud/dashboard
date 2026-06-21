import { streamObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildSignalPack } from "@/lib/insights/signal-pack";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import {
  INSIGHT_SECTION_SCHEMA,
  buildInsightSectionPrompt,
  isInsightSection,
} from "@/lib/insights/sections";
import type { InsightsResult } from "@/lib/ai-insights-schema";
import { logAiEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

// Re-analyze ONE insights section, streamed. Fresh signal pack each call (live
// data), fast model for visible streaming. The model copies the section's
// numbers from the payload + writes its prose, so persisting is a shallow merge
// of the section's fields into the current result_json (other sections intact).
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ section: string }> },
) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { section } = await ctx.params;
  if (!isInsightSection(section)) {
    return new Response(JSON.stringify({ error: "قسم غير معروف" }), { status: 400 });
  }

  const orgId = session.orgId;
  const userId = session.userId;

  const [{ payloadForModel }, knowledge] = await Promise.all([
    buildSignalPack(orgId),
    buildKnowledgeBlock(orgId),
  ]);
  const prompt = buildInsightSectionPrompt(section, payloadForModel, knowledge);

  const result = streamObject({
    model: google(GEMINI_MODEL),
    schema: INSIGHT_SECTION_SCHEMA[section],
    maxRetries: 2,
    prompt,
    onFinish: async ({ object, error }) => {
      if (error || !object) return;
      const { data: live } = await supabaseAdmin
        .from("ai_insight_runs")
        .select("id, result_json")
        .eq("organization_id", orgId)
        .eq("is_current", true)
        .eq("status", "ready")
        .maybeSingle();
      const current = (live?.result_json ?? null) as InsightsResult | null;
      if (!live || !current) return;

      // Shallow merge: the section object holds exactly this section's fields.
      const next = { ...current, ...(object as Partial<InsightsResult>) };
      const { error: updateError } = await supabaseAdmin
        .from("ai_insight_runs")
        .update({ result_json: next })
        .eq("id", live.id as string);
      if (updateError) {
        console.warn(`[insights] section persist failed (${section}): ${updateError.message}`);
        return;
      }
      await logAiEvent({
        organizationId: orgId,
        actorUserId: userId,
        eventType: "AI_INSIGHTS_SECTION_REANALYZED",
        entityType: "ai_insight_runs",
        entityId: live.id as string,
        payload: { section },
        importance: "low",
      });
    },
  });

  return result.toTextStreamResponse();
}
