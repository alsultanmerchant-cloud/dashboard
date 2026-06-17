#!/usr/bin/env bun
// Backfill contracts.account_manager_id from the free-text account_manager_name
// using the SAME matcher the sheet sync now uses (commit-contract-import.ts), so
// the one-time fix and ongoing syncs agree. Only fills rows where the FK is NULL
// — never overwrites a manually-assigned manager. Pass --commit to write.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normName, diceRatio } from "@/lib/match/client-match";

const slug = process.argv[2]?.startsWith("--") ? "rawasm-demo" : (process.argv[2] || "rawasm-demo");
const commit = process.argv.includes("--commit");

const { data: org } = await supabaseAdmin
  .from("organizations").select("id").eq("slug", slug).single();
if (!org) { console.error("org not found"); process.exit(1); }
const orgId = org.id as string;

const { data: emps } = await supabaseAdmin
  .from("employee_profiles").select("id, full_name").eq("organization_id", orgId);
const byName = new Map<string, string>();
const list: { id: string; norm: string }[] = [];
for (const e of emps ?? []) {
  const k = normName(String(e.full_name ?? ""));
  if (!k) continue;
  if (!byName.has(k)) byName.set(k, e.id);
  list.push({ id: e.id, norm: k });
}

function resolve(name: string | null): string | null {
  if (!name) return null;
  const k = normName(name);
  if (!k) return null;
  const exact = byName.get(k);
  if (exact) return exact;
  let best: { id: string; score: number } | null = null;
  let second = 0;
  for (const e of list) {
    const score = diceRatio(k, e.norm);
    if (!best || score > best.score) { second = best?.score ?? 0; best = { id: e.id, score }; }
    else if (score > second) second = score;
  }
  return best && best.score >= 0.85 && best.score - second >= 0.1 ? best.id : null;
}

const { data: contracts } = await supabaseAdmin
  .from("contracts")
  .select("id, account_manager_name, client:clients(name)")
  .eq("organization_id", orgId)
  .is("account_manager_id", null)
  .not("account_manager_name", "is", null);

let matched = 0;
const unmatched: string[] = [];
for (const c of (contracts ?? []) as unknown as { id: string; account_manager_name: string | null; client: { name: string | null } | null }[]) {
  const id = resolve(c.account_manager_name);
  if (!id) { unmatched.push(`${c.client?.name ?? "?"} → ${c.account_manager_name}`); continue; }
  matched++;
  if (commit) {
    const { error } = await supabaseAdmin
      .from("contracts").update({ account_manager_id: id }).eq("id", c.id);
    if (error) console.error(`contract ${c.id}: ${error.message}`);
  } else {
    console.log(`would link: ${c.client?.name ?? "?"} → ${c.account_manager_name}`);
  }
}

console.log(`\n[am-backfill] candidates=${contracts?.length ?? 0} matched=${matched} unmatched=${unmatched.length} commit=${commit}`);
if (unmatched.length) console.log(`unmatched:\n  ${unmatched.join("\n  ")}`);
