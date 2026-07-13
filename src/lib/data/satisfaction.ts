import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SatisfactionResult } from "@/lib/satisfaction-schema";
import type { ClientTeamActivitySnapshot, StuckTask } from "@/lib/data/satisfaction-team";
import { getClientBriefRef, type ClientBriefRef } from "@/lib/satisfaction-brief";
import { getKnowledgeStamp, isStaleAgainstKnowledge } from "@/lib/data/ai-knowledge";
import { getClientDisplayNameMap } from "@/lib/data/clients";
import { isClientRelationshipActive } from "@/lib/data/satisfaction-rules";
import { getClientMergeMap, resolveClientProjectIds } from "@/lib/data/satisfaction-identity";

// Re-export identity helpers so existing importers of these from this module
// (and its many consumers) keep resolving without churn.
export { getClientMergeMap, resolveClientProjectIds };

// =========================================================================
// Client-satisfaction data layer (/satisfaction + Quality executive index).
// Sources: client_chat_imports (parsed WhatsApp transcripts) and
// client_satisfaction_analyses (AI output, latest per client = is_current).
// =========================================================================

export type GroupKind = "client" | "technical";

export interface ImportInfo {
  id: string;
  groupKind: GroupKind;
  sourceFilename: string | null;
  messageCount: number;
  participantCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export type WindowKind = "week" | "all";

export interface AnalysisInfo extends SatisfactionResult {
  id: string;
  model: string | null;
  createdAt: string;
  windowKind: WindowKind;
  windowStart: string | null;
  windowEnd: string | null;
  // WhatsApp freshness captured when this analysis ran. `hadNewMessages` is
  // null only for legacy/first-run snapshots that had no earlier watermark.
  sourceLatestMessageAt: string | null;
  hadNewMessages: boolean | null;
  // The contract snapshot fed to the model when the analysis ran (UI shows the
  // pill; the model used it for the commercial dimension of the big picture).
  contractContext: ClientContractContext | null;
  // The accountability roster (people + stuck tasks + gaps) frozen at run time.
  // The UI renders the team strip from this so history stays truthful. Null for
  // analyses stored before migration 0238 or clients with no open tasks.
  teamContext: ClientTeamActivitySnapshot | null;
}

// One row in the per-client analysis history list (stored past snapshots).
export interface AnalysisHistoryItem {
  id: string;
  windowKind: WindowKind;
  satisfactionScore: number | null;
  sentiment: string | null;
  createdAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  isCurrent: boolean;
}

export interface SatisfactionRow {
  clientId: string;
  clientName: string;
  hasClient: boolean;
  hasTechnical: boolean;
  hasMessages: boolean; // has live wa_messages → analyzable even without a .txt import
  hasActiveProject: boolean; // false → archived/lost (no live project: all archived or HOLD/LOST-tagged, or no project + all contracts closed/lost); separated in the UI
  manuallyArchived: boolean; // operator flagged clients.status !== 'active'
  satisfactionScore: number | null;
  briefAdherenceScore: number | null;
  sentiment: string | null;
  analyzedAt: string | null;
  // True when this client's current analysis predates the org's latest taught
  // instruction (migration 0197) — i.e. it was scored on outdated guidance and
  // should be re-analyzed. Too many clients to regenerate eagerly, so the board
  // flags it and the daily cron / per-client re-analyze refreshes it.
  stale: boolean;
}

// ---- Hub overview: every client that has an import or analysis -----------
async function _getSatisfactionRows(orgId: string): Promise<SatisfactionRow[]> {
  const knowledgeStamp = await getKnowledgeStamp(orgId);
  const displayNames = await getClientDisplayNameMap(orgId);
  const [importsRes, analysesRes, clientsRes, projectsRes, linksRes, holdLostRes, contractsRes] =
    await Promise.all([
      supabaseAdmin
        .from("client_chat_imports")
        .select("client_id, group_kind")
        .eq("organization_id", orgId),
      supabaseAdmin
        .from("client_satisfaction_analyses")
        .select("client_id, satisfaction_score, brief_adherence_score, sentiment, created_at")
        .eq("organization_id", orgId)
        .eq("is_current", true),
      supabaseAdmin
        .from("clients")
        .select("id, name, status, merged_into_client_id")
        .eq("organization_id", orgId),
      supabaseAdmin
        .from("projects")
        .select("id, client_id, status")
        .eq("organization_id", orgId),
      supabaseAdmin
        .from("wa_group_links")
        .select("client_id, message_count, projects:wa_group_projects(project_id)")
        .eq("organization_id", orgId)
        .not("client_id", "is", null),
      // Projects carrying a HOLD / LOST tag (Odoo project tags). These flag a
      // paused/churned relationship the operator hasn't archived in Rawasm yet,
      // so satisfaction must treat such a project as NOT live (team feedback).
      supabaseAdmin
        .from("project_tag_assignments")
        .select("project_id, tag:project_tags!inner(name)")
        .eq("organization_id", orgId)
        .in("tag.name", ["HOLD", "LOST"]),
      // Contract statuses per client — the fallback signal for clients that live
      // only on the contracts sheet (no Rawasm project). A no-project client whose
      // contracts are ALL closed/lost is a churned relationship, not an active one.
      supabaseAdmin
        .from("contracts")
        .select("client_id, status")
        .eq("organization_id", orgId)
        .not("client_id", "is", null),
    ]);
  if (importsRes.error) throw importsRes.error;
  if (analysesRes.error) throw analysesRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (holdLostRes.error) throw holdLostRes.error;
  if (contractsRes.error) throw contractsRes.error;

  const names = new Map<string, string>();
  // Manual archive flag: clients.status !== 'active' (e.g. 'archived'/'lost'/
  // 'cancelled') is an explicit override — the relationship is dead even if a
  // project still looks active (cancelled contract not yet archived in Rawasm).
  const manualStatus = new Map<string, string | null>();
  // child clientId → canonical (merged-into) clientId, to fold sheet twins' contracts.
  const mergeMap = new Map<string, string>();
  for (const c of (clientsRes.data ?? []) as Array<{
    id: string;
    name: string;
    status: string | null;
    merged_into_client_id: string | null;
  }>) {
    // Contracts are the source of truth for a client's name — prefer the
    // contract-sheet name over the Odoo project name. See [[project_clients_centralization]].
    names.set(c.id, displayNames.get(c.id) ?? c.name);
    manualStatus.set(c.id, c.status);
    if (c.merged_into_client_id) mergeMap.set(c.id, c.merged_into_client_id);
  }
  const canonClient = (id: string) => mergeMap.get(id) ?? id;

  // Project ids tagged HOLD/LOST → treated as non-live regardless of project.status.
  const holdLostProjectIds = new Set<string>();
  for (const r of (holdLostRes.data ?? []) as Array<{ project_id: string }>)
    holdLostProjectIds.add(r.project_id);

  // Contract statuses folded onto the canonical client (contracts usually sit on
  // the merged sheet twin, not the project/chat-bearing canonical row).
  const contractStatusesByClient = new Map<string, Set<string>>();
  for (const r of (contractsRes.data ?? []) as Array<{ client_id: string | null; status: string | null }>) {
    if (!r.client_id) continue;
    const key = canonClient(r.client_id);
    const set = contractStatusesByClient.get(key) ?? new Set<string>();
    set.add((r.status ?? "").toLowerCase());
    contractStatusesByClient.set(key, set);
  }

  // Archived rule. A client is "lost/archived" when ANY of:
  //  - it is manually flagged (clients.status !== 'active'), OR
  //  - it has projects but NONE is live — a live project is non-archived AND not
  //    tagged HOLD/LOST (the HOLD/LOST tag pauses/churns the account even before
  //    Rawasm archives it), OR
  //  - it has NO project but its contracts are ALL closed/lost (a churned
  //    contracts-sheet-only client).
  // "Associated" means projects it OWNS *plus* projects its WhatsApp groups
  // LINK TO — because duplicate client rows split the relationship: the group
  // is mapped to a project-less copy while the real (archived) project lives on
  // the twin (e.g. مجوهرات نها / جزيرة الريف). Following the group link's
  // project_id recovers the true status. A client with NO project and no
  // (or a still-live/renewable) contract stays active.
  const projectStatusById = new Map<string, string | null>();
  const ownedProjectIds = new Map<string, string[]>();
  for (const p of (projectsRes.data ?? []) as Array<{ id: string; client_id: string | null; status: string | null }>) {
    projectStatusById.set(p.id, p.status);
    if (!p.client_id) continue;
    const arr = ownedProjectIds.get(p.client_id) ?? [];
    arr.push(p.id);
    ownedProjectIds.set(p.client_id, arr);
  }
  // Projects reached via each client's WhatsApp group links (may belong to a
  // twin). 0203: a group can link to several projects, so union them all.
  const linkedProjectIds = new Map<string, Set<string>>();
  for (const l of (linksRes.data ?? []) as Array<{
    client_id: string | null;
    projects: { project_id: string }[] | null;
  }>) {
    if (!l.client_id || !l.projects?.length) continue;
    const s = linkedProjectIds.get(l.client_id) ?? new Set<string>();
    for (const pj of l.projects) s.add(pj.project_id);
    linkedProjectIds.set(l.client_id, s);
  }

  // Assemble the classification signals for a client and delegate to the pure,
  // unit-tested rule (isClientRelationshipActive in satisfaction-rules.ts) so the
  // three team-approved rules can never silently regress.
  const isActiveClient = (clientId: string) => {
    // Every project associated with the client: those it owns + those reached via
    // its WhatsApp group links (a twin may hold the real project).
    const pids = new Set<string>(ownedProjectIds.get(clientId) ?? []);
    for (const pid of linkedProjectIds.get(clientId) ?? []) {
      if (projectStatusById.has(pid)) pids.add(pid);
    }
    return isClientRelationshipActive({
      manualStatus: manualStatus.get(clientId) ?? null,
      projects: [...pids].map((pid) => ({
        status: projectStatusById.get(pid) ?? null,
        holdLost: holdLostProjectIds.has(pid),
      })),
      contractStatuses: [...(contractStatusesByClient.get(canonClient(clientId)) ?? [])],
    });
  };

  // A client has live coverage if any of its mapped groups carry ingested messages.
  const clientsWithMessages = new Set<string>();
  for (const l of (linksRes.data ?? []) as Array<{ client_id: string | null; message_count: number | null }>) {
    if (l.client_id && (l.message_count ?? 0) > 0) clientsWithMessages.add(l.client_id);
  }

  const rowByClient = new Map<string, SatisfactionRow>();
  const ensure = (clientId: string) => {
    let r = rowByClient.get(clientId);
    if (!r) {
      r = {
        clientId,
        clientName: names.get(clientId) ?? "—",
        hasClient: false,
        hasTechnical: false,
        hasMessages: clientsWithMessages.has(clientId),
        hasActiveProject: isActiveClient(clientId),
        manuallyArchived: (() => {
          const s = manualStatus.get(clientId);
          return !!s && s !== "active";
        })(),
        satisfactionScore: null,
        briefAdherenceScore: null,
        sentiment: null,
        analyzedAt: null,
        stale: false,
      };
      rowByClient.set(clientId, r);
    }
    return r;
  };

  for (const i of (importsRes.data ?? []) as Array<{ client_id: string; group_kind: GroupKind }>) {
    const r = ensure(i.client_id);
    if (i.group_kind === "client") r.hasClient = true;
    else r.hasTechnical = true;
  }
  for (const a of (analysesRes.data ?? []) as Array<{
    client_id: string;
    satisfaction_score: number | null;
    brief_adherence_score: number | null;
    sentiment: string | null;
    created_at: string;
  }>) {
    const r = ensure(a.client_id);
    r.satisfactionScore = a.satisfaction_score;
    r.briefAdherenceScore = a.brief_adherence_score;
    r.sentiment = a.sentiment;
    r.analyzedAt = a.created_at;
    r.stale = isStaleAgainstKnowledge(a.created_at, knowledgeStamp);
  }

  // Any client whose linked WhatsApp groups carry ingested messages is analyzable
  // and must appear — even with no .txt import and no current analysis yet. Without
  // this, groups linked live via OpenWA were invisible on the board (they only had
  // wa_messages, never an import row) and landed nowhere. They surface in "pending".
  for (const clientId of clientsWithMessages) ensure(clientId);

  return Array.from(rowByClient.values()).sort((a, b) => {
    // Analyzed first, then lowest satisfaction (most attention), then name.
    if (!!a.analyzedAt !== !!b.analyzedAt) return a.analyzedAt ? -1 : 1;
    const as = a.satisfactionScore ?? 999;
    const bs = b.satisfactionScore ?? 999;
    if (as !== bs) return as - bs;
    return a.clientName.localeCompare(b.clientName);
  });
}
export const getSatisfactionRows = cache(_getSatisfactionRows);

// ---- Per-client detail ---------------------------------------------------
export interface ClientSatisfactionDetail {
  clientId: string;
  clientName: string;
  imports: { client: ImportInfo | null; technical: ImportInfo | null };
  hasMessages: boolean; // live wa_messages exist → analyzable without a .txt import
  latestMessageAt: string | null; // newest linked live/imported WhatsApp message
  hasNewMessagesSinceAnalysis: boolean | null;
  analysis: AnalysisInfo | null; // the shown analysis (selected, else current week)
  history: AnalysisHistoryItem[]; // all stored snapshots, newest first
  activeProjects: Array<{ id: string; name: string }>;
  brief: ClientBriefRef | null; // the attached brief doc (reachable link/file), if any
}

const ANALYSIS_COLUMNS =
  "id, satisfaction_score, brief_adherence_score, brief_adherence, sentiment, summary, highlights, sentiment_timeline, risks, recommendations, indicators, client_group_signals, technical_group_signals, causes, accountability, contract_context, team_context, big_picture, model, created_at, window_kind, window_start, window_end";

// Defaults for the rich fields so rows written before migration 0178 (which
// have NULL in the new columns) still render without per-call null checks.
const EMPTY_BIG_PICTURE: SatisfactionResult["bigPicture"] = {
  accountHealth: "watch",
  headline: "",
  relationshipScore: 50,
  executionScore: 50,
  commercialScore: null,
};
const EMPTY_CLIENT_SIGNALS: SatisfactionResult["clientGroupSignals"] = {
  requests: { new: 0, edit: 0, complaint: 0, inquiry: 0, approval: 0 },
  approvals: { approved: 0, rejected: 0, changesRequested: 0, noResponse: 0 },
  requestExamples: { new: [], edit: [], complaint: [], inquiry: [], approval: [] },
  approvalExamples: { approved: [], rejected: [], changesRequested: [], noResponse: [] },
  responseSpeed: "unknown",
};
const EMPTY_TECH_SIGNALS: SatisfactionResult["technicalGroupSignals"] = {
  blockers: [],
  delayCauses: [],
  accountEvaluation: [],
};

function toAnalysisInfo(a: Record<string, unknown>): AnalysisInfo {
  const storedBigPicture =
    (a.big_picture as (SatisfactionResult["bigPicture"] & {
      _sourceLatestMessageAt?: string | null;
      _hadNewMessages?: boolean | null;
    }) | null) ?? EMPTY_BIG_PICTURE;
  return {
    id: a.id as string,
    satisfactionScore: (a.satisfaction_score as number) ?? 0,
    briefAdherenceScore: (a.brief_adherence_score as number | null) ?? null,
    briefAdherence: (a.brief_adherence as SatisfactionResult["briefAdherence"]) ?? null,
    sentiment: (a.sentiment as SatisfactionResult["sentiment"]) ?? "neutral",
    summary: (a.summary as string) ?? "",
    bigPicture: storedBigPicture,
    indicators: (a.indicators as SatisfactionResult["indicators"]) ?? [],
    clientGroupSignals:
      (a.client_group_signals as SatisfactionResult["clientGroupSignals"]) ?? EMPTY_CLIENT_SIGNALS,
    technicalGroupSignals:
      (a.technical_group_signals as SatisfactionResult["technicalGroupSignals"]) ?? EMPTY_TECH_SIGNALS,
    causes: (a.causes as SatisfactionResult["causes"]) ?? [],
    accountability: (a.accountability as SatisfactionResult["accountability"]) ?? [],
    highlights: (a.highlights as SatisfactionResult["highlights"]) ?? [],
    sentimentTimeline: (a.sentiment_timeline as SatisfactionResult["sentimentTimeline"]) ?? [],
    risks: (a.risks as string[]) ?? [],
    recommendations: (a.recommendations as SatisfactionResult["recommendations"]) ?? [],
    contractContext: (a.contract_context as ClientContractContext | null) ?? null,
    teamContext: (a.team_context as ClientTeamActivitySnapshot | null) ?? null,
    model: (a.model as string | null) ?? null,
    createdAt: a.created_at as string,
    windowKind: ((a.window_kind as string) ?? "all") as WindowKind,
    windowStart: (a.window_start as string | null) ?? null,
    windowEnd: (a.window_end as string | null) ?? null,
    sourceLatestMessageAt: storedBigPicture._sourceLatestMessageAt ?? null,
    hadNewMessages: storedBigPicture._hadNewMessages ?? null,
  };
}

// Load one specific stored analysis (for clicking into a past snapshot).
async function _getAnalysisById(
  orgId: string,
  analysisId: string,
): Promise<AnalysisInfo | null> {
  const { data } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select(ANALYSIS_COLUMNS)
    .eq("organization_id", orgId)
    .eq("id", analysisId)
    .maybeSingle();
  return data ? toAnalysisInfo(data as Record<string, unknown>) : null;
}
export const getAnalysisById = cache(_getAnalysisById);

// Fill in taskId on a frozen roster's stuck tasks by resolving their task_code
// against the live tasks table. Mutates in place. Only queries codes still
// missing an id, so re-running on already-hydrated snapshots is a no-op.
async function hydrateStuckTaskIds(orgId: string, stuckTasks: StuckTask[]): Promise<void> {
  const codes = [
    ...new Set(stuckTasks.filter((t) => !t.taskId && t.taskCode).map((t) => t.taskCode as string)),
  ];
  if (codes.length === 0) return;
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, task_code")
    .eq("organization_id", orgId)
    .in("task_code", codes);
  if (!data?.length) return;
  const idByCode = new Map<string, string>();
  for (const r of data as Array<{ id: string; task_code: string | null }>) {
    if (r.task_code) idByCode.set(r.task_code, r.id);
  }
  for (const t of stuckTasks) {
    if (!t.taskId && t.taskCode) t.taskId = idByCode.get(t.taskCode) ?? null;
  }
}

async function _getClientSatisfactionDetail(
  orgId: string,
  clientId: string,
  selectedAnalysisId?: string | null,
): Promise<ClientSatisfactionDetail | null> {
  const [clientRes, importsRes, analysisRes, historyRes, hasMessages, latestLiveMessageAt, projectsRes, brief, displayNames] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("id", clientId)
      .maybeSingle(),
    supabaseAdmin
      .from("client_chat_imports")
      .select(
        "id, group_kind, source_filename, message_count, participant_count, first_message_at, last_message_at, created_at",
      )
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select(ANALYSIS_COLUMNS)
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select(
        "id, satisfaction_score, sentiment, created_at, window_kind, window_start, window_end, is_current",
      )
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(40),
    // Resolve message existence via the link graph (chat_id), NOT the frozen
    // wa_messages.client_id — otherwise link-connected clients (no direct stamp)
    // wrongly report "no messages" and get their analyze buttons disabled even
    // though they can be (and have been) analyzed.
    clientHasResolvedMessages(orgId, clientId),
    getClientLatestLiveMessageAt(orgId, clientId),
    supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    getClientBriefRef(orgId, clientId),
    getClientDisplayNameMap(orgId),
  ]);
  if (clientRes.error) throw clientRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (!clientRes.data) return null;

  const toInfo = (r: Record<string, unknown>): ImportInfo => ({
    id: r.id as string,
    groupKind: r.group_kind as GroupKind,
    sourceFilename: (r.source_filename as string | null) ?? null,
    messageCount: (r.message_count as number) ?? 0,
    participantCount: (r.participant_count as number) ?? 0,
    firstMessageAt: (r.first_message_at as string | null) ?? null,
    lastMessageAt: (r.last_message_at as string | null) ?? null,
    createdAt: r.created_at as string,
  });

  // Latest per kind.
  let clientImp: ImportInfo | null = null;
  let techImp: ImportInfo | null = null;
  for (const raw of (importsRes.data ?? []) as Array<Record<string, unknown>>) {
    const info = toInfo(raw);
    if (info.groupKind === "client" && !clientImp) clientImp = info;
    if (info.groupKind === "technical" && !techImp) techImp = info;
  }

  const current = analysisRes.data as Record<string, unknown> | null;

  // Shown analysis: an explicitly selected past snapshot, else the current
  // week. A selected id is fetched separately (it may not be the current row).
  let analysis: AnalysisInfo | null = current ? toAnalysisInfo(current) : null;
  if (selectedAnalysisId && selectedAnalysisId !== analysis?.id) {
    const picked = await getAnalysisById(orgId, selectedAnalysisId);
    if (picked) analysis = picked;
  }

  const latestMessageAt = [
    latestLiveMessageAt,
    clientImp?.lastMessageAt ?? null,
    techImp?.lastMessageAt ?? null,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  // Backfill the truth for legacy snapshots that predate the persisted
  // watermark: when this is demonstrably a re-analysis (an older snapshot
  // exists) and even today's newest available message predates the run, it ran
  // without new chat evidence. This makes already-saved misleading results show
  // the warning immediately, not only after their next re-analysis.
  const hasEarlierAnalysis = analysis
    ? ((historyRes.data ?? []) as Array<{ id: string; created_at: string }>).some(
        (row) => row.id !== analysis.id && row.created_at < analysis.createdAt,
      )
    : false;
  if (
    analysis &&
    analysis.hadNewMessages === null &&
    hasEarlierAnalysis &&
    latestMessageAt &&
    latestMessageAt <= analysis.createdAt
  ) {
    analysis.hadNewMessages = false;
    analysis.sourceLatestMessageAt = latestMessageAt;
  }
  const freshnessBaseline = analysis?.sourceLatestMessageAt ?? analysis?.createdAt ?? null;
  const hasNewMessagesSinceAnalysis = analysis
    ? Boolean(latestMessageAt && freshnessBaseline && latestMessageAt > freshnessBaseline)
    : null;

  // Resolve task_code → task id for the shown analysis's roster. The frozen
  // team_context only carries taskId for analyses run after that field was
  // added, so older snapshots have null ids and their accountability chips would
  // fall back to a code search. Hydrate the ids here (one query) so every chip
  // deep-links straight to /tasks/[id]. Every accountability taskCode is
  // guaranteed to be a stuckTasks code (analyze-time roster validation), so
  // resolving stuckTasks covers the panel.
  if (analysis?.teamContext?.stuckTasks?.length) {
    await hydrateStuckTaskIds(orgId, analysis.teamContext.stuckTasks);
  }

  const history: AnalysisHistoryItem[] = (
    (historyRes.data ?? []) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as string,
    windowKind: ((r.window_kind as string) ?? "all") as WindowKind,
    satisfactionScore: (r.satisfaction_score as number | null) ?? null,
    sentiment: (r.sentiment as string | null) ?? null,
    createdAt: r.created_at as string,
    windowStart: (r.window_start as string | null) ?? null,
    windowEnd: (r.window_end as string | null) ?? null,
    isCurrent: (r.is_current as boolean) ?? false,
  }));

  return {
    clientId,
    // Contract-sheet name (folded across merged twins), falling back to the raw name.
    clientName: displayNames.get(clientId) ?? (clientRes.data.name as string),
    imports: { client: clientImp, technical: techImp },
    hasMessages,
    latestMessageAt,
    hasNewMessagesSinceAnalysis,
    analysis,
    history,
    activeProjects: ((projectsRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    brief,
  };
}
export const getClientSatisfactionDetail = cache(_getClientSatisfactionDetail);

// ---- Merged transcripts (one-time .txt import + live WhatsApp messages) --
export interface MergedTranscripts {
  client: string;
  technical: string;
  clientMessages: number;
  technicalMessages: number;
  latestMessageAt: string | null;
  identifiedEmployeeMessages: number;
  externalMessages: number;
}

interface EmployeeSenderIdentity {
  name: string;
  phone: string | null;
}
interface EmployeeSenderDirectory {
  byPhone: Map<string, EmployeeSenderIdentity>;
  byName: Map<string, EmployeeSenderIdentity>;
}

function normalizedPersonName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Employee phones may be entered as +966 5…, 00966…, or 05…. WhatsApp's
// phone JIDs use 966…@c.us. Canonicalise Saudi mobiles to their final 9 digits;
// never treat an opaque @lid identifier as a phone because it is not one.
export function normalizedWhatsAppPhone(value: string | null | undefined): string | null {
  if (!value || /@lid$/i.test(value.trim())) return null;
  let digits = value.replace(/@.*$/, "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) return digits.slice(1);
  if (/^9665\d{8}$/.test(digits)) return digits.slice(3);
  return digits.length >= 7 ? digits : null;
}

async function getEmployeeSenderDirectory(orgId: string): Promise<EmployeeSenderDirectory> {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("full_name, phone, employment_status")
    .eq("organization_id", orgId)
    .neq("employment_status", "terminated");
  if (error) throw error;
  const byPhone = new Map<string, EmployeeSenderIdentity>();
  const byName = new Map<string, EmployeeSenderIdentity>();
  for (const row of (data ?? []) as Array<{
    full_name: string;
    phone: string | null;
    employment_status: string | null;
  }>) {
    const identity = { name: row.full_name, phone: row.phone };
    const phone = normalizedWhatsAppPhone(row.phone);
    const name = normalizedPersonName(row.full_name);
    if (phone) byPhone.set(phone, identity);
    // Exact normalized-name matching only. Ambiguous duplicate names are
    // removed rather than risking attribution to the wrong employee.
    if (name) {
      if (byName.has(name)) byName.delete(name);
      else byName.set(name, identity);
    }
  }
  return { byPhone, byName };
}
const getEmployeeSenderDirectoryCached = cache(getEmployeeSenderDirectory);

function annotateImportedTranscript(
  transcript: string,
  directory: EmployeeSenderDirectory,
): { text: string; employees: number; external: number } {
  let employees = 0;
  let external = 0;
  const text = transcript
    .split("\n")
    .map((line) => {
      // WhatsApp exports commonly use either "[date, time] Sender: text" or
      // "date, time - Sender: text". Preserve unrecognised/system lines.
      const match =
        line.match(/^(\[[^\]]+\]\s*)([^:]{1,100})(:\s.*)$/) ??
        line.match(/^(.{5,40}\s-\s)([^:]{1,100})(:\s.*)$/);
      if (!match) return line;
      const identity = directory.byName.get(normalizedPersonName(match[2]));
      if (identity) {
        employees += 1;
        return `${match[1]}[موظف الشركة: ${identity.name}] ${match[2]}${match[3]}`;
      }
      external += 1;
      return `${match[1]}[عميل/طرف خارجي] ${match[2]}${match[3]}`;
    })
    .join("\n");
  return { text, employees, external };
}

function renderWaLine(
  sentAt: string | null,
  sender: string | null,
  body: string,
  identity: EmployeeSenderIdentity | null,
  isFromMe: boolean,
): string {
  const ts = sentAt ? sentAt.slice(0, 16).replace("T", " ") : "?";
  const role = identity
    ? `موظف الشركة: ${identity.name}`
    : isFromMe
      ? "فريق الشركة: الرقم المتصل"
      : "عميل/طرف خارجي";
  return `[${ts}] [${role}] ${sender ?? identity?.name ?? "مرسل غير معروف"}: ${body}`;
}

// Turn a WhatsApp message into the transcript text the model reads — MEDIA-AWARE.
// Media itself (image pixels, PDF/audio contents) is never stored, so we can't
// read it. But the TEXT that rides with media is real, high-value client signal
// and used to be dropped entirely:
//   - image/video caption  → the client's own words (approvals, complaints, asks)
//   - document filename     → what was exchanged ("عقد.pdf", "التقرير الشهري")
//   - vcard/location body   → the shared contact / place
// We label the media-borne lines so the model knows a file/image accompanied the
// text (and must NOT invent the file's contents). Returns null to skip a message
// with no usable text (pure sticker/voice-note/empty image, or a system notice).
function waMessageText(type: string, body: string): string | null {
  const t = (type || "chat").toLowerCase();
  const b = body.trim();
  switch (t) {
    case "chat":
    case "text":
      return b || null;
    // Caption-bearing media: the caption is the client speaking, prefixed so the
    // model knows an image/video was attached.
    case "image":
      return b ? `[صورة] ${b}` : null;
    case "video":
      return b ? `[فيديو] ${b}` : null;
    // A shared document — the filename is the signal (brief/contract/report/invoice).
    case "document":
      return b ? `[ملف: ${b}]` : null;
    case "vcard":
      return b ? `[جهة اتصال: ${b}]` : null;
    case "location":
      return b ? `[موقع: ${b}]` : null;
    // Pure media with no text (voice notes, stickers, albums, empty images) and
    // system notices (gp2 group events, e2e/history notices) carry no client
    // signal for satisfaction — skip rather than fabricate a placeholder.
    default:
      return null;
  }
}

// Resolve the FULL set of WhatsApp groups that belong to a client from the
// CURRENT link graph — never the per-message client_id stamp (which is frozen
// at ingest and goes stale/empty when a group is re-linked, a new number joins
// an already-linked group, or the same brand is split across duplicate client
// records). A group counts for the client when it is linked to the client
// directly OR to any of the client's projects (the wa_group_projects M2M or the
// legacy wa_group_links.project_id mirror). This is what makes re-analyze reach
// the right messages for multi-project / multi-contract / shared-chat clients.
// Returns chat_id → the group's CURRENT kind (client / technical / null).
async function resolveClientGroupChats(
  orgId: string,
  clientId: string,
): Promise<Map<string, GroupKind | null>> {
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", orgId)
    .eq("client_id", clientId);
  const projectIds = (projects ?? []).map((p) => p.id as string);

  const [directRes, m2mRes, legacyRes] = await Promise.all([
    supabaseAdmin
      .from("wa_group_links")
      .select("chat_id, group_kind")
      .eq("organization_id", orgId)
      .eq("client_id", clientId),
    projectIds.length
      ? supabaseAdmin
          .from("wa_group_projects")
          .select("wa_group_links(chat_id, group_kind)")
          .eq("organization_id", orgId)
          .in("project_id", projectIds)
      : Promise.resolve({ data: [] as Array<{ wa_group_links: { chat_id: string; group_kind: GroupKind | null } | null }> }),
    projectIds.length
      ? supabaseAdmin
          .from("wa_group_links")
          .select("chat_id, group_kind")
          .eq("organization_id", orgId)
          .in("project_id", projectIds)
      : Promise.resolve({ data: [] as Array<{ chat_id: string; group_kind: GroupKind | null }> }),
  ]);

  const out = new Map<string, GroupKind | null>();
  // First-seen wins, but a concrete kind upgrades a previously-null entry so a
  // group classified on any of its link rows is never left unclassified.
  const add = (chatId: string | null | undefined, kind: GroupKind | null) => {
    if (!chatId) return;
    if (!out.has(chatId)) out.set(chatId, kind ?? null);
    else if (out.get(chatId) == null && kind != null) out.set(chatId, kind);
  };
  for (const r of (directRes.data ?? []) as Array<{ chat_id: string; group_kind: GroupKind | null }>)
    add(r.chat_id, r.group_kind);
  for (const r of (m2mRes.data ?? []) as Array<{
    wa_group_links: { chat_id: string; group_kind: GroupKind | null } | null;
  }>)
    add(r.wa_group_links?.chat_id, r.wa_group_links?.group_kind ?? null);
  for (const r of (legacyRes.data ?? []) as Array<{ chat_id: string; group_kind: GroupKind | null }>)
    add(r.chat_id, r.group_kind);
  return out;
}

// Does the client have any analyzable WhatsApp messages? Resolved via the SAME
// link graph the analysis uses (chat_id), NOT the frozen wa_messages.client_id
// stamp — that stamp goes stale/empty when a group is re-linked or a new number
// joins, so counting by it wrongly reported "no messages" and DISABLED the
// analyze buttons for clients that actually have (and were) analyzed. Keeping
// this consistent with buildClientTranscripts is what makes the button state
// match reality. See [[project_satisfaction_transcript_resolution]].
async function _clientHasResolvedMessages(orgId: string, clientId: string): Promise<boolean> {
  const chatIds = Array.from((await resolveClientGroupChats(orgId, clientId)).keys());
  if (chatIds.length === 0) return false;
  const { count } = await supabaseAdmin
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .in("chat_id", chatIds);
  return (count ?? 0) > 0;
}
export const clientHasResolvedMessages = cache(_clientHasResolvedMessages);

async function _getClientLatestLiveMessageAt(
  orgId: string,
  clientId: string,
): Promise<string | null> {
  const chatIds = Array.from((await resolveClientGroupChats(orgId, clientId)).keys());
  if (chatIds.length === 0) return null;
  const { data } = await supabaseAdmin
    .from("wa_messages")
    .select("sent_at")
    .eq("organization_id", orgId)
    .in("chat_id", chatIds)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sent_at as string | null | undefined) ?? null;
}
export const getClientLatestLiveMessageAt = cache(_getClientLatestLiveMessageAt);

