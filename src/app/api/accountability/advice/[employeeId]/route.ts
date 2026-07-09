import { streamObject } from "ai";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import { aiModel, GEMINI_MODEL } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { getAccountabilityCases } from "@/lib/data/accountability-cases";
import { getCachedAdvice, putCachedAdvice } from "@/lib/data/accountability-cases-store";
import { CaseAdviceSchema } from "@/lib/accountability/advice-schema";
import { adviceSignature, buildCaseAdvicePrompt } from "@/lib/accountability/advice-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// On-demand advice for ONE accountability case. Button-triggered — the page
// never prescribes actions on its own. Cached per (org, employee) and served
// without a model call while the case facts + taught knowledge are unchanged.
export async function POST(_req: Request, ctx: { params: Promise<{ employeeId: string }> }) {
  const session = await getServerSession();
  if (!session || !hasPermission(session, "people.analytics.view")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const { employeeId } = await ctx.params;
  if (!UUID.test(employeeId)) {
    return new Response(JSON.stringify({ error: "Bad employee id" }), { status: 400 });
  }

  const live = await getAccountabilityCases(session.orgId);
  const kase = live.cases.find((c) => c.employeeId === employeeId);
  if (!kase) {
    return new Response(JSON.stringify({ error: "No case for this employee" }), { status: 404 });
  }

  const signature = adviceSignature(kase);
  const cached = await getCachedAdvice(session.orgId, employeeId, signature);
  if (cached) {
    // Serve the stored object as a single JSON body — useObject parses it as the
    // final state of the stream.
    return new Response(JSON.stringify(cached.advice), {
      headers: { "content-type": "application/json; charset=utf-8", "x-cache": "hit" },
    });
  }

  const knowledge = await buildKnowledgeBlock(session.orgId);
  const result = streamObject({
    model: aiModel("arabicGen"),
    schema: CaseAdviceSchema,
    maxRetries: 2,
    prompt: buildCaseAdvicePrompt(kase, knowledge),
    onError: ({ error }) => {
      console.error("[advice] stream error:", error);
    },
    onFinish: async ({ object, error }) => {
      if (error) console.error("[advice] finish error:", error);
      if (object) {
        try {
          await putCachedAdvice(session.orgId, employeeId, signature, object, GEMINI_MODEL);
        } catch (e) {
          console.error("[advice] cache write failed:", e);
        }
      }
    },
  });
  return result.toTextStreamResponse();
}
