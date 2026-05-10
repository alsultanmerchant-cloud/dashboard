// One-off backfill: ensures every Odoo chatter attachment on an imported
// project.task has a matching task_attachments row in Supabase, with the
// task_comment_id link properly set so the row surfaces in the activity feed.
//
// The dashboard's existing importer (src/lib/odoo/importer.ts) only inserts
// task_attachments when it can resolve the parent comment in the same chunk;
// any earlier import that failed that check (or an older importer version)
// left rows with task_comment_id = NULL. The activity feed query then hides
// them via `.not("task_comment_id", "is", null)`. Audit found 1,049 orphans
// out of 1,214 mirrored attachments (~86%) plus ~5,400 attachment refs in
// Odoo that never made it into Supabase at all.
//
// Usage:
//   bun run scripts/backfill-odoo-attachments.ts            # report only
//   bun run scripts/backfill-odoo-attachments.ts --apply    # do the writes
//
// Idempotent: upserts on (organization_id, external_source, external_id).

import { OdooClient } from "../src/lib/odoo/client";
import { supabaseAdmin } from "../src/lib/supabase/admin";

const SOURCE = "odoo" as const;
const APPLY = process.argv.includes("--apply");

type OdooMessage = {
  id: number;
  res_id: number;
  attachment_ids: number[] | false;
  subtype_id: [number, string] | false;
};

type OdooAttachment = {
  id: number;
  name: string | false;
  mimetype: string | false;
  file_size: number | false;
  url: string | false;
};

