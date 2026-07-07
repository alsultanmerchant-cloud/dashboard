import { streamObject } from "ai";
import { getServerSession } from "@/lib/auth-server";
import { aiModel } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { loadTaskTipContext } from "@/lib/tech-tips/context";
import { buildTaskTipPrompt } from "@/lib/tech-tips/prompt";
import { TaskTechTipSchema } from "@/lib/tech-tips/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// On-demand technical tip for ONE task (task detail page). Button-triggered, so
// we don't spend a model call on every task open. Grounded in the task + its
// project + sibling tasks; the tip domain is the task's service. Org-scoped.
export async function POST(_req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const { taskId } = await ctx.params; // Next 16: params is a Promise
  if (!UUID_RE.test(taskId)) {
    return new Response(JSON.stringify({ error: "Bad task id" }), { status: 400 });
  }

  const taskCtx = await loadTaskTipContext(session.orgId, taskId);
  if (!taskCtx) {
    return new Response(JSON.stringify({ error: "Task not found" }), { status: 404 });
  }
  const knowledge = await buildKnowledgeBlock(session.orgId);

  const result = streamObject({
    model: aiModel("arabicGen"),
    schema: TaskTechTipSchema,
    maxRetries: 2,
    prompt: buildTaskTipPrompt(taskCtx, taskCtx.task.service, knowledge),
  });
  return result.toTextStreamResponse();
}
