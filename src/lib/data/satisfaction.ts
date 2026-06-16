import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SatisfactionResult } from "@/lib/satisfaction-schema";
import { getClientBriefRef, type ClientBriefRef } from "@/lib/satisfaction-brief";

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
  // The contract snapshot fed to the model when the analysis ran (UI shows the
  // pill; the model used it for the commercial dimension of the big picture).
  contractContext: ClientContractContext | null;
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
  hasActiveProject: boolean; // false → archived/lost (has projects, ALL archived); separated in the UI
  manuallyArchived: boolean; // operator flagged clients.status !== 'active'
  satisfactionScore: number | null;
  briefAdherenceScore: number | null;
  sentiment: string | null;
  analyzedAt: string | null;
}

// ---- Hub overview: every client that has an import or analysis -----------
async function _getSatisfactionRows(orgId: string): Promise<SatisfactionRow[]> {
  const [importsRes, analysesRes, clientsRes, projectsRes, linksRes] = await Promise.all([
    supabaseAdmin
      .from("client_chat_imports")
      .select("client_id, group_kind")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select("client_id, satisfaction_score, brief_adherence_score, sentiment, created_at")
      .eq("organization_id", orgId)
      .eq("is_current", true),
    supabaseAdmin.from("clients").select("id, name, status").eq("organization_id", orgId),
    supabaseAdmin
      .from("projects")
      .select("id, client_id, status")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("wa_group_links")
      .select("client_id, message_count, project_id")
      .eq("organization_id", orgId)
      .not("client_id", "is", null),
  ]);
  if (importsRes.error) throw importsRes.error;
  if (analysesRes.error) throw analysesRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (linksRes.error) throw linksRes.error;

  const names = new Map<string, string>();
  // Manual archive flag: clients.status !== 'active' (e.g. 'archived'/'lost'/
  // 'cancelled') is an explicit override — the relationship is dead even if a
  // project still looks active (cancelled contract not yet archived in Rawasm).
  const manualStatus = new Map<string, string | null>();
  for (const c of (clientsRes.data ?? []) as Array<{ id: string; name: string; status: string | null }>) {
    names.set(c.id, c.name);
    manualStatus.set(c.id, c.status);
  }

  // Archived rule. A client is "lost/archived" when EITHER:
  //  - it is manually flagged (clients.status !== 'active'), OR
  //  - every project it is associated with is archived.
  // "Associated" means projects it OWNS *plus* projects its WhatsApp groups
  // LINK TO — because duplicate client rows split the relationship: the group
  // is mapped to a project-less copy while the real (archived) project lives on
  // the twin (e.g. مجوهرات نها / جزيرة الريف). Following the group link's
  // project_id recovers the true status. A client with NO associated project
  // at all stays active (genuine no-signal duplicate/sheet case).
  const projectStatusById = new Map<string, string | null>();
  const ownedStatuses = new Map<string, string[]>();
  for (const p of (projectsRes.data ?? []) as Array<{ id: string; client_id: string | null; status: string | null }>) {
    projectStatusById.set(p.id, p.status);
    if (!p.client_id) continue;
    const arr = ownedStatuses.get(p.client_id) ?? [];
    arr.push(p.status ?? "");
    ownedStatuses.set(p.client_id, arr);
  }
  // Projects reached via each client's WhatsApp group links (may belong to a twin).
  const linkedProjectIds = new Map<string, Set<string>>();
  for (const l of (linksRes.data ?? []) as Array<{ client_id: string | null; project_id: string | null }>) {
    if (!l.client_id || !l.project_id) continue;
    const s = linkedProjectIds.get(l.client_id) ?? new Set<string>();
    s.add(l.project_id);
    linkedProjectIds.set(l.client_id, s);
  }

  const isActiveClient = (clientId: string) => {
    const st = manualStatus.get(clientId);
    if (st && st !== "active") return false; // manual archive/cancel wins
    const statuses: Array<string | null> = [...(ownedStatuses.get(clientId) ?? [])];
    for (const pid of linkedProjectIds.get(clientId) ?? []) {
      if (projectStatusById.has(pid)) statuses.push(projectStatusById.get(pid)!);
    }
    if (statuses.length === 0) return true; // no project signal → keep active
    return statuses.some((s) => s !== "archived"); // any non-archived project → active
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
  analysis: AnalysisInfo | null; // the shown analysis (selected, else current week)
  history: AnalysisHistoryItem[]; // all stored snapshots, newest first
  activeProjects: Array<{ id: string; name: string }>;
  brief: ClientBriefRef | null; // the attached brief doc (reachable link/file), if any
}

const ANALYSIS_COLUMNS =
  "id, satisfaction_score, brief_adherence_score, sentiment, summary, highlights, sentiment_timeline, risks, recommendations, indicators, client_group_signals, technical_group_signals, causes, contract_context, big_picture, model, created_at, window_kind, window_start, window_end";

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
  responseSpeed: "unknown",
};
const EMPTY_TECH_SIGNALS: SatisfactionResult["technicalGroupSignals"] = {
  blockers: [],
  delayCauses: [],
  accountEvaluation: [],
};