async function _buildClientTranscripts(
  orgId: string,
  clientId: string,
  opts?: { sinceDays?: number },
): Promise<MergedTranscripts> {
  // Windowed (current-status) analysis: only the last `sinceDays` of LIVE
  // messages. The one-time .txt import is a historical seed (one undated blob)
  // so it is excluded from a recent window — it would drag old complaints into
  // the "current" reading, which is exactly what the team asked us to stop.
  const since =
    opts?.sinceDays != null
      ? new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString()
      : null;

  // The client's groups resolved from the live link graph (chat_id → kind).
  const chatKinds = await resolveClientGroupChats(orgId, clientId);
  const chatIds = Array.from(chatKinds.keys());
  const employeeDirectoryPromise = getEmployeeSenderDirectoryCached(orgId);

  // Gather messages by GROUP (chat_id), not by the frozen message client_id.
  let waQuery = chatIds.length
    ? supabaseAdmin
        .from("wa_messages")
        .select("chat_id, group_kind, sender, sender_id, body, sent_at, message_type, is_from_me")
        .eq("organization_id", orgId)
        .in("chat_id", chatIds)
        .order("sent_at", { ascending: true })
        .limit(8000)
    : null;
  if (waQuery && since) waQuery = waQuery.gte("sent_at", since);

  const [importsRes, waRes, employeeDirectory] = await Promise.all([
    since
      ? Promise.resolve({ data: [] as Array<{ group_kind: GroupKind; transcript: string }> })
      : supabaseAdmin
          .from("client_chat_imports")
          .select("group_kind, transcript, last_message_at, created_at")
          .eq("organization_id", orgId)
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
    waQuery ?? Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    employeeDirectoryPromise,
  ]);

  // Latest one-time import per kind (historical seed; empty for windowed runs).
  const rawImportByKind: Record<GroupKind, string> = { client: "", technical: "" };
  let latestMessageAt: string | null = null;
  for (const r of (importsRes.data ?? []) as Array<{
    group_kind: GroupKind;
    transcript: string;
    last_message_at?: string | null;
  }>) {
    if (!rawImportByKind[r.group_kind]) rawImportByKind[r.group_kind] = r.transcript ?? "";
    if (r.last_message_at && (!latestMessageAt || r.last_message_at > latestMessageAt))
      latestMessageAt = r.last_message_at;
  }

  // Live messages per kind (text only, non-empty). The group's CURRENT kind
  // (from the link graph) wins; we fall back to the message's stored kind and
  // finally to the CLIENT block for still-unclassified groups — dropping them
  // silently skewed satisfaction scores too rosy (whole groups vanished).
  const liveByKind: Record<GroupKind, string[]> = { client: [], technical: [] };
  const counts: Record<GroupKind, number> = { client: 0, technical: 0 };
  let identifiedEmployeeMessages = 0;
  let externalMessages = 0;
  const importByKind: Record<GroupKind, string> = { client: "", technical: "" };
  for (const kind of ["client", "technical"] as const) {
    const annotated = annotateImportedTranscript(rawImportByKind[kind], employeeDirectory);
    importByKind[kind] = annotated.text;
    identifiedEmployeeMessages += annotated.employees;
    externalMessages += annotated.external;
  }
  for (const r of (waRes.data ?? []) as Array<{
    chat_id: string | null;
    group_kind: GroupKind | null;
    sender: string | null;
    sender_id: string | null;
    body: string | null;
    sent_at: string | null;
    message_type: string | null;
    is_from_me: boolean;
  }>) {
    if (r.sent_at && (!latestMessageAt || r.sent_at > latestMessageAt)) latestMessageAt = r.sent_at;
    const kind: GroupKind =
      (r.chat_id ? chatKinds.get(r.chat_id) : null) ?? r.group_kind ?? "client";
    // Media-aware: keep image/video captions, document filenames, and shared
    // contacts/locations (labeled) — not just plain chat. Skips messages with no
    // usable text. See waMessageText().
    const text = waMessageText(r.message_type ?? "chat", r.body ?? "");
    if (!text) continue;
    const senderPhone = normalizedWhatsAppPhone(r.sender_id);
    const senderName = normalizedPersonName(r.sender);
    const identity =
      (senderPhone ? employeeDirectory.byPhone.get(senderPhone) : null) ??
      (senderName ? employeeDirectory.byName.get(senderName) : null) ??
      null;
    if (identity || r.is_from_me) identifiedEmployeeMessages += 1;
    else externalMessages += 1;
    liveByKind[kind].push(renderWaLine(r.sent_at, r.sender, text, identity, r.is_from_me));
    counts[kind] += 1;
  }

  const merge = (kind: GroupKind) =>
    [importByKind[kind], liveByKind[kind].join("\n")].filter(Boolean).join("\n");

  return {
    client: merge("client"),
    technical: merge("technical"),
    clientMessages: counts.client,
    technicalMessages: counts.technical,
    latestMessageAt,
    identifiedEmployeeMessages,
    externalMessages,
  };
}
export const buildClientTranscripts = cache(_buildClientTranscripts);

