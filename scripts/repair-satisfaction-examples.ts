#!/usr/bin/env bun
// Repair CURRENT satisfaction analyses that have request/approval COUNTS but
// empty example arrays — the state that makes the /satisfaction chips
// non-clickable (no drill-down). Re-extracts the quotes from the client
// transcript with a focused AI pass and updates client_group_signals IN PLACE
// (scores, accountability, everything else untouched). Idempotent: already-
// complete analyses are skipped. See memory: the SignalCountBadge drill-down.
//
//   bun --preload ./scripts/_preload-stub-server-only.ts scripts/repair-satisfaction-examples.ts [--apply]
//
// Dry-run by default (reports what it would fill); --apply writes.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildClientTranscripts } from "@/lib/data/satisfaction";
import { fillMissingSignalExamples } from "@/lib/satisfaction-analyze";

const ORG = process.env.RAWASM_ORG_ID || "11111111-1111-1111-1111-111111111111";
const APPLY = process.argv.includes("--apply");

const REQ = ["new", "edit", "complaint", "inquiry", "approval"] as const;
const APPR = ["approved", "rejected", "changesRequested", "noResponse"] as const;

function isBroken(cg: any): boolean {
  if (!cg) return false;
  const mr = REQ.some(
    (k) => (cg.requests?.[k] ?? 0) > 0 && (cg.requestExamples?.[k]?.length ?? 0) === 0,
  );
  const ma = APPR.some(
    (k) => (cg.approvals?.[k] ?? 0) > 0 && (cg.approvalExamples?.[k]?.length ?? 0) === 0,
  );
  return mr || ma;
}

const { data: rows, error } = await supabaseAdmin
  .from("client_satisfaction_analyses")
  .select("id, client_id, client_group_signals")
  .eq("organization_id", ORG)
  .eq("is_current", true);
if (error) throw error;

const broken = (rows ?? []).filter((r) => isBroken(r.client_group_signals));
console.log(`\n=== Repair satisfaction examples (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
console.log(`current analyses: ${rows?.length ?? 0} · broken: ${broken.length}\n`);

// Resolve names for the log.
const ids = [...new Set(broken.map((b) => b.client_id as string))];
const { data: names } = await supabaseAdmin
  .from("clients")
  .select("id, name")
  .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
const nameById = new Map((names ?? []).map((n) => [n.id as string, n.name as string]));

let fixed = 0;
for (const row of broken) {
  const clientId = row.client_id as string;
  const label = nameById.get(clientId) ?? clientId;
  try {
    const transcripts = await buildClientTranscripts(ORG, clientId);
    const clientTranscript = transcripts.client || "";
    const cg = row.client_group_signals as any;
    const filled = await fillMissingSignalExamples(cg, clientTranscript);
    if (!filled) {
      console.log(`  · ${label}: no examples recovered (transcript thin) — skipped`);
      continue;
    }
    const reqCount = REQ.reduce((a, k) => a + (cg.requestExamples?.[k]?.length ?? 0), 0);
    const aprCount = APPR.reduce((a, k) => a + (cg.approvalExamples?.[k]?.length ?? 0), 0);
    if (APPLY) {
      const { error: uErr } = await supabaseAdmin
        .from("client_satisfaction_analyses")
        .update({ client_group_signals: cg })
        .eq("id", row.id);
      if (uErr) {
        console.log(`  ✗ ${label}: update failed — ${uErr.message}`);
        continue;
      }
    }
    fixed++;
    console.log(`  ✓ ${label}: filled ${reqCount} request + ${aprCount} approval examples`);
  } catch (e) {
    console.log(`  ✗ ${label}: ${(e as Error).message}`);
  }
}

console.log(
  `\n${APPLY ? "Updated" : "Would update"} ${fixed}/${broken.length} analyses.` +
    (APPLY ? "" : "  Re-run with --apply to write.") +
    "\n",
);
