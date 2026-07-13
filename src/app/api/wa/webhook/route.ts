import { NextRequest, NextResponse } from "next/server";
import {
  verifyWaSignature,
  normalizeWaEvents,
  ingestWaMessages,
  extractSessionId,
  extractWaSessionStatus,
  ingestWaSessionStatus,
} from "@/lib/wa/ingest";

// OpenWA webhook receiver. The self-hosted OpenWA gateway posts group-message
// events here (HMAC-signed with WA_WEBHOOK_SECRET). We verify, normalise, and
// store them in wa_messages; new chats auto-register in wa_group_links for the
// admin to map to a client.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const sig =
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-hub-signature-256") ??
    req.headers.get("x-openwa-signature");
  if (!verifyWaSignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Attribute all event types to a connected number: prefer the stable account
  // query tag registered on the webhook, then fall back to the event envelope.
  const accountSessionId =
    req.nextUrl.searchParams.get("account") ?? extractSessionId(payload);
  const sessionStatus = extractWaSessionStatus(payload);
  let sessionStatusUpdated = false;
  if (sessionStatus) {
    try {
      sessionStatusUpdated = await ingestWaSessionStatus(sessionStatus, accountSessionId);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `status ingest failed: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  let messages;
  try {
    messages = normalizeWaEvents(payload);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `normalise failed: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  // Nothing to store (non-message event, 1:1 chat, etc.) — ack so OpenWA
  // doesn't retry.
  if (messages.length === 0) {
    return NextResponse.json({
      ok: true,
      ingested: 0,
      sessionStatusUpdated,
      note: "no group messages",
    });
  }

  try {
    const result = await ingestWaMessages(messages, accountSessionId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `ingest failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

// Health check for the webhook URL (OpenWA "test webhook" / manual curl).
export async function GET() {
  return NextResponse.json({ ok: true, service: "wa-webhook" });
}