// ---- Media & files exchanged (evidence surfaced next to the analysis) ------
// We never store the media BINARY (no image pixels / PDF bytes), only the text
// that rode with it: document filenames, image/video captions, shared
// contacts/locations. This surfaces that exchange as evidence — what the client
// sent (briefs, reports, contracts, screenshots) and when — resolved via the
// SAME link graph the transcript uses, so it matches what the analysis read.
export interface MediaItem {
  kind: GroupKind; // client 💫 vs technical 📍 group
  sender: string | null;
  date: string | null; // ISO
  text: string; // filename (documents) or caption (image/video/…)
}
export interface ClientMediaExchange {
  documents: MediaItem[]; // files shared (filename is the signal)
  images: MediaItem[]; // captioned images
  videos: MediaItem[]; // captioned videos
  others: MediaItem[]; // vcard / location (with text)
  links: MediaItem[];
  documentCount: number;
  imageCount: number;
  videoCount: number;
  otherCount: number;
  linkCount: number;
  voiceNotes: number; // ptt count (no text — not stored)
  silentImages: number; // images with no caption (pixels not stored)
  totalMedia: number; // every non-chat media message in scope
  totalSharedItems: number; // media + messages containing links
  isPartial: boolean; // query hit its safety cap; real stored total may be higher
}

