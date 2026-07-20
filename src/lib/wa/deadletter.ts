import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId } from "./ingest";
import { processWaWebhookPayload } from "./process-webhook";

// WHY THIS EXISTS — the 2026-07-14 blackout.
// The OpenWA gateway DELETES a webhook registration after WEBHOOK_MAX_RETRIES
// consecutive non-2xx replies. A transient 500 from /api/wa/webhook tripped
// exactly that: the registration vanished and ALL WhatsApp ingestion went dark
// for four days with no alert, while /satisfaction kept reassuring everyone with
// "no new messages since the last analysis".
//
// The rule that follows: once a payload's signature verifies, the receiver ALWAYS
// acks 2xx. Anything it cannot process is parked here and replayed by
// /api/cron/wa-health, so a bad minute can never again cost us the pipe.

const MAX_ATTEMPTS = 5;

function safeJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    // Unparseable bodies are kept verbatim for forensics. They will never
    // replay successfully, so MAX_ATTEMPTS retires them.
    return { _unparseable_raw: rawBody.slice(0, 10_000) };
  }
}

// Park a payload we could not process. Never throws: a failure to park must not
// escalate into the non-2xx reply this whole mechanism exists to prevent.
export async function parkWaWebhookFailure(params: {
  rawBody: string;
  accountSessionId: string | null;
  error: string;
}): Promise<void> {
  try {
    let organizationId: string | null = null;
    try {
      organizationId = await getDefaultOrgId();
    } catch {
      /* org lookup is best-effort — park it unattributed rather than lose it */
    }
    await supabaseAdmin.from("wa_webhook_deadletter").insert({
      organization_id: organizationId,
      account_session_id: params.accountSessionId,
      payload: safeJson(params.rawBody) as never,
      error: params.error.slice(0, 2000),
    });
  } catch (e) {
    console.error("[wa_deadletter_park_failed]", (e as Error).message);
  }
}

// How many payloads we failed to process recently. This is the EARLY signal the
// 2026-07-14 incident lacked: when /api/wa/webhook starts erroring (the 500s
// that ultimately cost us the registration), parked rows pile up here within
// minutes — long before the 12h "pipe went silent" alarm would notice.
export async function countRecentlyParked(hours = 2): Promise<number> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("wa_webhook_deadletter")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) return 0;
  return count ?? 0;
}

export interface DeadletterReplayResult {
  attempted: number;
  replayed: number;
  stillFailing: number;
  ingested: number;
}

// Re-run parked payloads through the normal processing path. Rows that succeed
// are stamped replayed_at; rows that keep failing accumulate attempts until
// MAX_ATTEMPTS retires them (so a permanently-malformed body can't loop forever).
export async function replayWaWebhookDeadletter(limit = 100): Promise<DeadletterReplayResult> {
  const { data, error } = await supabaseAdmin
    .from("wa_webhook_deadletter")
    .select("id, account_session_id, payload, attempts")
    .is("replayed_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data) return { attempted: 0, replayed: 0, stillFailing: 0, ingested: 0 };

  let replayed = 0;
  let stillFailing = 0;
  let ingested = 0;

  for (const row of data as Array<{
    id: string;
    account_session_id: string | null;
    payload: unknown;
    attempts: number;
  }>) {
    const now = new Date().toISOString();
    try {
      const outcome = await processWaWebhookPayload(row.payload, row.account_session_id, {
        signal: AbortSignal.timeout(15_000),
      });
      ingested += outcome.ingested;
      replayed++;
      await supabaseAdmin
        .from("wa_webhook_deadletter")
        .update({ replayed_at: now, last_attempt_at: now, attempts: row.attempts + 1 })
        .eq("id", row.id);
    } catch (e) {
      stillFailing++;
      await supabaseAdmin
        .from("wa_webhook_deadletter")
        .update({
          last_attempt_at: now,
          attempts: row.attempts + 1,
          error: (e as Error).message.slice(0, 2000),
        })
        .eq("id", row.id);
    }
  }

  return { attempted: data.length, replayed, stillFailing, ingested };
}
