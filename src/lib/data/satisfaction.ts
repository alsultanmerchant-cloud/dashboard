import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SatisfactionResult } from "@/lib/satisfaction-schema";

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

export interface AnalysisInfo extends SatisfactionResult {
  id: string;
  model: string | null;
  createdAt: string;
}

export interface SatisfactionRow {
  clientId: string;
  clientName: string;
  hasClient: boolean;
  hasTechnical: boolean;
  satisfactionScore: number | null;
  briefAdherenceScore: number | null;
  sentiment: string | null;
  analyzedAt: string | null;
}

// ---- Hub overview: every client that has an import or analysis -----------
async function _getSatisfactionRows(orgId: string): Promise<SatisfactionRow[]> {
  const [importsRes, analysesRes, clientsRes] = await Promise.all([
    supabaseAdmin
      .from("client_chat_imports")
      .select("client_id, group_kind")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("client_satisfaction_analyses")
      .select("client_id, satisfaction_score, brief_adherence_score, sentiment, created_at")
      .eq("organization_id", orgId)
      .eq("is_current", true),
    supabaseAdmin.from("clients").select("id, name").eq("organization_id", orgId),
  ]);
  if (importsRes.error) throw importsRes.error;
  if (analysesRes.error) throw analysesRes.error;
  if (clientsRes.error) throw clientsRes.error;

  const names = new Map<string, string>();
  for (const c of (clientsRes.data ?? []) as Array<{ id: string; name: string }>) {
    names.set(c.id, c.name);
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
  analysis: AnalysisInfo | null;
}

async function _getClientSatisfactionDetail(
  orgId: string,
  clientId: string,
): Promise<ClientSatisfactionDetail | null> {
  const [clientRes, importsRes, analysisRes] = await Promise.all([
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
      .select(
        "id, satisfaction_score, brief_adherence_score, sentiment, summary, highlights, sentiment_timeline, risks, model, created_at",
      )
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (clientRes.error) throw clientRes.error;
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

  let analysis: AnalysisInfo | null = null;
  const a = analysisRes.data as Record<string, unknown> | null;
  if (a) {
    analysis = {
      id: a.id as string,
      satisfactionScore: (a.satisfaction_score as number) ?? 0,
      briefAdherenceScore: (a.brief_adherence_score as number | null) ?? null,
      sentiment: (a.sentiment as SatisfactionResult["sentiment"]) ?? "neutral",
      summary: (a.summary as string) ?? "",
      highlights: (a.highlights as SatisfactionResult["highlights"]) ?? [],
      sentimentTimeline: (a.sentiment_timeline as SatisfactionResult["sentimentTimeline"]) ?? [],
      risks: (a.risks as string[]) ?? [],
      model: (a.model as string | null) ?? null,
      createdAt: a.created_at as string,
    };
  }

  return {
    clientId,
    clientName: clientRes.data.name as string,
    imports: { client: clientImp, technical: techImp },
    analysis,
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
): Promise<MergedTranscripts> {
  const [importsRes, waRes] = await Promise.all([
    supabaseAdmin
      .from("client_chat_imports")
      .select("group_kind, transcript, created_at")
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("wa_messages")
      .select("group_kind, sender, body, sent_at, message_type")
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .order("sent_at", { ascending: true })
      .limit(8000),
  ]);

  // Latest one-time import per kind (historical seed).
  const importByKind: Record<GroupKind, string> = { client: "", technical: "" };
  for (const r of (importsRes.data ?? []) as Array<{ group_kind: GroupKind; transcript: string }>) {
    if (!importByKind[r.group_kind]) importByKind[r.group_kind] = r.transcript ?? "";
  }

  // Live messages per kind (text only, non-empty).
  const liveByKind: Record<GroupKind, string[]> = { client: [], technical: [] };
  const counts: Record<GroupKind, number> = { client: 0, technical: 0 };
  for (const r of (waRes.data ?? []) as Array<{
    group_kind: GroupKind | null;
    sender: string | null;
    body: string | null;
    sent_at: string | null;
    message_type: string | null;
  }>) {
    if (!r.group_kind) continue;
    const type = r.message_type ?? "chat";
    if (type !== "chat" && type !== "text") continue;
    const body = (r.body ?? "").trim();
    if (!body) continue;
    liveByKind[r.group_kind].push(renderWaLine(r.sent_at, r.sender, body));
    counts[r.group_kind] += 1;
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