const MEDIA_PER_CATEGORY = 20;

async function _getClientMediaExchange(
  orgId: string,
  clientId: string,
): Promise<ClientMediaExchange> {
  const chatKinds = await resolveClientGroupChats(orgId, clientId);
  const chatIds = Array.from(chatKinds.keys());
  const empty: ClientMediaExchange = {
    documents: [],
    images: [],
    videos: [],
    others: [],
    links: [],
    documentCount: 0,
    imageCount: 0,
    videoCount: 0,
    otherCount: 0,
    linkCount: 0,
    voiceNotes: 0,
    silentImages: 0,
    totalMedia: 0,
    totalSharedItems: 0,
    isPartial: false,
  };
  if (chatIds.length === 0) return empty;

  const { data } = await supabaseAdmin
    .from("wa_messages")
    .select("chat_id, group_kind, sender, body, sent_at, message_type")
    .eq("organization_id", orgId)
    .in("chat_id", chatIds)
    .order("sent_at", { ascending: false })
    .limit(8000);
  if (!data || data.length === 0) return empty;

  const out: ClientMediaExchange = {
    ...empty,
    documents: [],
    images: [],
    videos: [],
    others: [],
    links: [],
    isPartial: data.length === 8000,
  };
  const mediaTypes = new Set([
    "document",
    "image",
    "sticker",
    "video",
    "gif",
    "ptt",
    "audio",
    "vcard",
    "location",
  ]);
  const urlPattern = /(?:https?:\/\/|www\.)[^\s]+/i;
  for (const r of data as Array<{
    chat_id: string | null;
    group_kind: GroupKind | null;
    sender: string | null;
    body: string | null;
    sent_at: string | null;
    message_type: string | null;
  }>) {
    const kind: GroupKind =
      (r.chat_id ? chatKinds.get(r.chat_id) : null) ?? r.group_kind ?? "client";
    const type = (r.message_type ?? "").toLowerCase();
    const text = (r.body ?? "").trim();
    const item: MediaItem = { kind, sender: r.sender, date: r.sent_at, text };
    if (text && urlPattern.test(text)) {
      out.linkCount += 1;
      if (out.links.length < MEDIA_PER_CATEGORY) out.links.push(item);
    }
    if (!mediaTypes.has(type)) continue;
    out.totalMedia += 1;
    if (type === "ptt" || type === "audio") {
      out.voiceNotes += 1;
    } else if (type === "document") {
      out.documentCount += 1;
      if (text && out.documents.length < MEDIA_PER_CATEGORY) out.documents.push(item);
    } else if (type === "image" || type === "sticker") {
      out.imageCount += 1;
      if (!text) out.silentImages += 1;
      else if (out.images.length < MEDIA_PER_CATEGORY) out.images.push(item);
    } else if (type === "video" || type === "gif") {
      out.videoCount += 1;
      if (text && out.videos.length < MEDIA_PER_CATEGORY) out.videos.push(item);
    } else if (type === "vcard" || type === "location") {
      out.otherCount += 1;
      if (text && out.others.length < MEDIA_PER_CATEGORY)
        out.others.push({ ...item, text: `${type === "vcard" ? "جهة اتصال" : "موقع"}: ${text}` });
    }
  }
  out.totalSharedItems = out.totalMedia + out.linkCount;
  return out;
}
export const getClientMediaExchange = cache(_getClientMediaExchange);

