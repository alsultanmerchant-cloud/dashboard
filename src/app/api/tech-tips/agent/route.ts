import { streamObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { buildAgentTipContext } from "@/lib/tech-tips/context";
import { buildAgentTipPrompt } from "@/lib/tech-tips/prompt";
import { AgentTechTipSchema } from "@/lib/tech-tips/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

// Technical-tip card for the signed-in specialist: a tip tied to their
// top-priority task (with project grounding) + a general best-practice tip for
// their specialization. Context is built fresh from the live DB; streamed so
// the prose renders as it arrives. Nothing persisted.
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const employeeId = session.employeeId;
  if (!employeeId) {
    return new Response(JSON.stringify({ focusTip: "", generalTip: "" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const body = (await request.json().catch(() => ({}))) as { locale?: string };
  const locale = body.locale === "en" ? "en" : "ar";

  const [ctx, knowledge] = await Promise.all([
    buildAgentTipContext(session.orgId, employeeId, locale),
    buildKnowledgeBlock(session.orgId),
  ]);

  const result = streamObject({
    model: google(GEMINI_MODEL),
    schema: AgentTechTipSchema,
    maxRetries: 2,
    prompt: buildAgentTipPrompt(ctx, knowledge, locale),
  });
  return result.toTextStreamResponse();
}
