#!/usr/bin/env bun
// Probe: for a client, (1) member-aware backfill its groups, (2) print the
// transcript the analyzer builds, (3) print the assembled Gemini prompt's
// section presence, (4) re-analyze and print which sources drove the result —
// to answer: does the analysis CONNECT the group chat with project+contract, or
// only use projects/tasks data? Run:
//   bun --conditions=react-server run scripts/probe/satisfaction-sources.ts <clientId> [--analyze]
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDefaultOrgId, ingestWaMessages, type NormalMessage } from "@/lib/wa/ingest";
import { fetchChatHistoryViaSessions, isOwnSession } from "@/lib/wa/openwa-client";
import { buildClientTranscripts } from "@/lib/data/satisfaction";
import { buildSatisfactionInput, analyzeClientSatisfaction } from "@/lib/satisfaction-analyze";

const clientId = process.argv[2] ?? "6a123345-6459-4d92-845f-48de87991e2f";
const doAnalyze = process.argv.includes("--analyze");
const doBackfill = process.argv.includes("--backfill"); // slow (gateway); off by default
const orgId = await getDefaultOrgId();

const { data: client } = await supabaseAdmin
  .from("clients").select("name").eq("id", clientId).maybeSingle();
console.log(`\n=== CLIENT: ${client?.name ?? "?"} (${clientId}) ===`);

// ---- (1) Member-aware backfill of the client's groups (our sessions only) ----
const { data: projs } = await supabaseAdmin
  .from("projects").select("id").eq("organization_id", orgId).eq("client_id", clientId);
const projectIds = (projs ?? []).map((p) => p.id as string);
const [direct, m2m] = await Promise.all([
  supabaseAdmin.from("wa_group_links").select("chat_id, chat_name, group_kind")
    .eq("organization_id", orgId).eq("client_id", clientId),
  projectIds.length
    ? supabaseAdmin.from("wa_group_projects").select("wa_group_links(chat_id, chat_name, group_kind)")
        .eq("organization_id", orgId).in("project_id", projectIds)
    : Promise.resolve({ data: [] as Array<{ wa_group_links: { chat_id: string; chat_name: string | null; group_kind: string | null } | null }> }),
]);
const chats = new Map<string, { name: string | null; kind: string | null }>();
for (const r of (direct.data ?? []) as Array<{ chat_id: string; chat_name: string | null; group_kind: string | null }>)
  chats.set(r.chat_id, { name: r.chat_name, kind: r.group_kind });
for (const r of (m2m.data ?? []) as Array<{ wa_group_links: { chat_id: string; chat_name: string | null; group_kind: string | null } | null }>)
  if (r.wa_group_links) chats.set(r.wa_group_links.chat_id, { name: r.wa_group_links.chat_name, kind: r.wa_group_links.group_kind });

console.log(`\n--- (1) GROUPS resolved for this client (link graph) ---`);
for (const [chatId, meta] of chats) console.log(`  • ${meta.name} [${meta.kind}] ${chatId}`);
if (doBackfill) {
  const { data: accts } = await supabaseAdmin
    .from("wa_accounts").select("session_id, last_seen_at").eq("organization_id", orgId).eq("is_active", true)
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  const sessionNames = (accts ?? []).map((a) => a.session_id as string).filter(isOwnSession);
  console.log(`  BACKFILL via our numbers ${JSON.stringify(sessionNames)} (slow)…`);
  for (const [chatId, meta] of chats) {
    const hit = await fetchChatHistoryViaSessions(chatId, sessionNames, 1000);
    if (!hit) { console.log(`    ✗ ${meta.name}: no enrolled number is a member`); continue; }
    const msgs: NormalMessage[] = hit.messages.filter((m) => m.body?.trim()).map((m) => ({
      chatId, chatName: meta.name, waMessageId: m.id, waRawId: m.id ?? null,
      sender: null, senderId: m.from, body: m.body, messageType: m.type,
      isFromMe: m.fromMe, sentAt: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : null,
    }));
    const res = await ingestWaMessages(msgs, hit.sessionName);
    console.log(`    • ${meta.name} [${meta.kind}]: via ${hit.sessionName} fetched ${msgs.length}, NEW ${res.ingested}`);
  }
}

// ---- (2) The transcript the analyzer builds (the actual group-chat input) ----
const tAll = await buildClientTranscripts(orgId, clientId);
const tWeek = await buildClientTranscripts(orgId, clientId, { sinceDays: 7 });
const head = (s: string, n = 350) => (s ? s.slice(0, n).replace(/\n/g, " | ") : "(EMPTY)");
console.log(`\n--- (2) TRANSCRIPT (group chat fed to the model) ---`);
console.log(`ALL-history:  client msgs=${tAll.clientMessages}  technical msgs=${tAll.technicalMessages}`);
console.log(`  client 💫 sample: ${head(tAll.client)}`);
console.log(`  technical 📍 sample: ${head(tAll.technical)}`);
console.log(`LAST-7-DAYS:  client msgs=${tWeek.clientMessages}  technical msgs=${tWeek.technicalMessages}`);

// ---- (3) The assembled prompt: are all four sources present & populated? ----
const input = await buildSatisfactionInput(orgId, clientId, { windowKind: "week" });
const prompt = input.makePrompt(45_000);
const marker = (label: string, m: string) => {
  const i = prompt.indexOf(m);
  if (i < 0) { console.log(`  [${label}] MARKER NOT FOUND`); return; }
  const after = prompt.slice(i + m.length, i + m.length + 90).replace(/\n/g, " ").trim();
  console.log(`  [${label}] present — next: "${after.slice(0, 80)}"`);
};
console.log(`\n--- (3) GEMINI PROMPT sources (length ${prompt.length} chars) ---`);
marker("CLIENT GROUP 💫", "=== مجموعة العميل");
marker("TECH GROUP 📍", "=== مجموعة الفريق التقني");
marker("TASKS/PROJECT", "=== التاسكات والمشروع");
marker("CONTRACT", "=== حالة العقد");
marker("BRIEF", "=== البريف");

// ---- (4) Re-analyze and show group-derived signals ----
if (doAnalyze) {
  console.log(`\n--- (4) RE-ANALYZE (writes is_current) ---`);
  const { analysisId, result } = await analyzeClientSatisfaction(orgId, clientId, null, { windowKind: "week" });
  console.log(`analysisId=${analysisId}`);
  console.log(`summary: ${result.summary}`);
  console.log(`satisfaction=${result.satisfactionScore} brief=${result.briefAdherenceScore} health=${result.bigPicture.accountHealth}`);
  console.log(`clientGroupSignals.requests=${JSON.stringify(result.clientGroupSignals.requests)}`);
  console.log(`technicalGroupSignals.blockers=${JSON.stringify(result.technicalGroupSignals.blockers.slice(0, 3))}`);
  console.log(`indicators by source: ${JSON.stringify(result.indicators.map((i) => `${i.code}:${i.source}`))}`);
} else {
  console.log(`\n(pass --analyze to also run the model and write a new analysis)`);
}
process.exit(0);
