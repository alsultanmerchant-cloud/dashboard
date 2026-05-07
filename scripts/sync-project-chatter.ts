#!/usr/bin/env bun
// sync-project-chatter.ts — mirror Odoo mail.message rows for project.project
// records into project_comments. Mirrors the structure of sync-chatter.ts
// but at the project level (566 messages live).

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

const { data: projects } = await supabaseAdmin
  .from("projects")
  .select("id, external_id")
  .eq("organization_id", orgId)
  .eq("external_source", "odoo");
const map = new Map<number, string>();
for (const p of projects ?? []) {
  if (p.external_id) {
    const n = Number(p.external_id);
    if (Number.isFinite(n)) map.set(n, p.id as string);
  }
}
console.log(`[project-chatter] ${map.size} projects to scan`);

const ids = Array.from(map.keys());
const CHUNK = 500;
let comments = 0;
let tracking = 0;

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

const tv = (
  c: string | false,
  t: string | false,
  i: number | false,
  f: number | false,
): string => {
  if (typeof c === "string" && c) return c;
  if (typeof t === "string" && t) return t;
  if (typeof i === "number") return String(i);
  if (typeof f === "number") return String(f);
  return "—";
};

for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK);
  const messages = await odoo.searchRead<OdooMessage>(
    "mail.message",
    [
      ["model", "=", "project.project"],
      ["res_id", "in", slice],
      ["message_type", "in", ["comment", "email", "notification"]],
    ],
    [
      "id", "res_id", "body", "author_id", "date",
      "message_type", "subtype_id", "tracking_value_ids",
    ],
    { limit: 5000, order: "date asc" },
  );
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
    for (const v of tvs) {
      const mid = Array.isArray(v.mail_message_id) ? v.mail_message_id[0] : null;
      if (!mid) continue;
      const arr = tvByMessage.get(mid) ?? [];
      arr.push(v);
      tvByMessage.set(mid, arr);
    }
    const fieldIds = Array.from(
      new Set(
        tvs
          .map((x) => (Array.isArray(x.field_id) ? x.field_id[0] : null))
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
      const projUuid = map.get(m.res_id);
      if (!projUuid) return null;
      const author = Array.isArray(m.author_id) ? m.author_id : null;
      const subtypeId = Array.isArray(m.subtype_id) ? m.subtype_id[0] : null;
      const baseRow = {
        organization_id: orgId,
        project_id: projUuid,
        external_source: "odoo",
        external_id: String(m.id),
        author_user_id: null,
        external_author_name: author ? String(author[1]) : null,
        external_author_avatar_url:
          author && odooBase ? `${odooBase}/web/image/res.partner/${author[0]}/avatar_1` : null,
        is_internal: subtypeId ? internalSubtypeIds.has(subtypeId) : true,
        kind: "note",
        created_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
        updated_at: typeof m.date === "string" ? m.date : new Date().toISOString(),
      };

      if (m.message_type === "notification") {
        const tvs = tvByMessage.get(m.id) ?? [];
        if (tvs.length === 0) return null;
        const lines = tvs.map((v) => {
          const fid = Array.isArray(v.field_id) ? v.field_id[0] : null;
          const label = (fid && fieldLabelById.get(fid)) || "Field";
          const o = tv(v.old_value_char, v.old_value_text, v.old_value_integer, v.old_value_float);
          const n = tv(v.new_value_char, v.new_value_text, v.new_value_integer, v.new_value_float);
          return `<p><strong>${label}:</strong> <span class="text-muted-foreground">${o}</span> → <span class="text-cyan font-medium">${n}</span></p>`;
        });
        return { ...baseRow, body: lines.join("") };
      }

      const body = typeof m.body === "string" ? m.body.trim() : "";
      if (!body) return null;
      return { ...baseRow, body };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (rows.length === 0) continue;
  const { error } = await supabaseAdmin
    .from("project_comments")
    .upsert(rows, { onConflict: "organization_id,external_source,external_id" });
  if (error) {
    console.warn(`[project-chatter] chunk @${i}: ${error.message}`);
  } else {
    for (const r of rows) {
      if (r.body.startsWith("<p><strong>")) tracking++;
      else comments++;
    }
    console.log(
      `[project-chatter] chunk ${i / CHUNK + 1}: +${rows.length} (running ${comments}c / ${tracking}t)`,
    );
  }
}

console.log(`[project-chatter] DONE — ${comments} comments + ${tracking} tracking events`);
process.exit(0);
