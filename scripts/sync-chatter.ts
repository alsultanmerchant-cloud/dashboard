#!/usr/bin/env bun
// Standalone chatter sync — mirrors mail.message into task_comments without
// re-running the full project/task import.
//
// Pulls THREE kinds of activity:
//   1. comment   — user-written notes (HTML body)
//   2. email     — outbound emails on the chatter
//   3. notification — auto-generated tracking events (stage / priority /
//                     assignees changes). Body is synthesized from the
//                     message's mail.tracking.value rows.
//
// Usage: bun run scripts/sync-chatter.ts [org-slug]

import { supabaseAdmin } from "@/lib/supabase/admin";
import { odooFromEnv } from "@/lib/odoo/client";

const slug =
  process.argv[2] ||
  process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ||
  "rawasm-demo";

const odoo = odooFromEnv();
const odooBase = process.env.ODOO_URL?.replace(/\/+$/, "") ?? "";

const { data: org } = await supabaseAdmin
  .from("organizations")
  .select("id")
  .eq("slug", slug)
  .single();
if (!org) throw new Error(`org ${slug} not found`);
const orgId = org.id as string;

const { data: tasks } = await supabaseAdmin
  .from("tasks")
  .select("id, external_id")
  .eq("organization_id", orgId)
  .eq("external_source", "odoo");
const map = new Map<number, string>();
for (const t of tasks ?? []) {
  if (t.external_id) {
    const n = Number(t.external_id);
    if (Number.isFinite(n)) map.set(n, t.id as string);
  }
}
console.log(`[chatter] ${map.size} synced tasks to scan for chatter`);

const ids = Array.from(map.keys());
const CHUNK = 500;
let importedComments = 0;
let importedTracking = 0;

type OdooMessage = {
  id: number;
  res_id: number;
  body: string | false;
  author_id: [number, string] | false;
  date: string | false;
  message_type: string;
  subtype_id: [number, string] | false;
  tracking_value_ids: number[] | false;
};

type OdooTrackingValue = {
  id: number;
  mail_message_id: [number, string] | false;
  field_id: [number, string] | false;
  old_value_char: string | false;
  new_value_char: string | false;
  old_value_text: string | false;
  new_value_text: string | false;
  old_value_integer: number | false;
  new_value_integer: number | false;
  old_value_float: number | false;
  new_value_float: number | false;
};

function trackingValue(
  charV: string | false,
  textV: string | false,
  intV: number | false,
  floatV: number | false,
): string {
  if (typeof charV === "string" && charV) return charV;
  if (typeof textV === "string" && textV) return textV;
  if (typeof intV === "number") return String(intV);
  if (typeof floatV === "number") return String(floatV);
  return "—";
}

