import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchChatHistory, waConfigured } from "@/lib/wa/openwa-client";
import { ingestWaMessages, type NormalMessage } from "@/lib/wa/ingest";

// Per-account history backfill. For a newly-connected (often older) number, pull
// its message history for the mapped client groups and ingest it ATTRIBUTED to
// that account. Ingest dedups on the bare id, so this only ADDS the messages the
// pool is missing — the older number fills the gap the current one never saw.
//
// Resumable: completion is tracked per (account, chat) in wa_account_backfills,
// so a run only targets groups this account hasn't pulled yet. The gateway
// 429s above a few concurrent history fetches, so concurrency is low and each
// call is capped — the caller re-invokes until `remaining` is 0.

const HISTORY_LIMIT = 1000;
const CONCURRENCY = 2;
const GROUPS_PER_RUN = 40;

export interface BackfillResult {
  ok?: true;
  error?: string;
  groups?: number; // groups processed this run
  imported?: number; // new messages added this run
  remaining?: number; // groups still pending for this account
}

export async function backfillAccountHistory(
  orgId: string,
  sessionId: string,
): Promise<BackfillResult> {
  if (!waConfigured()) {
    return { error: "WA_API_URL غير مهيأ — أضف عنوان خدمة OpenWA في متغيرات البيئة" };
  }

  const { data: acct } = await supabaseAdmin
    .from("wa_accounts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("session_id", sessionId)
    .maybeSingle();
  const accountId = (acct?.id as string | null) ?? null;
  if (!accountId) return { error: "account not found" };

  // Mapped + active groups this account has NOT backfilled yet.
  const { data: links, error: lErr } = await supabaseAdmin
    .from("wa_group_links")
    .select("chat_id, chat_name")
    .eq("organization_id", orgId)
    .not("client_id", "is", null)
    .eq("is_active", true);
  if (lErr) return { error: lErr.message };

  const { data: done } = await supabaseAdmin
    .from("wa_account_backfills")
    .select("chat_id")
    .eq("account_id", accountId);
  const doneSet = new Set((done ?? []).map((d) => d.chat_id as string));

  const pending = (links ?? [])
    .map((l) => ({ chatId: l.chat_id as string, chatName: (l.chat_name as string | null) ?? null }))
    .filter((l) => !doneSet.has(l.chatId));

  if (pending.length === 0) return { ok: true, groups: 0, imported: 0, remaining: 0 };

  const queue = pending.slice(0, GROUPS_PER_RUN);
  let imported = 0;
  let processed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const { chatId, chatName } = queue[cursor++];
      try {
        const hist = await fetchChatHistory(chatId, HISTORY_LIMIT, sessionId);
        const msgs: NormalMessage[] = hist
          .filter((m) => (m.body && m.body.trim().length > 0) || m.media)
          .map((m) => ({
            chatId,
            chatName,
            waMessageId: m.id,
            waRawId: m.id,
            sender: null,
            senderId: m.from,
            body: m.body,
            messageType: m.type,
            isFromMe: m.fromMe,
            sentAt: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : null,
            media: m.media ?? null,
          }));
        let added = 0;
        if (msgs.length > 0) {
          const res = await ingestWaMessages(msgs, sessionId);
          added = res.ingested;
          imported += added;
        }
        // Mark this (account, group) seeded even if it returned nothing, so it
        // isn't retried forever. A thrown gateway error skips the stamp → retried.
        await supabaseAdmin.from("wa_account_backfills").upsert(
          {
            organization_id: orgId,
            account_id: accountId,
            chat_id: chatId,
            imported_count: added,
            imported_at: new Date().toISOString(),
          },
          { onConflict: "account_id,chat_id" },
        );
        processed += 1;
      } catch {
        /* transient gateway error; leave it unmarked → retried next run */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));

  return { ok: true, groups: processed, imported, remaining: pending.length - processed };
}
