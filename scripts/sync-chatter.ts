#!/usr/bin/env bun
// Standalone chatter sync — mirrors mail.message into task_comments without
// re-running the full project/task import. Useful as a one-off backfill.
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
let imported = 0;

type OdooMessage = {
  id: number;
  res_id: number;
  body: string | false;
  author_id: [number, string] | false;
  date: string | false;
  message_type: string;
  subtype_id: [number, string] | false;
};

for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK);
  const messages = await odoo.searchRead<OdooMessage>(
    "mail.message",
    [
      ["model", "=", "project.task"],
      ["res_id", "in", slice],
      ["message_type", "in", ["comment", "email"]],
    ],
    ["id", "res_id", "body", "author_id", "date", "message_type", "subtype_id"],
    { limit: 5000, order: "date asc" },
  );
  console.log(`[chatter] batch ${i / CHUNK + 1}: ${messages.length} messages`);
  if (messages.length === 0) continue;

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

  const rows = messages
    .map((m) => {
      const taskUuid = map.get(m.res_id);
      if (!taskUuid) return null;
      const body = typeof m.body === "string" ? m.body.trim() : "";
      if (!body) return null;
      const author = Array.isArray(m.author_id) ? m.author_id : null;
      const subtypeId = Array.isArray(m.subtype_id) ? m.subtype_id[0] : null;
      return {
        organization_id: orgId,
        task_id: taskUuid,
        external_source: "odoo",
        external_id: String(m.id),
        author_user_id: null,
        external_author_name: author ? String(author[1]) : null,
        external_author_avatar_url:
          author && odooBase ? `${odooBase}/web/image/res.partner/${author[0]}/avatar_1` : null,
        body,
        is_internal: subtypeId ? internalSubtypeIds.has(subtypeId) : true,
        kind: "note" as const,
        created_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
        updated_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (rows.length === 0) continue;
  const { error } = await supabaseAdmin
    .from("task_comments")
    .upsert(rows, { onConflict: "organization_id,external_source,external_id" });
  if (error) {
    console.warn(`[chatter] upsert error: ${error.message}`);
  } else {
    imported += rows.length;
  }
}

console.log(`[chatter] DONE — ${imported} messages mirrored`);
process.exit(0);
