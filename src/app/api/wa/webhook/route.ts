import { NextRequest, NextResponse } from "next/server";
import { verifyWaSignature, extractSessionId } from "@/lib/wa/ingest";
import { processWaWebhookPayload } from "@/lib/wa/process-webhook";
import { parkWaWebhookFailure } from "@/lib/wa/deadletter";

// OpenWA webhook receiver. The self-hosted OpenWA gateway posts group-message
// events here (HMAC-signed with WA_WEBHOOK_SECRET). We verify, normalise, and
// store them in wa_messages; new chats auto-register in wa_group_links for the
// admin to map to a client.
//
// ── THE 2xx RULE (do not "fix" this by returning 5xx again) ──────────────────
// The gateway DELETES a webhook registration after WEBHOOK_MAX_RETRIES
// consecutive non-2xx replies. On 2026-07-14 a transient 500 from this route did
// exactly that: the registration vanished and every client's WhatsApp ingestion
// went dark for four days. So once the signature verifies we ALWAYS ack 2xx and
// park anything unprocessable in wa_webhook_deadletter, which /api/cron/wa-health
// replays. Losing one message is recoverable; losing the webhook is not.
// A bad signature still returns 401 — that is an auth fault, not a transient one,
// and wa-health re-registers the webhook if the gateway drops it over that.

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

  const accountTag = req.nextUrl.searchParams.get("account");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Retrying malformed JSON can never succeed, so acking is strictly better
    // than burning a retry budget that ends in de-registration.
    await parkWaWebhookFailure({ rawBody: raw, accountSessionId: accountTag, error: "invalid json" });
    return NextResponse.json({ ok: true, ingested: 0, parked: true, note: "invalid json" });
  }

  // Attribute all event types to a connected number: prefer the stable account
  // query tag registered on the webhook, then fall back to the event envelope.
  const accountSessionId = accountTag ?? extractSessionId(payload);

  try {
    const outcome = await processWaWebhookPayload(payload, accountSessionId, {
      signal: AbortSignal.timeout(8_000),
    });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    await parkWaWebhookFailure({
      rawBody: raw,
      accountSessionId,
      error: (e as Error).message,
    });
    console.error("[wa_webhook_parked]", (e as Error).message);
    // 200 on purpose — see THE 2xx RULE above. The payload is durable in the
    // dead-letter queue and wa-health will replay it within the hour.
    return NextResponse.json({ ok: true, ingested: 0, parked: true, note: "parked for replay" });
  }
}

// Health check for the webhook URL (OpenWA "test webhook" / manual curl).
export async function GET() {
  return NextResponse.json({ ok: true, service: "wa-webhook" });
}
