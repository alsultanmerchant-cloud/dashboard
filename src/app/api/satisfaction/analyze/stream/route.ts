import { streamObject } from "ai";
import { aiModel } from "@/lib/ai-model";
import { requirePermission } from "@/lib/auth-server";
import { SatisfactionSchema } from "@/lib/satisfaction-schema";
import {
  buildSatisfactionInput,
  persistSatisfaction,
  SATISFACTION_MAX_CHARS,
  NoTranscriptError,
  NoRecentActivityError,
} from "@/lib/satisfaction-analyze";

// Streaming re-analyze for a single client's satisfaction. The analysis sections
// are tightly coupled (summary/scores/recommendations synthesize the same
// chat+task+contract sources), so it's ONE streamed analysis, not per-section.
// Builds fresh inputs each call (live data), streams partials via streamObject,
// and persists on finish through the same path as the blocking route + cron.
export const runtime = "nodejs";
export const maxDuration = 300;


export async function POST(req: Request) {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }

  let clientId: string | undefined;
  let windowKind: "week" | "all" = "week";
  try {
    const body = await req.json();
    clientId = body.clientId;
    if (body.windowKind === "all" || body.windowKind === "week") windowKind = body.windowKind;
  } catch {
    /* ignore */
  }
  if (!clientId) {
    return Response.json({ error: "clientId مطلوب" }, { status: 400 });
  }

  const orgId = session.orgId;
  const userId = session.userId;

  let input;
  try {
    input = await buildSatisfactionInput(orgId, clientId, { windowKind });
  } catch (e) {
    if (e instanceof NoTranscriptError || e instanceof NoRecentActivityError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return Response.json({ error: `تعذر تجهيز التحليل: ${(e as Error).message}` }, { status: 502 });
  }

  const result = streamObject({
    model: aiModel("flagship"),
    schema: SatisfactionSchema,
    maxRetries: 2,
    prompt: input.makePrompt(SATISFACTION_MAX_CHARS),
    onFinish: async ({ object, error }) => {
      if (error || !object) return;
      try {
        await persistSatisfaction(orgId, clientId!, userId, object, input);
      } catch (e) {
        console.warn(`[satisfaction] stream persist failed: ${(e as Error).message}`);
      }
    },
  });

  return result.toTextStreamResponse();
}
