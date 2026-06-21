import { streamObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { buildAgentPrioritySignals } from "@/lib/agent-priorities/signals";
import { buildAgentPrioritiesPrompt } from "@/lib/agent-priorities/prompt";
import { AgentPrioritiesSchema } from "@/lib/agent-priorities/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

// "Today Priorities" for the signed-in agent. The ranking is computed in code
// (buildAgentPrioritySignals — deterministic, top 5); the model only writes the
// Arabic reason + suggested action per task, keyed by taskId. Signals are built
// fresh from the live DB each call so the list reflects current state. Streamed
// so the client (experimental_useObject) renders prose as it arrives. Nothing
// is persisted — the section is cheap to regenerate on demand.
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const orgId = session.orgId;
  const employeeId = session.employeeId;
  if (!employeeId) {
    // No linked employee profile → nothing to prioritize.
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const body = (await request.json().catch(() => ({}))) as { locale?: string };
  const locale = body.locale === "en" ? "en" : "ar";

  const [signals, knowledge] = await Promise.all([
    buildAgentPrioritySignals(orgId, employeeId, locale),
    buildKnowledgeBlock(orgId),
  ]);

  const prompt = buildAgentPrioritiesPrompt(signals, knowledge, locale);
  const result = streamObject({
    model: google(GEMINI_MODEL),
    schema: AgentPrioritiesSchema,
    maxRetries: 2,
    prompt,
  });

  return result.toTextStreamResponse();
}
