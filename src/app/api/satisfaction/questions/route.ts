import { requirePermission } from "@/lib/auth-server";
import { listSatisfactionQuestions } from "@/lib/satisfaction-questions";

// The questions queue ("أسئلة تحتاج إجابة"): open questions plus the last 30
// days of answered ones, client names resolved from the contract book and
// task codes resolved to /tasks/[id] links. Same read the page itself renders.

export const dynamic = "force-dynamic";

export async function GET() {
  let session;
  try {
    session = await requirePermission("clients.view");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }

  try {
    const data = await listSatisfactionQuestions(session.orgId);
    return Response.json({ ok: true, ...data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