// ---- Stored media for multimodal satisfaction analysis --------------------
// These are the actual bytes captured by the WhatsApp webhook. Historical rows
// before migration 0241 may only have captions/filenames, so this returns only
// media that was physically stored in the private `wa-media` bucket.
export interface ClientStoredMediaAttachment {
  label: string;
  messageType: string;
  mimeType: string;
  filename: string | null;
  sentAt: string | null;
  sender: string | null;
  groupKind: GroupKind;
  bytes: Buffer;
}

const AI_MEDIA_MAX_ITEMS = 16;
const AI_MEDIA_MAX_ITEM_BYTES = 8 * 1024 * 1024;
const AI_MEDIA_MAX_TOTAL_BYTES = 35 * 1024 * 1024;

function aiReadableMime(mime: string | null, messageType: string | null): string | null {
  const m = (mime ?? "").toLowerCase();
  const t = (messageType ?? "").toLowerCase();
  if (m.startsWith("image/")) return m;
  if (m === "application/pdf") return m;
  if (m.startsWith("audio/")) return m;
  if (m.startsWith("video/")) return m;
  if (t === "image") return "image/jpeg";
  if (t === "video") return "video/mp4";
  if (t === "audio" || t === "ptt") return "audio/ogg";
  return null;
}

async function _getClientStoredMediaAttachments(
  orgId: string,
  clientId: string,
  opts?: { sinceDays?: number },
): Promise<ClientStoredMediaAttachment[]> {
  const chatKinds = await resolveClientGroupChats(orgId, clientId);
  const chatIds = Array.from(chatKinds.keys());
  if (chatIds.length === 0) return [];

  let query = supabaseAdmin
    .from("wa_messages")
    .select(
      "chat_id, group_kind, sender, body, sent_at, message_type, media_storage_path, media_mime_type, media_filename, media_size_bytes",
    )
    .eq("organization_id", orgId)
    .in("chat_id", chatIds)
    .not("media_storage_path", "is", null)
    .order("sent_at", { ascending: false })
    .limit(80);

  if (opts?.sinceDays) {
    query = query.gte(
      "sent_at",
      new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString(),
    );
  }

  const { data } = await query;
  const out: ClientStoredMediaAttachment[] = [];
  let totalBytes = 0;

  for (const r of (data ?? []) as Array<{
    chat_id: string | null;
    group_kind: GroupKind | null;
    sender: string | null;
    body: string | null;
    sent_at: string | null;
    message_type: string | null;
    media_storage_path: string | null;
    media_mime_type: string | null;
    media_filename: string | null;
    media_size_bytes: number | null;
  }>) {
    if (!r.media_storage_path) continue;
    const mimeType = aiReadableMime(r.media_mime_type, r.message_type);
    if (!mimeType) continue;
    if ((r.media_size_bytes ?? 0) > AI_MEDIA_MAX_ITEM_BYTES) continue;
    if (out.length >= AI_MEDIA_MAX_ITEMS) break;

    const { data: blob, error } = await supabaseAdmin.storage
      .from("wa-media")
      .download(r.media_storage_path);
    if (error || !blob) continue;
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AI_MEDIA_MAX_ITEM_BYTES) continue;
    if (totalBytes + bytes.byteLength > AI_MEDIA_MAX_TOTAL_BYTES) break;

    totalBytes += bytes.byteLength;
    const kind: GroupKind =
      (r.chat_id ? chatKinds.get(r.chat_id) : null) ?? r.group_kind ?? "client";
    const date = r.sent_at ? r.sent_at.slice(0, 16).replace("T", " ") : "?";
    const typeLabel =
      r.message_type === "image"
        ? "صورة"
        : r.message_type === "video"
          ? "فيديو"
          : r.message_type === "ptt" || r.message_type === "audio"
            ? "ملف صوتي"
            : "ملف";
    out.push({
      label: `[${date}] ${kind === "client" ? "مجموعة العميل" : "مجموعة الفريق"} — ${r.sender ?? "—"} — ${typeLabel}${
        r.media_filename ? ` (${r.media_filename})` : ""
      }${r.body ? ` — النص المصاحب: ${r.body.trim().slice(0, 280)}` : ""}`,
      messageType: r.message_type ?? "file",
      mimeType,
      filename: r.media_filename,
      sentAt: r.sent_at,
      sender: r.sender,
      groupKind: kind,
      bytes,
    });
  }

  return out.reverse();
}
export const getClientStoredMediaAttachments = cache(_getClientStoredMediaAttachments);

// ---- Client execution snapshot (ties satisfaction to real delivery work) -
// Surfaces the client's actually-delayed tasks next to the AI analysis, so a
// "تأخير" complaint maps to concrete delayed work and the stage it's stuck in.
// Date columns (due_date/delay_days) are sparse for Odoo-synced tasks, so the
// primary "how late" signal is days stuck in the current stage (stage_entered_at,
// fully populated). Stage grouping shows whether delays cluster in one phase.
export interface ExecutionTask {
  id: string; // task uuid → deep-link to /tasks/[id]
  taskCode: string | null;
  title: string;
  stage: string;
  daysStuck: number | null; // whole days since entering the current stage
  delayDays: number | null; // working-days overdue, when the data exists
  // How overdue the task was, in calendar days: delay_days when present, else
  // (archived_at | today) − planned_date. Drives which ARCHIVED tasks are worth
  // surfacing in a full-period run ("the ones that had big delays").
  overdueDays: number | null;
  dueDate: string | null;
  stageEnteredAt: string | null;
  archived: boolean; // Odoo-archived task (historical; only in full-period runs)
  done: boolean; // task is completed (stage = done) — used by the delivery-state list
}

// Full-period runs surface only the WORST archived delays (not every archived
// task): those overdue by at least this many days, capped to the top few.
const ARCHIVED_BIG_DELAY_DAYS = 5;
const ARCHIVED_TASK_CAP = 5;
export interface ClientExecutionSnapshot {
  overdueCount: number;
  totalTasks: number;
  maxDaysStuck: number | null;
  byStage: Array<{ stage: string; count: number }>;
  // Where delay concentrates: each stuck stage as a % of all overdue tasks,
  // worst first (e.g. "70% عالق في Manager Review"). Drives the prompt's
  // Bottlenecks line and the UI.
  bottlenecks: Array<{ stage: string; count: number; pct: number }>;
  topTasks: ExecutionTask[]; // worst-stuck first
  // Actual delivery state, independent of overdue: the client's in-flight tasks
  // (stage not in new/done) plus recent completed milestones. Lets the AI
  // cross-check chat-derived claims ("الحملة لم تُطلق") against real task states
  // (إطلاق الحملة = done) instead of guessing. Includes archived tasks so a
  // wound-down client's delivery record stays visible.
  keyTasks: ExecutionTask[];
  // True when the ONLY tasks we could surface are Odoo-archived — i.e. the whole
  // project was wound down (lost/closed client). Signals the prompt to frame the
  // task data as the delivery record of a closed engagement, not "current work".
  allArchived: boolean;
}

