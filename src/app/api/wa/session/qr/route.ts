import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth-server";
import { getQrImage, WA_SESSION_ID } from "@/lib/wa/openwa-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
  const session = req.nextUrl.searchParams.get("session") || WA_SESSION_ID;
  const image = await getQrImage(session);
  return Response.json({ image });
}
