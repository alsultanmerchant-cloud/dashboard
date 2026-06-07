import { requirePermission } from "@/lib/auth-server";
import { analyzeClientSatisfaction, NoTranscriptError } from "@/lib/satisfaction-analyze";

export const maxDuration = 60;

export async function POST(req: Request) {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }

  let clientId: string | undefined;
  try {
    ({ clientId } = await req.json());
  } catch {
    /* ignore */
  }
  if (!clientId) {
    return Response.json({ error: "clientId مطلوب" }, { status: 400 });
  }

  try {
    const { analysisId, result } = await analyzeClientSatisfaction(
      session.orgId,
      clientId,
      session.userId,
    );
    return Response.json({ ok: true, analysisId, result });
  } catch (e) {
    if (e instanceof NoTranscriptError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return Response.json(
      { error: `تعذر التحليل: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