async function _getClientExecutionSnapshot(
  orgId: string,
  clientId: string,
  includeArchived = false,
): Promise<ClientExecutionSnapshot | null> {
  // ALL of the client's projects (owned + WA-linked + twins), not just owned —
  // otherwise a split client's tasks are silently missed.
  const projectIds = await resolveClientProjectIds(orgId, clientId);
  if (projectIds.length === 0) return null;
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(
      "id, task_code, title, stage, delay_days, due_date, planned_date, stage_entered_at, is_overdue, archived_at",
    )
    .eq("organization_id", orgId)
    .in("project_id", projectIds);
  if (error || !data) return null;

  type Row = {
    id: string;
    task_code: string | null;
    title: string | null;
    stage: string | null;
    delay_days: number | null;
    due_date: string | null;
    planned_date: string | null;
    stage_entered_at: string | null;
    is_overdue: boolean | null;
    archived_at: string | null;
  };
  const rows = data as unknown as Row[];

  const now = Date.now();
  const daysSince = (iso: string | null): number | null =>
    iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000)) : null;
  // Overdue magnitude in calendar days: working-days delay_days when present,
  // else (archived_at | today) − planned_date. Used to rank archived tasks.
  const overdueDaysOf = (r: Row): number | null => {
    if (r.delay_days != null) return r.delay_days;
    if (!r.planned_date) return null;
    const ref = r.archived_at ? new Date(r.archived_at).getTime() : now;
    const d = Math.floor((ref - new Date(r.planned_date).getTime()) / 86_400_000);
    return d > 0 ? d : null;
  };
  const toTask = (r: Row): ExecutionTask => ({
    id: r.id,
    taskCode: r.task_code,
    title: (r.title ?? "").trim() || "—",
    stage: r.stage ?? "new",
    daysStuck: daysSince(r.stage_entered_at),
    delayDays: r.delay_days,
    overdueDays: overdueDaysOf(r),
    dueDate: r.due_date,
    stageEnteredAt: r.stage_entered_at,
    archived: !!r.archived_at,
    done: (r.stage ?? "") === "done",
  });

  // Odoo-archived tasks keep is_overdue=true forever (the flag is never cleared
  // on archive), so ~88% of "overdue" rows are archived work whose cycle ended.
  // Current/weekly view = LIVE overdue only. Full-period view additionally brings
  // the WORST archived delays (overdue ≥ ARCHIVED_BIG_DELAY_DAYS, top few) as
  // historical problems. See [[project_satisfaction_execution_scope_fix]].
  const overdueRows = rows.filter((r) => r.is_overdue);
  const liveTasks = overdueRows.filter((r) => !r.archived_at).map(toTask);
  const worstArchived = overdueRows
    .filter((r) => r.archived_at)
    .map(toTask)
    .filter((t) => (t.overdueDays ?? 0) >= ARCHIVED_BIG_DELAY_DAYS)
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0))
    .slice(0, ARCHIVED_TASK_CAP);
  // A wound-down (lost/closed) client has EVERY task archived, so the live-only
  // weekly view returns nothing and the AI is told "no tasks" — going blind on
  // exactly the client whose delivery history matters most. When there are no
  // live overdue tasks, fall back to the worst archived delays even in the weekly
  // view (flagged historical), so the analysis still sees the real delivery
  // record instead of a false "no delays". Active clients keep live tasks, so
  // this fallback never adds stale noise for them.
  // See [[project_satisfaction_execution_scope_fix]].
  const archivedBigDelay = includeArchived || liveTasks.length === 0 ? worstArchived : [];
  const tasks = [...liveTasks, ...archivedBigDelay];

  // Part 2 — actual delivery state, NOT gated on overdue. In-flight tasks (being
  // worked or awaiting the client) + recently completed milestones, archived or
  // not. This is what lets the model verify claims like "الحملة لم تُطلق" against
  // the real state (إطلاق الحملة = done) rather than guessing from chat alone.
  const IN_FLIGHT = new Set([
    "in_progress",
    "specialist_review",
    "manager_review",
    "ready_to_send",
    "sent_to_client",
    "client_changes",
  ]);
  const RECENT_DONE_DAYS = 60;
  const KEY_TASK_CAP = 26;
  // Live (non-archived) work first, then most recent. Keeps an active client's
  // current tasks ahead of any archived old-cycle rows; for a wound-down client
  // (all archived) it's a no-op but floats non-archived milestones up.
  const recency = (a: ExecutionTask, b: ExecutionTask) =>
    Number(a.archived) - Number(b.archived) ||
    (b.dueDate ?? "").localeCompare(a.dueDate ?? "") ||
    (b.stageEnteredAt ?? "").localeCompare(a.stageEnteredAt ?? "");
  // In-flight work (being worked / awaiting client) is the load-bearing signal —
  // it must NEVER be crowded out of the cap by completed tasks. Take ALL in-flight
  // first, then fill remaining slots with the most recent completed milestones.
  const inFlightTasks = rows
    .filter((r) => IN_FLIGHT.has(r.stage ?? ""))
    .map(toTask)
    .sort(recency);
  const recentDone = rows
    .filter((r) => {
      if ((r.stage ?? "") !== "done") return false;
      const d = daysSince(r.planned_date ?? r.stage_entered_at);
      return d != null && d <= RECENT_DONE_DAYS;
    })
    .map(toTask)
    .sort(recency);
  const keyTasks = [...inFlightTasks, ...recentDone].slice(0, KEY_TASK_CAP);

  // Wound-down = every in-flight task (being worked or awaiting client) is
  // Odoo-archived, i.e. the whole engagement was closed. Completed (done) tasks
  // may be non-archived without changing this — it's the LIVE work that's gone.
  const inFlightRows = rows.filter((r) => IN_FLIGHT.has(r.stage ?? ""));
  const allArchived = inFlightRows.length > 0 && inFlightRows.every((r) => !!r.archived_at);

  if (tasks.length === 0 && keyTasks.length === 0) return null;

  const stageCounts = new Map<string, number>();
  for (const t of tasks) stageCounts.set(t.stage, (stageCounts.get(t.stage) ?? 0) + 1);
  const byStage = Array.from(stageCounts.entries())
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  // Bottleneck = each stuck stage as a share of all overdue tasks. Keep the
  // stages that account for the bulk of the delay (top 3, or any ≥ 25%).
  const bottlenecks = byStage
    .map((s) => ({ stage: s.stage, count: s.count, pct: Math.round((s.count / tasks.length) * 100) }))
    .filter((s, i) => i < 3 || s.pct >= 25);

  // Live tasks first, then archived/historical; within each, worst-delay first.
  const topTasks = [...tasks]
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return (b.overdueDays ?? b.daysStuck ?? -1) - (a.overdueDays ?? a.daysStuck ?? -1);
    })
    .slice(0, 8);
  const maxDaysStuck = liveTasks.length
    ? Math.max(...liveTasks.map((t) => t.daysStuck ?? 0))
    : (topTasks[0]?.daysStuck ?? null);

  return {
    overdueCount: tasks.length,
    totalTasks: rows.length,
    maxDaysStuck,
    byStage,
    bottlenecks,
    topTasks,
    keyTasks,
    allArchived,
  };
}
export const getClientExecutionSnapshot = cache(_getClientExecutionSnapshot);

// ---- Client identity bridge (canonical client ↔ merged sheet twins) ------
// A real brand often exists as TWO+ client rows: the canonical (Odoo) row that
// carries the project + WhatsApp chats, and one or more SHEET rows that carry
// the contracts. They are tied by clients.merged_into_client_id (set sheet→Odoo
// at merge time) but the sheet row is never repointed, so a contract keyed on
// the sheet client_id is invisible to a lookup that uses only the canonical id.
// This is why ~76% of satisfaction analyses ran with an empty "حالة العقد" block
// even though the contract existed. These helpers resolve the FULL set of client
// ids whose contracts/activity belong to the same real client so the commercial
// dimension reaches the model.

// getClientMergeMap now lives in satisfaction-identity.ts (re-exported below so
// existing importers of it from this module keep working).

// Every client id that shares this client's commercial identity: itself, the
// rows merged INTO it (sheet twins), and — if it is itself a merged sheet row —
// its canonical parent plus that parent's other children (siblings). Contracts /
// activity logs are gathered across this whole set.
async function _getClientContractIdentity(orgId: string, clientId: string): Promise<string[]> {
  const merge = await getClientMergeMap(orgId);
  const canonical = merge.get(clientId) ?? clientId; // walk up one hop to the parent
  const ids = new Set<string>([clientId, canonical]);
  for (const [child, parent] of merge) {
    if (parent === canonical) ids.add(child); // siblings + direct children
  }
  return Array.from(ids);
}
export const getClientContractIdentity = cache(_getClientContractIdentity);

// ---- Client contract context (commercial dimension of the big picture) ----
// The client's current contract health, fed to the model so relationship +
// execution signals get weighed against the money on the line (a tense client
// on an Overdue contract is a very different situation than on a healthy one).
// A contract lifecycle event from the contracts activity log (contract_sheet_logs):
// HOLD / HOLD LIFTED / Contract Close (Lost|Renew) / EDIT MODE ON|OFF. These are
// behavioral commercial signals (the trajectory) the chat can't show.
export interface ContractActivityEvent {
  logType: string; // raw, e.g. "ON HOLD", "Contract Close (Lost)"
  logTime: string | null;
  notes: string | null;
  accountManager: string | null;
}

// Free-form strings as stored in the contracts sheet — real values include
// 'On Target', 'Overdue', 'Sales Deposit', 'Closed' (target) and
// active/hold/closed/expired/renewed/lost (status). NOT a fixed enum.
export type ContractTarget = string;
export type ContractStatus = string;

// One contract in the client's portfolio. A client commonly holds SEVERAL
// contracts at once (one per service/project) and renews into new rows over
// time, so the commercial picture is a portfolio — not a single contract.
export interface ContractLine {
  contractCode: string | null;
  target: ContractTarget;
  status: ContractStatus;
  totalValue: number;
  paidValue: number;
  // The sheet's own collection flag: 'Complete' | 'Installments' | null. This is
  // the SOURCE OF TRUTH for whether money is still owed — paidValue lags on
  // installment contracts, so a total−paid gap does NOT mean an outstanding due.
  paymentStatus: string | null;
  startDate: string;
  endDate: string | null;
}