for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK);
  const messages = await odoo.searchRead<OdooMessage>(
    "mail.message",
    [
      ["model", "=", "project.task"],
      ["res_id", "in", slice],
      ["message_type", "in", ["comment", "email", "notification"]],
    ],
    [
      "id", "res_id", "body", "author_id", "date", "message_type",
      "subtype_id", "tracking_value_ids",
    ],
    { limit: 5000, order: "date asc" },
  );
  console.log(`[chatter] batch ${i / CHUNK + 1}: ${messages.length} messages`);
  if (messages.length === 0) continue;

  // Subtype lookup for is_internal flag.
  const subtypeIds = Array.from(
    new Set(
      messages
        .map((m) => (Array.isArray(m.subtype_id) ? m.subtype_id[0] : null))
        .filter((x): x is number => Boolean(x)),
    ),
  );
  const internalSubtypeIds = new Set<number>();
  if (subtypeIds.length > 0) {
    const subs = await odoo.searchRead<{ id: number; internal: boolean }>(
      "mail.message.subtype",
      [["id", "in", subtypeIds]],
      ["id", "internal"],
    );
    for (const s of subs) if (s.internal) internalSubtypeIds.add(s.id);
  }

  // Tracking-value rows + field labels (for notifications).
  const trackingValueIds = Array.from(
    new Set(
      messages.flatMap((m) =>
        Array.isArray(m.tracking_value_ids) ? m.tracking_value_ids : [],
      ),
    ),
  );
  const tvByMessage = new Map<number, OdooTrackingValue[]>();
  const fieldLabelById = new Map<number, string>();
  if (trackingValueIds.length > 0) {
    const tvs = await odoo.searchRead<OdooTrackingValue>(
      "mail.tracking.value",
      [["id", "in", trackingValueIds]],
      [
        "id", "mail_message_id", "field_id",
        "old_value_char", "new_value_char",
        "old_value_text", "new_value_text",
        "old_value_integer", "new_value_integer",
        "old_value_float", "new_value_float",
      ],
    );
    for (const tv of tvs) {
      const mid = Array.isArray(tv.mail_message_id) ? tv.mail_message_id[0] : null;
      if (!mid) continue;
      const arr = tvByMessage.get(mid) ?? [];
      arr.push(tv);
      tvByMessage.set(mid, arr);
    }
    const fieldIds = Array.from(
      new Set(
        tvs
          .map((t) => (Array.isArray(t.field_id) ? t.field_id[0] : null))
          .filter((x): x is number => Boolean(x)),
      ),
    );
    if (fieldIds.length > 0) {
      const fields = await odoo.searchRead<{ id: number; field_description: string }>(
        "ir.model.fields",
        [["id", "in", fieldIds]],
        ["id", "field_description"],
      );
      for (const f of fields) fieldLabelById.set(f.id, f.field_description);
    }
  }

  const rows = messages
    .map((m) => {
      const taskUuid = map.get(m.res_id);
      if (!taskUuid) return null;
      const author = Array.isArray(m.author_id) ? m.author_id : null;
      const subtypeId = Array.isArray(m.subtype_id) ? m.subtype_id[0] : null;
      const baseRow = {
        organization_id: orgId,
        task_id: taskUuid,
        external_source: "odoo",
        external_id: String(m.id),
        author_user_id: null,
        external_author_name: author ? String(author[1]) : null,
        external_author_avatar_url:
          author && odooBase ? `${odooBase}/web/image/res.partner/${author[0]}/avatar_1` : null,
        is_internal: subtypeId ? internalSubtypeIds.has(subtypeId) : true,
        kind: "note" as const,
        created_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
        updated_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
      };

      if (m.message_type === "notification") {
        const tvs = tvByMessage.get(m.id) ?? [];
        if (tvs.length === 0) return null;
        const lines = tvs.map((tv) => {
          const fid = Array.isArray(tv.field_id) ? tv.field_id[0] : null;
          const label = (fid && fieldLabelById.get(fid)) || "Field";
          const oldV = trackingValue(
            tv.old_value_char, tv.old_value_text, tv.old_value_integer, tv.old_value_float,
          );
          const newV = trackingValue(
            tv.new_value_char, tv.new_value_text, tv.new_value_integer, tv.new_value_float,
          );
          return `<p><strong>${label}:</strong> <span class="text-muted-foreground">${oldV}</span> → <span class="text-cyan font-medium">${newV}</span></p>`;
        });
        return { ...baseRow, body: lines.join("") };
      }

      // comment / email — keep the raw HTML body.
      const body = typeof m.body === "string" ? m.body.trim() : "";
      if (!body) return null;
      return { ...baseRow, body };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (rows.length === 0) continue;
  const { error } = await supabaseAdmin
    .from("task_comments")
    .upsert(rows, { onConflict: "organization_id,external_source,external_id" });
  if (error) {
    console.warn(`[chatter] upsert error: ${error.message}`);
  } else {
    for (const r of rows) {
      // Crude split: if body starts with our tracking-line wrapper, count as tracking.
      if (r.body.startsWith("<p><strong>")) importedTracking++;
      else importedComments++;
    }
  }
}

console.log(`[chatter] DONE — ${importedComments} comments + ${importedTracking} tracking events mirrored`);
process.exit(0);
