#!/usr/bin/env bun
// Bulk re-analyze every client with WhatsApp activity in the window, applying
// the link-graph transcript resolver. Reads already-ingested messages (no
// gateway dependency). Writes is_current per client. Concurrency-limited.
//   bun --conditions=react-server run scripts/probe/bulk-reanalyze.ts [days] [concurrency]
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId } from "@/lib/wa/ingest";
import {
  analyzeClientSatisfaction,
  NoTranscriptError,
  NoRecentActivityError,
} from "@/lib/satisfaction-analyze";

const concurrency = Number(process.argv[2] ?? 4);
const orgId = await getDefaultOrgId();

// Every mapped client with an active linked group. The analyzer widens its
// window per client (7d → 30 → 90 → 180 → all), so clients that didn't chat in
// the last week still get a fresh read; ones with no messages at all skip
// cheaply (NoTranscript, before any model call).
const { data: rows } = await supabaseAdmin
  .from("wa_group_links")
  .select("client_id")
  .eq("organization_id", orgId)
  .eq("is_active", true)
  .not("client_id", "is", null)
  .limit(5000);
const ids = [...new Set((rows ?? []).map((r) => r.client_id as string))];

const { data: clients } = await supabaseAdmin
  .from("clients").select("id, name").in("id", ids);
const nameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

console.log(`Re-analyzing ${ids.length} clients (window auto-widens per client, concurrency ${concurrency})…\n`);

let ok = 0, skipped = 0, failed = 0, cursor = 0;
const summary: string[] = [];
async function worker(w: number) {
  while (cursor < ids.length) {
    const i = cursor++;
    const id = ids[i];
    const name = nameById.get(id) ?? id.slice(0, 8);
    try {
      const { result } = await analyzeClientSatisfaction(orgId, id, null, { windowKind: "week" });
      ok++;
      const line = `✓ ${name}: sat=${result.satisfactionScore} brief=${result.briefAdherenceScore ?? "—"} health=${result.bigPicture.accountHealth}`;
      summary.push(line);
      console.log(`[${i + 1}/${ids.length}] ${line}`);
    } catch (e) {
      if (e instanceof NoRecentActivityError || e instanceof NoTranscriptError) {
        skipped++;
        console.log(`[${i + 1}/${ids.length}] ⊘ ${name}: ${(e as Error).message}`);
      } else {
        failed++;
        console.log(`[${i + 1}/${ids.length}] ✗ ${name}: ${(e as Error).message}`);
      }
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, (_, w) => worker(w)));

console.log(`\n=== DONE: ${ok} analyzed, ${skipped} skipped (no recent activity), ${failed} failed ===`);
process.exit(0);
