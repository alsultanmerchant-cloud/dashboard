import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth-server";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import { backfillAccountHistory } from "@/lib/wa/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pull a connected number's history for its mapped groups (resumable). The UI
// re-calls while `remaining > 0`.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
  const session = req.nextUrl.searchParams.get("session");
  if (!session) return Response.json({ error: "session required" }, { status: 400 });

  const orgId = await getDefaultOrgId();
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const result = await backfillAccountHistory(orgId, session, { refresh });
  return Response.json(result, { status: result.error ? 502 : 200 });
}
