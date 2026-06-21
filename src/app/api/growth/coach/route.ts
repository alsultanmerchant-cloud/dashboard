import { streamObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { getAgentGrowth } from "@/lib/data/agent-growth";
import { buildGrowthCoachPrompt } from "@/lib/growth-coach/prompt";
import { GrowthCoachSchema } from "@/lib/growth-coach/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

// Private growth coach for the signed-in specialist: reads their own scorecard
// + self-trend (this 30 days vs prior) and streams a constructive, specialty-
// specific coaching note. Numbers are computed server-side; the model only
// writes prose. Nothing persisted.
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const employeeId = session.employeeId;
  if (!employeeId) {
    return new Response(JSON.stringify({ diagnosis: "", focusArea: "", actions: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const body = (await request.json().catch(() => ({}))) as { locale?: string };
  const locale = body.locale === "en" ? "en" : "ar";

  const [growth, knowledge] = await Promise.all([
    getAgentGrowth(session.orgId, employeeId),
    buildKnowledgeBlock(session.orgId),
  ]);

  const result = streamObject({
    model: google(GEMINI_MODEL),
    schema: GrowthCoachSchema,
    maxRetries: 2,
    prompt: buildGrowthCoachPrompt(growth, knowledge, locale),
  });
  return result.toTextStreamResponse();
}
