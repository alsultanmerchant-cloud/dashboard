#!/usr/bin/env bun
// One-shot verification of the accountability-aware satisfaction pipeline.
//   bun scripts/test-satisfaction-accountability.ts <clientId> [--ai]
// Without --ai: only exercises the data layer (getClientTeamActivitySnapshot +
// renderTeamActivityBlock) — free, no model call. With --ai: runs the full
// analyzeClientSatisfaction (real Gemini call) and verifies the persisted
// accountability output cites only roster-valid names/task codes.

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getClientTeamActivitySnapshot,
  renderTeamActivityBlock,
} from "@/lib/data/satisfaction-team";
import { analyzeClientSatisfaction } from "@/lib/satisfaction-analyze";

const clientId = process.argv[2];
const runAi = process.argv.includes("--ai");
if (!clientId) {
  console.error("usage: bun scripts/test-satisfaction-accountability.ts <clientId> [--ai]");
  process.exit(1);
}

const { data: client } = await supabaseAdmin
  .from("clients")
  .select("organization_id, name")
  .eq("id", clientId)
  .single();
if (!client) {
  console.error("client not found");
  process.exit(1);
}
const orgId = client.organization_id as string;
console.log(`\n=== ${client.name} (${clientId}) ===\n`);

const snap = await getClientTeamActivitySnapshot(orgId, clientId);
console.log("accountManager:", snap.accountManager);
console.log("services:", snap.services.map((s) => `${s.service}(${s.totalOpen}/${s.overdue})`).join(", "));
console.log("stuckTasks:", snap.stuckTasks.length, "people:", snap.people.length);
console.log("gaps:");
for (const g of snap.gaps) console.log("  -", g);
console.log("\n--- rendered block fed to the model ---");
console.log(renderTeamActivityBlock(snap));

// The roster the model is allowed to cite.
const rosterNames = new Set<string>();
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
for (const p of snap.people) rosterNames.add(norm(p.name));
if (snap.accountManager) rosterNames.add(norm(snap.accountManager));
for (const t of snap.stuckTasks)
  for (const n of [t.executor, t.accountManager, t.stageOwner])
    if (n) for (const part of n.split(",")) if (part.trim()) rosterNames.add(norm(part));
const rosterCodes = new Set(snap.stuckTasks.map((t) => t.taskCode).filter(Boolean) as string[]);

if (!runAi) {
  console.log("\n(skipped AI — pass --ai to run the full analysis)");
  process.exit(0);
}

console.log("\n=== running full AI analysis (real model call) … ===");
const { result } = await analyzeClientSatisfaction(orgId, clientId, null, { windowKind: "week" });
console.log(`\naccountability rows: ${result.accountability.length}`);
let leaks = 0;
for (const row of result.accountability) {
  console.log(`\n• complaint: ${row.complaint}`);
  console.log(`  service: ${row.service ?? "—"} | confidence: ${row.confidence}`);
  console.log(`  finding: ${row.finding}`);
  console.log(
    `  responsible: ${row.responsible.map((r) => `${r.name}[${r.basis}]`).join(", ") || "—"}`,
  );
  console.log(`  tasks: ${row.taskCodes.join(", ") || "—"}`);
  for (const r of row.responsible)
    if (!rosterNames.has(norm(r.name))) {
      console.log(`  ⚠️ LEAK: name not in roster → ${r.name}`);
      leaks++;
    }
  for (const c of row.taskCodes)
    if (!rosterCodes.has(c)) {
      console.log(`  ⚠️ LEAK: task code not in roster → ${c}`);
      leaks++;
    }
}
console.log(`\nownerName on causes: ${result.causes.map((c) => c.ownerName).filter(Boolean).join(", ") || "—"}`);

// Confirm persistence wrote the two new columns.
const { data: persisted } = await supabaseAdmin
  .from("client_satisfaction_analyses")
  .select("created_at, team_context, accountability")
  .eq("client_id", clientId)
  .eq("is_current", true)
  .single();
console.log(
  `\npersisted: team_context=${persisted?.team_context ? "yes" : "NO"} accountability=${
    Array.isArray(persisted?.accountability) ? persisted.accountability.length + " rows" : "NO"
  }`,
);
console.log(leaks === 0 ? "\n✅ ROSTER GUARDRAIL HELD — no invented names/codes" : `\n❌ ${leaks} LEAKS`);
process.exit(0);
