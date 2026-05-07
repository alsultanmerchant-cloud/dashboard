#!/usr/bin/env bun
// sync-attachments.ts — mirror Odoo ir.attachment metadata for project.task
// and project.project records into Supabase task_attachments / project_attachments.
//
// Strategy: import metadata + a fallback Odoo source URL. Binary content is
// NOT downloaded to Supabase Storage by this script (would be GBs). The
// dashboard renders the file list with a "Open original" link to Odoo
// (/web/content/{id}?download=true). A future job can lazily upload chosen
// files into the `attachments` storage bucket.
//
// Idempotent: keyed on (organization_id, external_source='odoo', external_id).
//
// Usage: bun run scripts/sync-attachments.ts [org-slug]

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

// Build odoo task id -> supabase task uuid map (paginated)
const taskMap = new Map<number, string>();
const PAGE = 1000;
for (let off = 0; ; off += PAGE) {
  const { data: tasks, error } = await supabaseAdmin
    .from("tasks")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .eq("external_source", "odoo")
    .range(off, off + PAGE - 1);
  if (error) throw error;
  if (!tasks || tasks.length === 0) break;
  for (const t of tasks) {
    if (t.external_id) {
      const n = Number(t.external_id);
      if (Number.isFinite(n)) taskMap.set(n, t.id as string);
    }
  }
  if (tasks.length < PAGE) break;
}

// And project id map
const { data: projects } = await supabaseAdmin
  .from("projects")
  .select("id, external_id")
  .eq("organization_id", orgId)
  .eq("external_source", "odoo");
const projectMap = new Map<number, string>();
for (const p of projects ?? []) {
  if (p.external_id) {
    const n = Number(p.external_id);
    if (Number.isFinite(n)) projectMap.set(n, p.id as string);
  }
}

console.log(
  `[attachments] mapped ${taskMap.size} tasks, ${projectMap.size} projects`,
);

type Attachment = {
  id: number;
  name: string | false;
  res_model: string | false;
  res_id: number | false;
  mimetype: string | false;
  file_size: number | false;
  create_date: string | false;
  type: string | false; // 'binary' | 'url'
  url: string | false;
};

const FIELDS = [
  "id",
  "name",
  "res_model",
  "res_id",
  "mimetype",
  "file_size",
  "create_date",
  "type",
  "url",
];

async function syncFor(model: "project.task" | "project.project") {
  const ids = Array.from(model === "project.task" ? taskMap.keys() : projectMap.keys());
  if (ids.length === 0) return 0;
  const targetTable = model === "project.task" ? "task_attachments" : "project_attachments";
  const fkCol = model === "project.task" ? "task_id" : "project_id";
  const idMap = model === "project.task" ? taskMap : projectMap;

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await odoo.searchRead<Attachment>(
      "ir.attachment",
      [
        ["res_model", "=", model],
        ["res_id", "in", slice],
      ],
      FIELDS,
      { limit: 8000 },
    );
    if (rows.length === 0) continue;

    const upserts = rows
      .map((a) => {
        const fk = typeof a.res_id === "number" ? idMap.get(a.res_id) : undefined;
        if (!fk) return null;
        const sourceUrl =
          typeof a.url === "string" && a.url
            ? a.url
            : odooBase
            ? `${odooBase}/web/content/${a.id}?download=true`
            : null;
        return {
          organization_id: orgId,
          [fkCol]: fk,
          filename: typeof a.name === "string" && a.name ? a.name : `attachment-${a.id}`,
          mimetype: typeof a.mimetype === "string" ? a.mimetype : null,
          size_bytes: typeof a.file_size === "number" ? a.file_size : null,
          source_url: sourceUrl,
          external_source: "odoo",
          external_id: String(a.id),
          created_at: typeof a.create_date === "string" ? a.create_date : new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (upserts.length === 0) continue;
    const { error } = await supabaseAdmin
      .from(targetTable)
      .upsert(upserts, { onConflict: "organization_id,external_source,external_id" });
    if (error) {
      console.warn(`[${targetTable}] chunk @${i}: ${error.message}`);
    } else {
      inserted += upserts.length;
      console.log(
        `[${targetTable}] +${upserts.length} (chunk ${i / CHUNK + 1}, total ${inserted})`,
      );
    }
  }
  return inserted;
}

const taskAttachments = await syncFor("project.task");
const projectAttachments = await syncFor("project.project");
console.log(
  `[attachments] DONE — task_attachments=${taskAttachments}, project_attachments=${projectAttachments}`,
);
process.exit(0);
