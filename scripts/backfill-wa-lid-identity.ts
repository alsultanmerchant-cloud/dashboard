// scripts/backfill-wa-lid-identity.ts
//
// Resolve opaque WhatsApp @lid sender identifiers on wa_messages to their real
// phone JIDs (966…@c.us) + display name, using the OpenWA gateway's per-contact
// endpoint (getContactById). WhatsApp now hands out @lid device identifiers for
// group participants; the gateway resolves them via the connected session's
// store, returning the real phone in `contact.id` (NOT `contact.number`, which
// echoes the lid for @lid contacts — a whatsapp-web.js quirk).
//
// Once sender_id holds a real phone, the satisfaction transcript tagger's
// byPhone match lights up and account-manager messages stop being read as
// client voice. See memory: project_wa_sender_identity_lid.
//
//   bun run scripts/backfill-wa-lid-identity.ts            # DRY RUN (no writes)
//   bun run scripts/backfill-wa-lid-identity.ts --apply    # resolve + update
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WA_API_URL,
// WA_API_KEY, WA_SESSION_ID from .env.local.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ORG_ID = "11111111-1111-1111-1111-111111111111"; // rawasm-demo (single tenant)

// ---- env ----------------------------------------------------------------
const env = readFileSync(join(import.meta.dir, "..", ".env.local"), "utf8")
  .split("\n")
  .reduce<Record<string, string>>((acc, line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) acc[m[1]] = m[2].replace(/^["']|["']$/g, "");
    return acc;
  }, {});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const WA_API_URL = (env.WA_API_URL ?? "").replace(/\/$/, "");
const WA_API_KEY = env.WA_API_KEY;
const WA_SESSION_ID = env.WA_SESSION_ID ?? "rawasm";

if (!SUPABASE_URL || !SUPABASE_KEY || !WA_API_URL || !WA_API_KEY) {
  console.error("Missing env (SUPABASE_URL/KEY, WA_API_URL/KEY). Aborting.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ---- gateway helpers ----------------------------------------------------
async function gw(path: string, timeoutMs = 30_000): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${WA_API_URL}${path}`, {
      headers: { "X-API-Key": WA_API_KEY },
      signal: ctrl.signal,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* non-json */
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: (e as Error).message } };
  } finally {
    clearTimeout(t);
  }
}

// Every CONNECTED session, most-recently-active first. A group's participants
// only resolve on a session that is actually a member, so we try each in turn.
async function readySessionUuids(): Promise<string[]> {
  const { ok, json } = await gw("/api/sessions", 15_000);
  if (!ok) throw new Error("cannot list sessions");
  const list: any[] = Array.isArray(json) ? json : (json?.data ?? json?.sessions ?? []);
  return list
    .filter((s) => isOwn(s.name) && String(s.status).toLowerCase() === "ready")
    .sort((a, b) => String(b.lastActive ?? "").localeCompare(String(a.lastActive ?? "")))
    .map((s) => s.id as string);
}

function isOwn(name: string | undefined): boolean {
  return !!name && (name === WA_SESSION_ID || name.startsWith(`${WA_SESSION_ID}-`));
}

interface Resolved {
  phoneJid: string | null; // 966…@c.us
  name: string | null;
}

// Resolve one @lid across the given sessions, first hit wins. The real phone is
// in contact.id (…@c.us); contact.number echoes the lid and must be ignored.
async function resolveLid(lid: string, sessionUuids: string[]): Promise<Resolved> {
  for (const uuid of sessionUuids) {
    const { ok, json } = await gw(`/api/sessions/${uuid}/contacts/${encodeURIComponent(lid)}`, 30_000);
    if (!ok) continue;
    const c = json?.data ?? json;
    const id: string | undefined = c?.id;
    const phoneJid = typeof id === "string" && /@(?:c\.us|s\.whatsapp\.net)$/i.test(id) ? id : null;
    const name = (c?.name || c?.pushName || c?.pushname || null) as string | null;
    if (phoneJid) return { phoneJid, name };
  }
  return { phoneJid: null, name: null };
}

// ---- collect distinct lids ---------------------------------------------
async function distinctLids(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("wa_messages")
      .select("sender_id")
      .eq("organization_id", ORG_ID)
      .like("sender_id", "%@lid")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const id = (r as { sender_id: string }).sender_id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }
  return counts;
}

// ---- concurrency helper -------------------------------------------------
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return out;
}

// ---- main ---------------------------------------------------------------
async function main() {
  console.log(`\n=== WA @lid → phone backfill  (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`);

  const sessions = await readySessionUuids();
  if (sessions.length === 0) {
    console.error("No CONNECTED sessions — cannot resolve. Restart a session first.");
    process.exit(1);
  }
  console.log(`Connected sessions: ${sessions.length}`);

  console.log("Collecting distinct @lid sender ids…");
  const lidCounts = await distinctLids();
  const lids = [...lidCounts.keys()];
  const totalRows = [...lidCounts.values()].reduce((a, b) => a + b, 0);
  console.log(`  distinct lids: ${lids.length}  (covering ${totalRows} message rows)\n`);

  console.log("Resolving via gateway (concurrency 3)…");
  let done = 0;
  const results = await pool(lids, 3, async (lid) => {
    const r = await resolveLid(lid, sessions);
    done++;
    if (done % 25 === 0 || done === lids.length) process.stdout.write(`  ${done}/${lids.length}\r`);
    return { lid, ...r };
  });
  console.log("");

  const resolved = results.filter((r) => r.phoneJid);
  const unresolved = results.filter((r) => !r.phoneJid);
  const resolvedRows = resolved.reduce((a, r) => a + (lidCounts.get(r.lid) ?? 0), 0);

  console.log(`\n  resolved:   ${resolved.length}/${lids.length} lids  (${resolvedRows}/${totalRows} rows)`);
  console.log(`  unresolved: ${unresolved.length} lids  (session not in group / privacy)\n`);
  console.log("  sample mappings:");
  for (const r of resolved.slice(0, 12)) {
    console.log(`    ${r.lid}  →  ${r.phoneJid}   ${r.name ?? ""}`);
  }

  // Audit trail / reversibility: dump every lid→phone mapping used.
  const dump = join(import.meta.dir, "..", "wa-lid-map.json");
  writeFileSync(dump, JSON.stringify(resolved, null, 2));
  console.log(`\n  mapping written to ${dump}`);

  if (!APPLY) {
    console.log(`\n(dry run — no writes. Re-run with --apply to update wa_messages.)\n`);
    return;
  }

  console.log(`\nApplying updates to wa_messages…`);
  let updated = 0;
  for (const r of resolved) {
    const patch: Record<string, unknown> = { sender_id: r.phoneJid };
    if (r.name) patch.sender = r.name;
    const { error, count } = await db
      .from("wa_messages")
      .update(patch, { count: "exact" })
      .eq("organization_id", ORG_ID)
      .eq("sender_id", r.lid);
    if (error) {
      console.error(`  ! ${r.lid}: ${error.message}`);
      continue;
    }
    updated += count ?? 0;
  }
  console.log(`\n  updated ${updated} message rows across ${resolved.length} identities.`);
  console.log(`\nDone. Next: re-run satisfaction tagging so byPhone attribution picks up the new phones.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