function toAnalysisInfo(a: Record<string, unknown>): AnalysisInfo {
  return {
    id: a.id as string,
    satisfactionScore: (a.satisfaction_score as number) ?? 0,
    briefAdherenceScore: (a.brief_adherence_score as number | null) ?? null,
    sentiment: (a.sentiment as SatisfactionResult["sentiment"]) ?? "neutral",
    summary: (a.summary as string) ?? "",
    bigPicture: (a.big_picture as SatisfactionResult["bigPicture"]) ?? EMPTY_BIG_PICTURE,
    indicators: (a.indicators as SatisfactionResult["indicators"]) ?? [],
    clientGroupSignals:
      (a.client_group_signals as SatisfactionResult["clientGroupSignals"]) ?? EMPTY_CLIENT_SIGNALS,
    technicalGroupSignals:
      (a.technical_group_signals as SatisfactionResult["technicalGroupSignals"]) ?? EMPTY_TECH_SIGNALS,
    causes: (a.causes as SatisfactionResult["causes"]) ?? [],
    highlights: (a.highlights as SatisfactionResult["highlights"]) ?? [],
    sentimentTimeline: (a.sentiment_timeline as SatisfactionResult["sentimentTimeline"]) ?? [],
    risks: (a.risks as string[]) ?? [],
    recommendations: (a.recommendations as SatisfactionResult["recommendations"]) ?? [],
    contractContext: (a.contract_context as ClientContractContext | null) ?? null,
    model: (a.model as string | null) ?? null,
    createdAt: a.created_at as string,
    windowKind: ((a.window_kind as string) ?? "all") as WindowKind,
    windowStart: (a.window_start as string | null) ?? null,
    windowEnd: (a.window_end as string | null) ?? null,
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

async function _getClientSatisfactionDetail(
  orgId: string,
  clientId: string,
  selectedAnalysisId?: string | null,
): Promise<ClientSatisfactionDetail | null> {
  const [clientRes, importsRes, analysisRes, historyRes, messagesRes, projectsRes, brief] = await Promise.all([
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
    supabaseAdmin
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("client_id", clientId),
    supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    getClientBriefRef(orgId, clientId),
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
    clientName: clientRes.data.name as string,
    imports: { client: clientImp, technical: techImp },
    hasMessages: (messagesRes.count ?? 0) > 0,
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
}

function renderWaLine(sentAt: string | null, sender: string | null, body: string): string {
  const ts = sentAt ? sentAt.slice(0, 16).replace("T", " ") : "?";
  return `[${ts}] ${sender ?? "—"}: ${body}`;
}

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

  let waQuery = supabaseAdmin
    .from("wa_messages")
    .select("group_kind, sender, body, sent_at, message_type")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("sent_at", { ascending: true })
    .limit(8000);
  if (since) waQuery = waQuery.gte("sent_at", since);

  const [importsRes, waRes] = await Promise.all([
    since
      ? Promise.resolve({ data: [] as Array<{ group_kind: GroupKind; transcript: string }> })
      : supabaseAdmin
          .from("client_chat_imports")
          .select("group_kind, transcript, created_at")
          .eq("organization_id", orgId)
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
    waQuery,
  ]);

  // Latest one-time import per kind (historical seed; empty for windowed runs).
  const importByKind: Record<GroupKind, string> = { client: "", technical: "" };
  for (const r of (importsRes.data ?? []) as Array<{ group_kind: GroupKind; transcript: string }>) {
    if (!importByKind[r.group_kind]) importByKind[r.group_kind] = r.transcript ?? "";
  }

  // Live messages per kind (text only, non-empty). Messages linked to this
  // client but whose group_kind is still unclassified (null) default to the
  // CLIENT block — they're this client's conversation and dropping them
  // silently skewed satisfaction scores too rosy (whole groups vanished).
  const liveByKind: Record<GroupKind, string[]> = { client: [], technical: [] };
  const counts: Record<GroupKind, number> = { client: 0, technical: 0 };
  for (const r of (waRes.data ?? []) as Array<{
    group_kind: GroupKind | null;
    sender: string | null;
    body: string | null;
    sent_at: string | null;
    message_type: string | null;
  }>) {
    const kind: GroupKind = r.group_kind ?? "client";
    const type = r.message_type ?? "chat";
    if (type !== "chat" && type !== "text") continue;
    const body = (r.body ?? "").trim();
    if (!body) continue;
    liveByKind[kind].push(renderWaLine(r.sent_at, r.sender, body));
    counts[kind] += 1;
  }

  const merge = (kind: GroupKind) =>
    [importByKind[kind], liveByKind[kind].join("\n")].filter(Boolean).join("\n");

  return {
    client: merge("client"),
    technical: merge("technical"),
    clientMessages: counts.client,
    technicalMessages: counts.technical,
  };
}
export const buildClientTranscripts = cache(_buildClientTranscripts);

// ---- Client execution snapshot (ties satisfaction to real delivery work) -
// Surfaces the client's actually-delayed tasks next to the AI analysis, so a
// "تأخير" complaint maps to concrete delayed work and the stage it's stuck in.
// Date columns (due_date/delay_days) are sparse for Odoo-synced tasks, so the
// primary "how late" signal is days stuck in the current stage (stage_entered_at,
// fully populated). Stage grouping shows whether delays cluster in one phase.
export interface ExecutionTask {
  taskCode: string | null;
  title: string;
  stage: string;
  daysStuck: number | null; // whole days since entering the current stage
  delayDays: number | null; // working-days overdue, when the data exists
  dueDate: string | null;
  stageEnteredAt: string | null;
}
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
}

async function _getClientExecutionSnapshot(
  orgId: string,
  clientId: string,
): Promise<ClientExecutionSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(
      "task_code, title, stage, delay_days, due_date, stage_entered_at, is_overdue, project:projects!inner(client_id, status)",
    )
    .eq("organization_id", orgId)
    .eq("project.client_id", clientId)
    .neq("project.status", "archived");
  if (error || !data) return null;

  type Row = {
    task_code: string | null;
    title: string | null;
    stage: string | null;
    delay_days: number | null;
    due_date: string | null;
    stage_entered_at: string | null;
    is_overdue: boolean | null;
  };
  const rows = data as unknown as Row[];
  const overdue = rows.filter((r) => r.is_overdue);
  if (overdue.length === 0) return null;

  const now = Date.now();
  const daysSince = (iso: string | null): number | null =>
    iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000)) : null;

  const tasks: ExecutionTask[] = overdue.map((r) => ({
    taskCode: r.task_code,
    title: (r.title ?? "").trim() || "—",
    stage: r.stage ?? "new",
    daysStuck: daysSince(r.stage_entered_at),
    delayDays: r.delay_days,
    dueDate: r.due_date,
    stageEnteredAt: r.stage_entered_at,
  }));

  const stageCounts = new Map<string, number>();
  for (const t of tasks) stageCounts.set(t.stage, (stageCounts.get(t.stage) ?? 0) + 1);
  const byStage = Array.from(stageCounts.entries())
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  // Bottleneck = each stuck stage as a share of all overdue tasks. Keep the
  // stages that account for the bulk of the delay (top 3, or any ≥ 25%).
  const bottlenecks = byStage
    .map((s) => ({ stage: s.stage, count: s.count, pct: Math.round((s.count / overdue.length) * 100) }))
    .filter((s, i) => i < 3 || s.pct >= 25);

  const topTasks = [...tasks]
    .sort((a, b) => (b.daysStuck ?? -1) - (a.daysStuck ?? -1))
    .slice(0, 8);
  const maxDaysStuck = topTasks.length ? topTasks[0].daysStuck : null;

  return {
    overdueCount: overdue.length,
    totalTasks: rows.length,
    maxDaysStuck,
    byStage,
    bottlenecks,
    topTasks,
  };
}
export const getClientExecutionSnapshot = cache(_getClientExecutionSnapshot);

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

