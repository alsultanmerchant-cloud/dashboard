// Phase 16 — Outbox flusher (stub).
//
// Pulls queued rows from `wa_outbox`, sends each via the Meta WhatsApp
// Business Cloud API, marks the row sent/failed. Intended to be invoked
// by pg_cron via `pg_net.http_post` every minute, or by a webhook on
// outbox insert.
//
// Until Meta credentials exist, sending is gated by the `WA_DISPATCH_ENABLED`
// env var. When disabled, rows are marked `skipped` after one attempt so
// the queue does not pile up indefinitely.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_WA_TOKEN") ?? "";
const META_PHONE_ID = Deno.env.get("META_WA_PHONE_NUMBER_ID") ?? "";
const DISPATCH_ENABLED = Deno.env.get("WA_DISPATCH_ENABLED") === "true";
const BATCH_SIZE = Number(Deno.env.get("WA_FLUSH_BATCH") ?? "20");

type OutboxRow = {
  id: string;
  recipient_type: "group" | "employee";
  recipient_chat_id: string | null;
  recipient_phone: string | null;
  meta_template_name: string | null;
  body: string;
  attempts: number;
};

async function sendToMeta(row: OutboxRow): Promise<void> {
  const to = row.recipient_type === "group" ? row.recipient_chat_id : row.recipient_phone;
  if (!to) throw new Error("missing recipient");

  // Meta Cloud API does not natively address WhatsApp groups (group sending
  // requires the on-premise API or a BSP wrapper). For now, group rows
  // route through the same endpoint with `to` set to the group's E.164
  // proxy number; deployments without group support should leave templates
  // targeted to `assignees`.
  const payload = row.meta_template_name
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: row.meta_template_name,
          language: { code: "ar" },
          components: [{ type: "body", parameters: [{ type: "text", text: row.body }] }],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: row.body },
      };

  const r = await fetch(`https://graph.facebook.com/v19.0/${META_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`meta ${r.status}: ${await r.text()}`);
}

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: rows, error: claimErr } = await sb
    .from("wa_outbox")
    .update({ status: "sending" })
    .in("status", ["queued", "failed"])
    .lte("scheduled_at", new Date().toISOString())
    .lt("attempts", 5)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE)
    .select("id, recipient_type, recipient_chat_id, recipient_phone, meta_template_name, body, attempts");

  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 });
  }
  if (!rows?.length) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows as OutboxRow[]) {
    if (!DISPATCH_ENABLED) {
      await sb.from("wa_outbox").update({
        status: "skipped",
        last_error: "dispatch disabled",
        attempts: row.attempts + 1,
      }).eq("id", row.id);
      skipped += 1;
      continue;
    }
    try {
      await sendToMeta(row);
      await sb.from("wa_outbox").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        attempts: row.attempts + 1,
      }).eq("id", row.id);
      sent += 1;
    } catch (err) {
      await sb.from("wa_outbox").update({
        status: "failed",
        last_error: String(err),
        attempts: row.attempts + 1,
      }).eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ processed: rows.length, sent, failed, skipped }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
