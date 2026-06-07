import { requirePermission } from "@/lib/auth-server";
import { getQrImage } from "@/lib/wa/openwa-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
  const image = await getQrImage();
  return Response.json({ image });
}
