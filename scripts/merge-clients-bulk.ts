#!/usr/bin/env bun
/**
 * One-shot client centralization: fold each sheet-imported client into its
 * canonical Odoo twin, so contracts (on sheet rows) + projects (on Odoo rows)
 * + WhatsApp groups (split across both) all resolve to ONE client.
 *
 * Mirrors bulkMergeHighConfidenceAction EXACTLY (same matcher, same gates:
 * score >= min, unambiguous lead, Odoo target carries a project) so this CLI
 * does what the in-app "bulk merge" button promises — just runnable headless.
 *
 * Usage:
 *   bun run scripts/merge-clients-bulk.ts            # DRY RUN — prints the plan
 *   bun run scripts/merge-clients-bulk.ts --apply    # APPLY via merge_clients RPC
 *   bun run scripts/merge-clients-bulk.ts --min 0.9  # tighten threshold
 */

import { createClient } from "@supabase/supabase-js";
// Use the SAME matcher the merge UI uses (no inlined copy → no drift). It is a
// pure module with no server-only imports, safe to load from a script.
import { bestClientMatch } from "../src/lib/match/client-match";

// ── args ───────────────────────────────────────────────────────────────────
const apply = process.argv.includes("--apply");
const minArg = process.argv.indexOf("--min");
const min = minArg >= 0 ? Math.min(1, Math.max(0.7, Number(process.argv[minArg + 1]))) : 0.85;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(url, key);

type Row = {
  id: string; name: string; external_id: string | null; external_source: string | null;
  contracts: { count: number }[] | null;
  wa_group_links: { count: number }[] | null;
  projects: { count: number }[] | null;
};
type C = { id: string; name: string; external_id: string | null; contracts: number; groups: number; projects: number };

async function main() {
  const { data: org, error: orgErr } = await sb
    .from("organizations").select("id, slug").limit(1).maybeSingle();
  if (orgErr || !org) throw new Error("no organization row: " + orgErr?.message);
  const orgId = org.id as string;
  console.log(`org: ${org.slug} (${orgId})`);
  console.log(`mode: ${apply ? "APPLY" : "DRY RUN"}   min score: ${min}\n`);

  const { data, error } = await sb
    .from("clients")
    .select("id, name, external_id, external_source, contracts(count), wa_group_links!wa_group_links_client_id_fkey(count), projects(count)")
    .eq("organization_id", orgId)
    .is("merged_into_client_id", null)
    .in("external_source", ["excel-acc-sheet", "odoo"]);
  if (error) throw error;

  const map = (r: Row): C => ({
    id: r.id, name: r.name, external_id: r.external_id,
    contracts: r.contracts?.[0]?.count ?? 0,
    groups: r.wa_group_links?.[0]?.count ?? 0,
    projects: r.projects?.[0]?.count ?? 0,
  });
  const rows = (data ?? []) as unknown as Row[];
  const sheetClients = rows.filter((r) => r.external_source === "excel-acc-sheet").map(map);
  const odooClients = rows.filter((r) => r.external_source === "odoo").map(map);
  const odooById = new Map(odooClients.map((o) => [o.id, o]));
  console.log(`sheet clients: ${sheetClients.length}   odoo clients: ${odooClients.length}\n`);

  const plan: Array<{ source: string; target: string; from: string; to: string; score: number }> = [];
  let belowMin = 0, ambiguous = 0, noProject = 0;
  for (const s of sheetClients) {
    const { best, secondScore } = bestClientMatch(s, odooClients);
    if (!best || best.score < min) { belowMin++; continue; }
    const tgt = odooById.get(best.client.id);
    if (!tgt || tgt.projects <= 0) { noProject++; continue; }
    const unambiguous = best.score >= 0.95 || best.score - secondScore >= 0.05;
    if (!unambiguous) { ambiguous++; continue; }
    plan.push({ source: s.id, target: best.client.id, from: s.name, to: tgt.name, score: Math.round(best.score * 100) / 100 });
  }
  plan.sort((a, b) => b.score - a.score);

  console.log(`PLAN: ${plan.length} merges`);
  for (const p of plan) console.log(`  ${p.score.toFixed(2)}  ${p.from}  →  ${p.to}`);
  console.log(`\nskipped — below ${min}: ${belowMin}   ambiguous: ${ambiguous}   target has no project: ${noProject}`);
  const leftover = sheetClients.length - plan.length;
  console.log(`sheet clients NOT auto-merged (need manual review): ${leftover}\n`);

  if (!apply) {
    console.log("dry run — nothing changed. re-run with --apply to execute.");
    return;
  }

  let merged = 0;
  const moved: Record<string, number> = {};
  for (const p of plan) {
    const { data: res, error: err } = await sb.rpc("merge_clients", {
      p_source: p.source, p_target: p.target, p_org: orgId,
    });
    if (err) { console.log(`  SKIP ${p.from}: ${err.message}`); continue; }
    merged++;
    const m = (res as { moved?: Record<string, number> })?.moved ?? {};
    for (const [k, v] of Object.entries(m)) moved[k] = (moved[k] ?? 0) + (v as number);
  }
  // Traceability: the in-app action writes audit_logs; mirror that here so a
  // headless run is just as auditable. entity_id must be a uuid → use orgId.
  if (merged > 0) {
    const { error: aerr } = await sb.from("audit_logs").insert({
      organization_id: orgId,
      actor_user_id: null,
      action: "client.bulk_merge",
      entity_type: "client",
      entity_id: orgId,
      metadata: { via: "scripts/merge-clients-bulk.ts", min_score: min, merged, moved },
    });
    if (aerr) console.log("  (audit write failed:", aerr.message + ")");
  }

  console.log(`\nDONE. merged ${merged}/${plan.length}. moved refs:`, moved);
}

main().catch((e) => { console.error(e); process.exit(1); });