export interface ClientContractContext {
  // ---- Top-level fields = the MOST-RECENT live contract (kept for the UI pill +
  // back-compat with analyses stored before multi-contract support). The numeric
  // values, however, are the PORTFOLIO SUM so totals reflect all live contracts. ----
  target: ContractTarget; // most-recent live contract's target (drives the pill)
  status: ContractStatus; // most-recent live contract's status
  totalValue: number; // SUM across the live contracts
  paidValue: number; // SUM across the live contracts
  startDate: string; // earliest start across the portfolio
  endDate: string | null; // latest end across the portfolio
  // ---- The actual portfolio the model reads ----
  contractCount: number; // number of contracts in `contracts`
  contracts: ContractLine[]; // all LIVE contracts (active/hold); else the most-recent one
  // Recent contract activity-log events (newest first), across ALL the client's
  // contracts, when available.
  recentActivity?: ContractActivityEvent[];
}

async function _getClientContractContext(
  orgId: string,
  clientId: string,
): Promise<ClientContractContext | null> {
  // ALL of the client's contracts across its full identity set — the contracts
  // usually live on a merged sheet twin, not the canonical (project/chat-bearing)
  // row the analysis is keyed on. A client may hold several at once AND have
  // renewed into older rows, so we never collapse to a single contract.
  const ids = await getClientContractIdentity(orgId, clientId);
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select("contract_code, target, status, total_value, paid_value, payment_status, start_date, end_date")
    .eq("organization_id", orgId)
    .in("client_id", ids)
    .order("start_date", { ascending: false });
  if (error || !data || data.length === 0) return null;

  type Row = {
    contract_code: string | null;
    target: ContractTarget | null;
    status: ContractStatus | null;
    total_value: number | null;
    paid_value: number | null;
    payment_status: string | null;
    start_date: string;
    end_date: string | null;
  };
  const rows = data as Row[];
  const toLine = (r: Row): ContractLine => ({
    contractCode: r.contract_code,
    target: r.target ?? "On-Target",
    status: r.status ?? "active",
    totalValue: r.total_value ?? 0,
    paidValue: r.paid_value ?? 0,
    paymentStatus: r.payment_status ?? null,
    startDate: r.start_date,
    endDate: r.end_date,
  });

  // The live portfolio = currently-running contracts (active/hold). If none are
  // live (all closed/lost), keep the most-recent single row so a churned client
  // still carries commercial context for the model.
  const live = rows.filter((r) => r.status === "active" || r.status === "hold").map(toLine);
  const contracts = live.length ? live : [toLine(rows[0])];

  // `contracts` is ordered newest-first (start_date desc), so contracts[0] is the
  // most-recent live contract — its target/status drive the UI pill exactly as
  // before. Numeric fields aggregate the whole live portfolio.
  const primary = contracts[0];
  const starts = contracts.map((c) => c.startDate).sort();
  const ends = contracts.map((c) => c.endDate).filter((e): e is string => !!e).sort();

  return {
    target: primary.target,
    status: primary.status,
    totalValue: contracts.reduce((s, c) => s + c.totalValue, 0),
    paidValue: contracts.reduce((s, c) => s + c.paidValue, 0),
    startDate: starts[0],
    endDate: ends.length ? ends[ends.length - 1] : null,
    contractCount: contracts.length,
    contracts,
  };
}
export const getClientContractContext = cache(_getClientContractContext);

// Recent contract activity-log events for the client (across all their
// contracts), newest first. Joins contract_sheet_logs → contracts on client_id.
// ~86% of log rows carry a contract_id; rows without one are skipped (inner join).
async function _getClientContractActivity(
  orgId: string,
  clientId: string,
): Promise<ContractActivityEvent[]> {
  const ids = await getClientContractIdentity(orgId, clientId);
  const { data, error } = await supabaseAdmin
    .from("contract_sheet_logs")
    .select("log_type, log_time, notes, account_manager, contract:contracts!inner(client_id)")
    .eq("organization_id", orgId)
    .in("contract.client_id", ids)
    .order("log_time", { ascending: false, nullsFirst: false })
    .limit(15);
  if (error || !data) return [];
  return (
    data as unknown as Array<{
      log_type: string;
      log_time: string | null;
      notes: string | null;
      account_manager: string | null;
    }>
  ).map((r) => ({
    logType: r.log_type,
    logTime: r.log_time,
    notes: r.notes,
    accountManager: r.account_manager,
  }));
}
export const getClientContractActivity = cache(_getClientContractActivity);

// ---- Org aggregate (feeds the Execution Quality executive index) ---------
export interface SatisfactionAggregate {
  avgSatisfaction: number | null;
  avgBriefAdherence: number | null;
  analyzedClients: number;
  atRiskClients: number; // current analyses with low score or negative sentiment
}

// A client is "at risk" when AI satisfaction is low or the sentiment is bad.
const AT_RISK_SCORE = 55;
export function isClientAtRisk(score: number | null, sentiment: string | null): boolean {
  if (sentiment === "negative") return true;
  if (score !== null && score < AT_RISK_SCORE) return true;
  return false;
}

// Client IDs that still represent a LIVE commercial relationship — an
// active/hold contract OR an active project. Satisfaction/churn signals must be
// scoped to these: a frozen analysis on an already-lost client (closed/lost
// contract, no live work) otherwise keeps surfacing as "at risk of being lost",
// which is exactly backwards — they're already gone. Used by the churn-risk
// card, the Quality executive index, and the per-client churn notifications.
async function _getLiveClientIds(orgId: string): Promise<Set<string>> {
  const [contracts, projects, merge] = await Promise.all([
    supabaseAdmin
      .from("contracts")
      .select("client_id")
      .eq("organization_id", orgId)
      .in("status", ["active", "hold"])
      .not("client_id", "is", null),
    supabaseAdmin
      .from("projects")
      .select("client_id")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .not("client_id", "is", null),
    getClientMergeMap(orgId),
  ]);
  // Analyses are keyed on the canonical (project/chat-bearing) client row, but a
  // live contract usually sits on the merged sheet twin. Canonicalize every id
  // through the merge map so a client that is "live" only via its contract twin
  // still matches its analysis row (otherwise it is wrongly dropped as non-live).
  const canon = (id: string) => merge.get(id) ?? id;
  const ids = new Set<string>();
  for (const r of (contracts.data ?? []) as Array<{ client_id: string | null }>)
    if (r.client_id) ids.add(canon(r.client_id));
  for (const r of (projects.data ?? []) as Array<{ client_id: string | null }>)
    if (r.client_id) ids.add(canon(r.client_id));
  return ids;
}
export const getLiveClientIds = cache(_getLiveClientIds);

// Client ids with a LIVE PROJECT (hasActiveProject) — the canonical CHURN scope.
// Derived from the satisfaction hub rows so the Quality/stability score, churn
// notifications, AI insights, and the CEO brief all count "at-risk clients" the
// SAME way: ACTIVE clients only (already-lost clients excluded). The team's rule
// is "lost clients don't matter", so this is preferred over the broader
// contract-OR-project getLiveClientIds for all satisfaction/churn scoping.
async function _getActiveProjectClientIds(orgId: string): Promise<Set<string>> {
  const rows = await getSatisfactionRows(orgId);
  return new Set(rows.filter((r) => r.hasActiveProject).map((r) => r.clientId));
}
export const getActiveProjectClientIds = cache(_getActiveProjectClientIds);

async function _getOrgSatisfactionAggregate(orgId: string): Promise<SatisfactionAggregate> {
  const [{ data, error }, activeIds] = await Promise.all([
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select("client_id, satisfaction_score, brief_adherence_score, sentiment")
      .eq("organization_id", orgId)
      .eq("is_current", true),
    getActiveProjectClientIds(orgId),
  ]);
  if (error || !data || data.length === 0) {
    return { avgSatisfaction: null, avgBriefAdherence: null, analyzedClients: 0, atRiskClients: 0 };
  }

  // Keep only analyses for ACTIVE clients (live project) — already-lost clients
  // skew the average down and inflate the at-risk count with names that can't
  // churn. Matches the /satisfaction page + CEO brief churn definition.
  const rows = (data as Array<{
    client_id: string | null;
    satisfaction_score: number | null;
    brief_adherence_score: number | null;
    sentiment: string | null;
  }>).filter((r) => r.client_id != null && activeIds.has(r.client_id));
  const sat = rows.map((r) => r.satisfaction_score).filter((v): v is number => v !== null);
  const brief = rows.map((r) => r.brief_adherence_score).filter((v): v is number => v !== null);
  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

  return {
    avgSatisfaction: avg(sat),
    avgBriefAdherence: avg(brief),
    analyzedClients: rows.length,
    atRiskClients: rows.filter((r) => isClientAtRisk(r.satisfaction_score, r.sentiment)).length,
  };
}
export const getOrgSatisfactionAggregate = cache(_getOrgSatisfactionAggregate);

// ---- WhatsApp group links (mapping admin) --------------------------------
export interface WaGroupLink {
  id: string;
  chatId: string;
  chatName: string | null;
  clientId: string | null;
  clientName: string | null;
  projectIds: string[]; // all projects this group serves (0203 many-to-many)
  groupKind: GroupKind | null;
  isActive: boolean;
  messageCount: number;
  memberCount: number | null;
  adminCount: number | null;
  lastMessageAt: string | null;
  coverageCount: number; // distinct connected numbers that contributed messages
}

