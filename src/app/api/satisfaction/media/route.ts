import { requirePermission } from "@/lib/auth-server";
import { getClientMediaExchange } from "@/lib/data/satisfaction";

// The media summary can require scanning a large connected-chat history. Keep it
// out of the selected-client route and fetch it only when the operator opens the
// evidence panel.
export async function GET(req: Request) {
  let session;
  try {
    session = await requirePermission("clients.view");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }

  const clientId = new URL(req.url).searchParams.get("client");
  if (!clientId || clientId.length > 100) {
    return Response.json({ error: "client مطلوب" }, { status: 400 });
  }

  try {
    const media = await getClientMediaExchange(session.orgId, clientId);
    return Response.json(
      { media },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: `تعذر تحميل ملخص الوسائط: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