export interface ClientContractContext {
  target: "On-Target" | "Overdue" | "Lost" | "Renewed";
  status: "active" | "hold" | "lost" | "closed" | "renewed";
  totalValue: number;
  paidValue: number;
  startDate: string;
  endDate: string | null;
  // Recent contract activity-log events (newest first), when available.
  recentActivity?: ContractActivityEvent[];
}

async function _getClientContractContext(
  orgId: string,
  clientId: string,
): Promise<ClientContractContext | null> {
  // Most-recent contract for the client (a client may renew into several rows;
  // the newest start_date is the live one).
  const { data, error } = await supabaseAdmin
    .from("contracts")
    .select("target, status, total_value, paid_value, start_date, end_date")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as {
    target: ClientContractContext["target"] | null;
    status: ClientContractContext["status"] | null;
    total_value: number | null;
    paid_value: number | null;
    start_date: string;
    end_date: string | null;
  };
  return {
    target: r.target ?? "On-Target",
    status: r.status ?? "active",
    totalValue: r.total_value ?? 0,
    paidValue: r.paid_value ?? 0,
    startDate: r.start_date,
    endDate: r.end_date,
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
  const { data, error } = await supabaseAdmin
    .from("contract_sheet_logs")
    .select("log_type, log_time, notes, account_manager, contract:contracts!inner(client_id)")
    .eq("organization_id", orgId)
    .eq("contract.client_id", clientId)
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

async function _getOrgSatisfactionAggregate(orgId: string): Promise<SatisfactionAggregate> {
  const { data, error } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("satisfaction_score, brief_adherence_score, sentiment")
    .eq("organization_id", orgId)
    .eq("is_current", true);
  if (error || !data || data.length === 0) {
    return { avgSatisfaction: null, avgBriefAdherence: null, analyzedClients: 0, atRiskClients: 0 };
  }

  const rows = data as Array<{
    satisfaction_score: number | null;
    brief_adherence_score: number | null;
    sentiment: string | null;
  }>;
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
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  groupKind: GroupKind | null;
  isActive: boolean;
  messageCount: number;
  memberCount: number | null;
  adminCount: number | null;
  lastMessageAt: string | null;
}

async function _getWaGroupLinks(orgId: string): Promise<WaGroupLink[]> {
  const { data, error } = await supabaseAdmin
    .from("wa_group_links")
    .select(
      "id, chat_id, chat_name, client_id, project_id, group_kind, is_active, message_count, member_count, admin_count, last_message_at, client:clients(name), project:projects(name, project_code)",
    )
    .eq("organization_id", orgId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error || !data) return [];

  type Row = {
    id: string;
    chat_id: string;
    chat_name: string | null;
    client_id: string | null;
    project_id: string | null;
    group_kind: GroupKind | null;
    is_active: boolean;
    message_count: number;
    member_count: number | null;
    admin_count: number | null;
    last_message_at: string | null;
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
      clientId: r.client_id,
      clientName: c?.name ?? null,
      projectId: r.project_id,
      projectName: p?.name ?? null,
      projectCode: p?.project_code ?? null,
      groupKind: r.group_kind,
      isActive: r.is_active,
      messageCount: r.message_count,
      memberCount: r.member_count,
      adminCount: r.admin_count,
      lastMessageAt: r.last_message_at,
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
      suggestedClientName: c?.name ?? null,
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
// team group. Groups link client-centrically (client_id + optional project_id),
// so we resolve a project's groups as: explicit project_id matches, PLUS the
// client's project-less groups when the client has exactly one active project
// (mirrors the matcher's own client→project resolution). The reverse (groups
// with no project) is fine and intentionally ignored.
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
  const [projectsRes, linksRes] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, project_code, client_id, status, client:clients(name)")
      .eq("organization_id", orgId)
      .neq("status", "archived"),
    supabaseAdmin
      .from("wa_group_links")
      .select("client_id, project_id, group_kind, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true),
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
    client_id: string | null;
    project_id: string | null;
    group_kind: GroupKind | null;
  }>;

  // Active-project count per client → decides whether project-less client
  // groups can be attributed to a single project unambiguously.
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
      const belongs =
        l.project_id === p.id ||
        (!l.project_id && singleActive && l.client_id === p.client_id);
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
      clientName: c?.name ?? null,
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
  const { data, error } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("client_id, satisfaction_score, sentiment, risks, client:clients!inner(name)")
    .eq("organization_id", orgId)
    .eq("is_current", true);
  if (error || !data) return [];

  type Row = {
    client_id: string;
    satisfaction_score: number | null;
    sentiment: string | null;
    risks: string[] | null;
    client: { name: string } | { name: string }[] | null;
  };

  return (data as unknown as Row[])
    .filter((r) => isClientAtRisk(r.satisfaction_score, r.sentiment))
    .map((r) => {
      const c = Array.isArray(r.client) ? r.client[0] : r.client;
      return {
        clientId: r.client_id,
        clientName: c?.name ?? "—",
        satisfactionScore: r.satisfaction_score,
        sentiment: r.sentiment,
        topRisk: r.risks && r.risks.length > 0 ? r.risks[0] : null,
      };
    })
    .sort((a, b) => (a.satisfactionScore ?? 100) - (b.satisfactionScore ?? 100));
}
export const getAtRiskClients = cache(_getAtRiskClients);