async function _getWaGroupLinks(orgId: string): Promise<WaGroupLink[]> {
  const { data, error } = await supabaseAdmin
    .from("wa_group_links")
    .select(
      // Pin the client FK: wa_group_links has a second relationship to clients
      // (suggested_client_id), so an implicit embed fails with PGRST201 and
      // silently empties the whole list. See [[feedback_postgrest_ambiguous_embeds]].
      "id, chat_id, chat_name, client_id, group_kind, is_active, message_count, member_count, admin_count, last_message_at, client:clients!wa_group_links_client_id_fkey(name)",
    )
    .eq("organization_id", orgId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error || !data) return [];

  // All group→project links (0203 many-to-many). One group can serve several
  // projects of a multi-contract client, so we gather them per group_link_id.
  const projectsByLink = new Map<string, string[]>();
  const { data: gp } = await supabaseAdmin
    .from("wa_group_projects")
    .select("group_link_id, project_id")
    .eq("organization_id", orgId);
  for (const row of (gp ?? []) as Array<{ group_link_id: string; project_id: string }>) {
    const arr = projectsByLink.get(row.group_link_id) ?? [];
    arr.push(row.project_id);
    projectsByLink.set(row.group_link_id, arr);
  }

  // How many distinct connected numbers fed each group (provenance from 0200).
  const coverage = new Map<string, number>();
  const { data: cov } = await supabaseAdmin.rpc("get_wa_group_coverage", { p_org: orgId });
  for (const row of (cov ?? []) as Array<{ chat_id: string; account_count: number }>) {
    coverage.set(row.chat_id, row.account_count);
  }

  // Contract-sourced display names (source of truth) override the embedded name.
  const displayNames = await getClientDisplayNameMap(orgId);

  type Row = {
    id: string;
    chat_id: string;
    chat_name: string | null;
    client_id: string | null;
    group_kind: GroupKind | null;
    is_active: boolean;
    message_count: number;
    member_count: number | null;
    admin_count: number | null;
    last_message_at: string | null;
    client: { name: string } | { name: string }[] | null;
  };

  return (data as unknown as Row[]).map((r) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    return {
      id: r.id,
      chatId: r.chat_id,
      chatName: r.chat_name,
      clientId: r.client_id,
      clientName: (r.client_id ? displayNames.get(r.client_id) : null) ?? c?.name ?? null,
      projectIds: projectsByLink.get(r.id) ?? [],
      groupKind: r.group_kind,
      isActive: r.is_active,
      messageCount: r.message_count,
      memberCount: r.member_count,
      adminCount: r.admin_count,
      lastMessageAt: r.last_message_at,
      coverageCount: coverage.get(r.chat_id) ?? 0,
    };
  });
}
export const getWaGroupLinks = cache(_getWaGroupLinks);

// Lightweight project options for the group-mapping selector.
export async function listProjectOptions(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, project_code, client_id, status")
    .eq("organization_id", orgId)
    .order("status")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

// ---- Pending auto-link suggestions (the confirmation queue) ---------------
// Low-confidence group→client matches the auto-linker parked for a human to
// confirm/reject (see migration 0166). Only unlinked, non-dismissed rows.
export interface WaLinkSuggestion {
  id: string;
  chatId: string;
  chatName: string | null;
  suggestedClientId: string;
  suggestedClientName: string | null;
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  suggestedProjectCode: string | null;
  confidence: "exact" | "high" | "low" | null;
  groupKind: GroupKind | null;
  suggestedAt: string | null;
}

async function _getWaLinkSuggestions(orgId: string): Promise<WaLinkSuggestion[]> {
  const { data, error } = await supabaseAdmin
    .from("wa_group_links")
    .select(
      "id, chat_id, chat_name, suggested_client_id, suggested_project_id, suggested_confidence, suggested_at, group_kind, client:clients!wa_group_links_suggested_client_id_fkey(name), project:projects!wa_group_links_suggested_project_id_fkey(name, project_code)",
    )
    .eq("organization_id", orgId)
    .not("suggested_client_id", "is", null)
    .is("client_id", null)
    .is("suggestion_dismissed_at", null)
    .order("suggested_at", { ascending: false, nullsFirst: false });
  if (error || !data) return [];

  // Contract-sourced display names (source of truth) override the embedded name.
  const displayNames = await getClientDisplayNameMap(orgId);

  type Row = {
    id: string;
    chat_id: string;
    chat_name: string | null;
    suggested_client_id: string;
    suggested_project_id: string | null;
    suggested_confidence: "exact" | "high" | "low" | null;
    suggested_at: string | null;
    group_kind: GroupKind | null;
    client: { name: string } | { name: string }[] | null;
    project:
      | { name: string; project_code: string | null }
      | { name: string; project_code: string | null }[]
      | null;
  };

  return (data as unknown as Row[]).map((r) => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    const p = Array.isArray(r.project) ? r.project[0] : r.project;
    return {
      id: r.id,
      chatId: r.chat_id,
      chatName: r.chat_name,
      suggestedClientId: r.suggested_client_id,
      suggestedClientName: displayNames.get(r.suggested_client_id) ?? c?.name ?? null,
      suggestedProjectId: r.suggested_project_id,
      suggestedProjectName: p?.name ?? null,
      suggestedProjectCode: p?.project_code ?? null,
      confidence: r.suggested_confidence,
      groupKind: r.group_kind,
      suggestedAt: r.suggested_at,
    };
  });
}
export const getWaLinkSuggestions = cache(_getWaLinkSuggestions);

// ---- Project group coverage (every project must have a client + team group)
// The team's rule: each ACTIVE project needs BOTH a 💫 client group and a 📍
// team group. A group serves a project when it is EXPLICITLY linked to it via
// wa_group_projects (0203 many-to-many — one shared client group can now cover
// every project of a multi-contract client). Fallback for groups not yet given
// any explicit project: credit the client's groups when the client has exactly
// one active project. The reverse (groups with no project) is intentionally
// ignored.
export interface ProjectCoverageGap {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  clientId: string | null;
  clientName: string | null;
  hasClientGroup: boolean;
  hasTechnicalGroup: boolean;
}

async function _getProjectGroupCoverage(orgId: string): Promise<ProjectCoverageGap[]> {
  const [projectsRes, linksRes, gpRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, project_code, client_id, status, client:clients(name)")
      .eq("organization_id", orgId)
      .neq("status", "archived"),
    supabaseAdmin
      .from("wa_group_links")
      .select("id, client_id, group_kind, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    supabaseAdmin
      .from("wa_group_projects")
      .select("group_link_id, project_id")
      .eq("organization_id", orgId),
  ]);
  const projects = (projectsRes.data ?? []) as Array<{
    id: string;
    name: string;
    project_code: string | null;
    client_id: string | null;
    status: string | null;
    client: { name: string } | { name: string }[] | null;
  }>;
  const links = (linksRes.data ?? []) as Array<{
    id: string;
    client_id: string | null;
    group_kind: GroupKind | null;
  }>;

  // Contract-sourced display names (source of truth) override the embedded name.
  const displayNames = await getClientDisplayNameMap(orgId);

  // group_link_id → set of explicitly linked project ids (0203).
  const projSetByLink = new Map<string, Set<string>>();
  for (const r of (gpRes.data ?? []) as Array<{ group_link_id: string; project_id: string }>) {
    const s = projSetByLink.get(r.group_link_id) ?? new Set<string>();
    s.add(r.project_id);
    projSetByLink.set(r.group_link_id, s);
  }

  // Active-project count per client → decides whether a group that has no
  // explicit project link yet can be attributed to a single project.
  const activeByClient = new Map<string, number>();
  for (const p of projects) {
    if (p.status === "active" && p.client_id)
      activeByClient.set(p.client_id, (activeByClient.get(p.client_id) ?? 0) + 1);
  }

  const gaps: ProjectCoverageGap[] = [];
  for (const p of projects) {
    const singleActive = !!p.client_id && activeByClient.get(p.client_id) === 1;
    let hasClient = false;
    let hasTech = false;
    for (const l of links) {
      const projSet = projSetByLink.get(l.id);
      const belongs =
        (!!projSet && projSet.has(p.id)) ||
        (!projSet && singleActive && !!l.client_id && l.client_id === p.client_id);
      if (!belongs) continue;
      if (l.group_kind === "client") hasClient = true;
      else if (l.group_kind === "technical") hasTech = true;
    }
    if (hasClient && hasTech) continue;
    const c = Array.isArray(p.client) ? p.client[0] : p.client;
    gaps.push({
      projectId: p.id,
      projectName: p.name,
      projectCode: p.project_code,
      clientId: p.client_id,
      clientName: (p.client_id ? displayNames.get(p.client_id) : null) ?? c?.name ?? null,
      hasClientGroup: hasClient,
      hasTechnicalGroup: hasTech,
    });
  }
  // Worst first: missing both, then missing one.
  gaps.sort(
    (a, b) =>
      Number(a.hasClientGroup) + Number(a.hasTechnicalGroup) -
      (Number(b.hasClientGroup) + Number(b.hasTechnicalGroup)),
  );
  return gaps;
}
export const getProjectGroupCoverage = cache(_getProjectGroupCoverage);

// ---- At-risk clients (for the Executive AI report + drill-down) ----------
export interface AtRiskClient {
  clientId: string;
  clientName: string;
  satisfactionScore: number | null;
  sentiment: string | null;
  topRisk: string | null;
}

async function _getAtRiskClients(orgId: string): Promise<AtRiskClient[]> {
  const [{ data, error }, activeIds, displayNames] = await Promise.all([
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select("client_id, satisfaction_score, sentiment, risks, client:clients!inner(name)")
      .eq("organization_id", orgId)
      .eq("is_current", true),
    getActiveProjectClientIds(orgId),
    getClientDisplayNameMap(orgId),
  ]);
  if (error || !data) return [];

  type Row = {
    client_id: string;
    satisfaction_score: number | null;
    sentiment: string | null;
    risks: string[] | null;
    client: { name: string } | { name: string }[] | null;
  };

  return (data as unknown as Row[])
    .filter((r) => r.client_id != null && activeIds.has(r.client_id))
    .filter((r) => isClientAtRisk(r.satisfaction_score, r.sentiment))
    .map((r) => {
      const c = Array.isArray(r.client) ? r.client[0] : r.client;
      return {
        clientId: r.client_id,
        clientName: displayNames.get(r.client_id) ?? c?.name ?? "—",
        satisfactionScore: r.satisfaction_score,
        sentiment: r.sentiment,
        topRisk: r.risks && r.risks.length > 0 ? r.risks[0] : null,
      };
    })
    .sort((a, b) => (a.satisfactionScore ?? 100) - (b.satisfactionScore ?? 100));
}
export const getAtRiskClients = cache(_getAtRiskClients);
