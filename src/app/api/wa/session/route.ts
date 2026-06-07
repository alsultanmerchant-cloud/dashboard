import { requirePermission } from "@/lib/auth-server";
import { getSessionInfo, startSession, logoutSession } from "@/lib/wa/openwa-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  try {
    await requirePermission("clients.manage");
    return null;
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
}

// Connection status (polled by the Connect page).
export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(await getSessionInfo());
}

// Create + start the session (and register the webhook).
export async function POST() {
  const denied = await guard();
  if (denied) return denied;
  const res = await startSession();
  return Response.json(res, { status: res.ok ? 200 : 502 });
}

// Log out / disconnect the number.
export async function DELETE() {
  const denied = await guard();
  if (denied) return denied;
  const res = await logoutSession();
  return Response.json(res, { status: res.ok ? 200 : 502 });
}
