import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth-server";
import {
  getSessionInfo,
  startSession,
  logoutSession,
  WA_SESSION_ID,
} from "@/lib/wa/openwa-client";

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

// ?session=<name> selects which connected number to act on (defaults to the
// primary WA_SESSION_ID for backward compatibility).
function sessionOf(req: NextRequest): string {
  return req.nextUrl.searchParams.get("session") || WA_SESSION_ID;
}

// Connection status (polled by the Connect page).
export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(await getSessionInfo(sessionOf(req)));
}

// Create + start the session (and register the webhook).
export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const res = await startSession(sessionOf(req));
  return Response.json(res, { status: res.ok ? 200 : 502 });
}

// Log out / disconnect the number.
export async function DELETE(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const res = await logoutSession(sessionOf(req));
  return Response.json(res, { status: res.ok ? 200 : 502 });
}
