#!/usr/bin/env bun
// Batch re-analyze client satisfaction with the accountability-aware pipeline.
//   bun --preload ./scripts/_preload-stub-server-only.ts scripts/batch-analyze-satisfaction.ts [--all] [--concurrency N]
// Default: only ACTIVE clients whose current analysis predates migration 0238
// (no team_context yet). --all re-analyzes every active client. Concurrency-
// limited (default 4) to stay under model rate limits; continues on per-client
// failure and prints a summary. Non-destructive: each run inserts a new current
// analysis (the previous one is flipped to is_current=false, not deleted).

import { supabaseAdmin } from "@/lib/supabase/admin";
import { analyzeClientSatisfaction } from "@/lib/satisfaction-analyze";
import { getActiveProjectClientIds } from "@/lib/data/satisfaction";

const ORG =
  process.env.RAWASM_ORG_ID || "11111111-1111-1111-1111-111111111111";
const all = process.argv.includes("--all");
const cIdx = process.argv.indexOf("--concurrency");
const CONCURRENCY = cIdx >= 0 ? Math.max(1, Number(process.argv[cIdx + 1]) || 4) : 4;

const activeIds = await getActiveProjectClientIds(ORG);

// Which of the active clients already carry a team-aware (post-0238) analysis.
const { data: teamAware } = await supabaseAdmin
  .from("client_satisfaction_analyses")
  .select("client_id")
  .eq("organization_id", ORG)
  .eq("is_current", true)
  .not("team_context", "is", null);
const done = new Set((teamAware ?? []).map((r) => r.client_id as string));

const targets = [...activeIds].filter((id) => all || !done.has(id));

// Resolve display names for the log.
const { data: nameRows } = await supabaseAdmin
  .from("clients")
  .select("id, name")
  .in("id", targets.length ? targets : ["00000000-0000-0000-0000-000000000000"]);
const nameById = new Map((nameRows ?? []).map((r) => [r.id as string, r.name as string]));

console.log(
  `batch: ${targets.length} client(s) to analyze (active=${activeIds.size}, already team-aware=${done.size}), concurrency=${CONCURRENCY}\n`,
);

let ok = 0;
let fail = 0;
let acctRows = 0;
const failures: Array<{ id: string; name: string; error: string }> = [];

// Simple concurrency pool.
let cursor = 0;
async function worker(w: number) {
  while (cursor < targets.length) {
    const i = cursor++;
    const id = targets[i];
    const name = nameById.get(id) ?? id;
    const t0 = Date.now();
    try {
      const { result } = await analyzeClientSatisfaction(ORG, id, null, { windowKind: "week" });
      acctRows += result.accountability.length;
      ok++;
      console.log(
        `[${i + 1}/${targets.length}] ✅ ${name} — score ${result.satisfactionScore}, ${result.accountability.length} accountability row(s) (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    } catch (e) {
      fail++;
      const msg = (e as Error).message ?? String(e);
      failures.push({ id, name, error: msg });
      console.log(`[${i + 1}/${targets.length}] ❌ ${name} — ${msg}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, (_, w) => worker(w)));

console.log(`\n=== done: ${ok} ok, ${fail} failed, ${acctRows} total accountability rows ===`);
if (failures.length) {
  console.log("failures:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
}
process.exit(0);
