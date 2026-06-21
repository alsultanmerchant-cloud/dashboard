import { getServerSession } from "@/lib/auth-server";
import { isAgentAiKind, saveAgentAiCache } from "@/lib/data/agent-ai-cache";

export const runtime = "nodejs";

// Persist the last AI result for one of the agent cockpit's cards. The client
// posts the streamed object on finish; we store it per (employee, kind) so the
// next dashboard load renders it without a fresh Gemini call.
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const employeeId = session.employeeId;
  if (!employeeId) {
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    payload?: unknown;
  };
  if (!isAgentAiKind(body.kind) || body.payload == null || typeof body.payload !== "object") {
    return new Response(JSON.stringify({ error: "Bad request" }), { status: 400 });
  }

  try {
    await saveAgentAiCache(session.orgId, employeeId, body.kind, body.payload);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
}
