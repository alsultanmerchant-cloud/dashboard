#!/usr/bin/env bun
// Recover the message gap left by a dead WhatsApp session. Live webhooks only
// deliver NEW messages, so everything sent while a number's store was broken is
// missing until its history is re-pulled. Drives backfillAccountHistory() the
// same way the "سحب السجل" button does — first pass with refresh (clears the
// per-(account,chat) completion marks so already-backfilled groups are re-read,
// which is the whole point after an outage), then resumes until remaining is 0.
//
//   bun --preload ./scripts/_preload-stub-server-only.ts scripts/backfill-wa-outage-gap.ts --session=rawasm [--apply]
//
// Dry-run by default (reports the gap only); --apply performs the backfill.
// Ingestion dedups on the bare message id, so re-pulling is additive and safe.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { backfillAccountHistory } from "@/lib/wa/backfill";
import { getDefaultOrgId } from "@/lib/wa/ingest";

const APPLY = process.argv.includes("--apply");
const SESSION =
  process.argv.find((a) => a.startsWith("--session="))?.slice("--session=".length) ?? "rawasm";
const MAX_RUNS = Number(
  process.argv.find((a) => a.startsWith("--max-runs="))?.slice("--max-runs=".length) ?? 12,
);
// Outage window: last message the primary delivered → session repaired today.
const GAP_START = process.env.GAP_START ?? "2026-07-22T09:21:04Z";

async function countInGap(orgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("sent_at", GAP_START);
  return count ?? 0;
}

const orgId = await getDefaultOrgId();
const before = await countInGap(orgId);
console.log(`session=${SESSION} gapStart=${GAP_START}`);
console.log(`messages currently stored since gap start: ${before}`);

if (!APPLY) {
  console.log("\nDRY RUN — re-run with --apply to pull the missing history.");
  process.exit(0);
}

let totalImported = 0;
let totalGroups = 0;
for (let run = 1; run <= MAX_RUNS; run++) {
  const t0 = Date.now();
  // Only the FIRST run refreshes; later runs resume the queue it created.
  const res = await backfillAccountHistory(orgId, SESSION, { refresh: run === 1 });
  if (res.error) {
    console.error(`run ${run}: ERROR ${res.error}`);
    break;
  }
  totalImported += res.imported ?? 0;
  totalGroups += res.groups ?? 0;
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    `run ${run}: groups=${res.groups ?? 0} imported=${res.imported ?? 0} remaining=${res.remaining ?? 0} (${secs}s)`,
  );
  if ((res.remaining ?? 0) === 0) break;
}

const after = await countInGap(orgId);
console.log(
  `\ndone: groups=${totalGroups} imported=${totalImported} | since gap start ${before} → ${after} (+${after - before})`,
);
