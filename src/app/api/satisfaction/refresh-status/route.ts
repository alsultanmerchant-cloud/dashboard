import { requirePermission } from "@/lib/auth-server";
import { refreshSatisfactionStatuses } from "@/lib/satisfaction-refresh";

// Status refresh ("تحديث"): a cheap reconciliation pass — no full re-analysis.
// Feeds the model the still-open findings + messages since the analysis + the
// live task table, and persists resolved verdicts as the standard issue-keyed
// overlay events. One model call over a bounded prompt; 120s is generous.
export const maxDuration = 120;

export async function POST(req: Request) {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }

  let clientId: string | undefined;
  let analysisId: string | undefined;
  try {
    const body = await req.json();
    if (typeof body.clientId === "string") clientId = body.clientId;
    if (typeof body.analysisId === "string") analysisId = body.analysisId;
  } catch {
    /* ignore */
  }
  if (!clientId) {
    return Response.json({ error: "clientId مطلوب" }, { status: 400 });
  }

  try {
    const summary = await refreshSatisfactionStatuses(
      session.orgId,
      clientId,
      session.userId,
      analysisId ?? null,
    );
    return Response.json({ ok: true, summary });
  } catch (e) {
    return Response.json(
      { error: `تعذر التحديث: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
