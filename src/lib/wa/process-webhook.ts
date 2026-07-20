import "server-only";
import {
  normalizeWaEvents,
  ingestWaMessages,
  extractSessionId,
  extractWaSessionStatus,
  ingestWaSessionStatus,
  type IngestResult,
} from "./ingest";

export type WaWebhookOutcome = IngestResult & {
  sessionStatusUpdated: boolean;
  note?: string;
};

// The ONE processing path, shared by the live receiver (/api/wa/webhook) and the
// dead-letter replay (/api/cron/wa-health), so a parked payload is retried with
// exactly the semantics it would have had on arrival. Throws on failure — the
// callers decide what to do with that (the receiver parks it and still acks).
export async function processWaWebhookPayload(
  payload: unknown,
  accountSessionId: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<WaWebhookOutcome> {
  const session = accountSessionId ?? extractSessionId(payload);

  const status = extractWaSessionStatus(payload);
  const sessionStatusUpdated = status ? await ingestWaSessionStatus(status, session) : false;

  const messages = normalizeWaEvents(payload);
  if (messages.length === 0) {
    return {
      ingested: 0,
      skipped: 0,
      chats: [],
      sessionStatusUpdated,
      note: "no group messages",
    };
  }

  const result = await ingestWaMessages(messages, session, options);
  return { ...result, sessionStatusUpdated };
}