async function main() {
  const odoo = new OdooClient({
    url: process.env.ODOO_URL!,
    db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME!,
    password: process.env.ODOO_PASSWORD!,
  });
  await odoo.authenticate();
  const odooBase = process.env.ODOO_URL?.replace(/\/+$/, "") ?? "";

  // 1. Build {odoo_task_id → supabase_task_uuid, organization_id} for all
  //    imported tasks. Page past the 1k default.
  const taskByOdooId = new Map<number, { id: string; orgId: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id, external_id, organization_id")
      .eq("external_source", SOURCE)
      .not("external_id", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const n = Number(r.external_id);
      if (Number.isFinite(n)) {
        taskByOdooId.set(n, { id: r.id as string, orgId: r.organization_id as string });
      }
    }
    if (data.length < 1000) break;
  }
  console.log(`Imported tasks: ${taskByOdooId.size}`);

  // 2. Build {odoo_msg_id → supabase_comment_uuid} for comments we already
  //    have. Page past the 1k default — we have ~12k of these.
  const commentByOdooMsgId = new Map<number, { id: string; taskId: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("task_comments")
      .select("id, task_id, external_id")
      .eq("external_source", SOURCE)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const n = Number(r.external_id);
      if (Number.isFinite(n)) {
        commentByOdooMsgId.set(n, { id: r.id as string, taskId: r.task_id as string });
      }
    }
    if (data.length < 1000) break;
  }
  console.log(`Imported comments: ${commentByOdooMsgId.size}`);

  // 3. Walk Odoo chatter messages with attachments, but only those tied to
  //    imported tasks. Process in chunks to keep the IN clause sane.
  const importedIds = Array.from(taskByOdooId.keys());
  const TASK_CHUNK = 500;
  const PAGE = 2000;

  let totalMessages = 0;
  let messagesMissingComment = 0;
  let totalAttachmentsExpected = 0;
  let totalUpserts = 0;
  let upsertErrors = 0;

  for (let i = 0; i < importedIds.length; i += TASK_CHUNK) {
    const slice = importedIds.slice(i, i + TASK_CHUNK);
    let offset = 0;
    for (;;) {
      const messages = await odoo.executeKw<OdooMessage[]>(
        "mail.message",
        "search_read",
        [
          [
            ["model", "=", "project.task"],
            ["res_id", "in", slice],
            ["attachment_ids", "!=", false],
          ],
          ["id", "res_id", "attachment_ids", "subtype_id"],
        ],
        { limit: PAGE, offset, order: "id asc" },
      );
      if (messages.length === 0) break;

      // Collect all attachment ids in this batch and fetch their metadata.
      const attIds = Array.from(
        new Set(
          messages.flatMap((m) =>
            Array.isArray(m.attachment_ids) ? m.attachment_ids : [],
          ),
        ),
      );
      const attMeta = new Map<number, OdooAttachment>();
      for (let j = 0; j < attIds.length; j += 500) {
        const idsSlice = attIds.slice(j, j + 500);
        const rows = await odoo.executeKw<OdooAttachment[]>(
          "ir.attachment",
          "search_read",
          [[["id", "in", idsSlice]], ["id", "name", "mimetype", "file_size", "url"]],
        );
        for (const a of rows) attMeta.set(a.id, a);
      }

      // For each message + attachment, upsert into task_attachments.
      const rowsToUpsert: Array<{
        organization_id: string;
        task_id: string;
        task_comment_id: string;
        filename: string;
        mimetype: string | null;
        size_bytes: number | null;
        storage_path: null;
        source_url: string;
        external_source: typeof SOURCE;
        external_id: string;
      }> = [];

      for (const m of messages) {
        totalMessages += 1;
        const taskInfo = taskByOdooId.get(m.res_id);
        if (!taskInfo) continue; // shouldn't happen — we filtered res_id in
        const comment = commentByOdooMsgId.get(m.id);
        if (!comment) {
          messagesMissingComment += 1;
          continue;
        }
        const ids = Array.isArray(m.attachment_ids) ? m.attachment_ids : [];
        for (const aid of ids) {
          totalAttachmentsExpected += 1;
          const meta = attMeta.get(aid);
          if (!meta) continue; // attachment row was deleted in Odoo
          const filename =
            typeof meta.name === "string" && meta.name ? meta.name : `attachment-${aid}`;
          const mimetype =
            typeof meta.mimetype === "string" ? meta.mimetype : null;
          const size = typeof meta.file_size === "number" ? meta.file_size : null;
          const explicitUrl =
            typeof meta.url === "string" && meta.url ? meta.url : null;
          const sourceUrl = explicitUrl
            ? explicitUrl
            : odooBase
              ? `${odooBase}/web/content/${aid}?download=true`
              : "";
          if (!sourceUrl) continue;
          rowsToUpsert.push({
            organization_id: taskInfo.orgId,
            task_id: taskInfo.id,
            task_comment_id: comment.id,
            filename,
            mimetype,
            size_bytes: size,
            storage_path: null,
            source_url: sourceUrl,
            external_source: SOURCE,
            external_id: String(aid),
          });
        }
      }

      if (rowsToUpsert.length > 0) {
        if (APPLY) {
          // Upsert in chunks of 500 to keep payloads manageable.
          const UPSERT_CHUNK = 500;
          for (let k = 0; k < rowsToUpsert.length; k += UPSERT_CHUNK) {
            const chunk = rowsToUpsert.slice(k, k + UPSERT_CHUNK);
            const { error } = await supabaseAdmin
              .from("task_attachments")
              .upsert(chunk, {
                onConflict: "organization_id,external_source,external_id",
              });
            if (error) {
              upsertErrors += 1;
              console.warn(`  upsert failed @${k}: ${error.message}`);
            } else {
              totalUpserts += chunk.length;
            }
          }
        } else {
          totalUpserts += rowsToUpsert.length;
        }
      }

      offset += messages.length;
      if (messages.length < PAGE) break;
    }
    process.stdout.write(
      `  scanned ${Math.min(i + TASK_CHUNK, importedIds.length)}/${importedIds.length} tasks…\r`,
    );
  }
  process.stdout.write("\n");

  console.log(`\n=== Result (${APPLY ? "APPLIED" : "DRY RUN"}) ===`);
  console.log(`  messages with attachments scanned: ${totalMessages}`);
  console.log(`  …of which lacked a task_comment row: ${messagesMissingComment}`);
  console.log(`  attachment refs expected: ${totalAttachmentsExpected}`);
  console.log(`  rows ${APPLY ? "upserted" : "would upsert"}: ${totalUpserts}`);
  if (APPLY) console.log(`  upsert errors: ${upsertErrors}`);

  // 4. Final cross-check of the destination state.
  const { count: total } = await supabaseAdmin
    .from("task_attachments")
    .select("*", { count: "exact", head: true })
    .eq("external_source", SOURCE);
  const { count: orphans } = await supabaseAdmin
    .from("task_attachments")
    .select("*", { count: "exact", head: true })
    .eq("external_source", SOURCE)
    .is("task_comment_id", null);
  console.log(`\n=== task_attachments (post-state) ===`);
  console.log(`  total from odoo: ${total}`);
  console.log(`  orphans (task_comment_id null): ${orphans}`);

  if (messagesMissingComment > 0) {
    console.log(
      `\nNOTE: ${messagesMissingComment} chatter messages with attachments are` +
      ` not yet imported as task_comments. Run \`bun run sync:odoo\` first` +
      ` to bring those in, then re-run this script to backfill their attachments.`,
    );
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
