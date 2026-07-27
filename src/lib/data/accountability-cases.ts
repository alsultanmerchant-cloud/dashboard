import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getAccountabilityCaseOverview,
  getAccountabilityLiveTotals,
  type AccountabilityCaseOverview,
  type AccountabilityLiveTotals,
} from "@/lib/data/accountability";
import { getClientFinanceMap, type ClientFinanceMap } from "@/lib/data/client-finance";
import { isLeadershipPosition } from "@/lib/data/leadership";
import { foldResolutionOverlayEvents } from "@/lib/satisfaction-recommendation-status";

// =========================================================================
// Accountability Cases (/accountability — القضايا) — a Problems & Proof
// engine. Instead of a per-person score, the unit is a CASE: WHO + WHAT +
// PROOF, drawn from THREE independent evidence streams that already exist in
// the company's data but were never joined:
//
//   • execution  — the Odoo delivery mirror (overdue/stuck tasks in the
//                  person's OWNED stage, operational silence, rework, review
//                  rigor). Source of truth for "is the work moving".
//   • client     — the WhatsApp satisfaction analyses, which already name a
//                  responsible person + task codes + an evidence chain per
//                  complaint (client_satisfaction_analyses.accountability).
//   • commercial — the contract book: an account-manager whose client raised
//                  a cancellation / competitor threat (churn indicators) is a
//                  revenue relationship at risk under their name.
//
// The POWER MOVE is corroboration: a case is ranked by how many independent
// streams agree about the same person.
//   1 stream  → signal   (إشارة)
//   2 streams → proven    (مثبتة)      — e.g. a complaint's task code is a
//               task actually stuck in that person's stage.
//   3 streams → critical  (حرجة)
// Hard operational silence (open tasks + zero authored actions in 30 days)
// escalates a lone execution case to "proven" — that is the "prove they are
// not working" signal the business asked for.
//
// EVERYTHING here is code-computed fact. The AI's ONLY contribution is the
// verbatim client quote, which the UI badges as AI-sourced. The page NEVER
// tells anyone what to do — advice is opt-in (a separate button, Phase 3).
//
// Names in the client stream are free-text roster names; they resolve to an
// employee by exact full_name (verified 33/33 today). Unmatched names are
// surfaced as text on the case, never silently dropped.
// =========================================================================

export type CaseStream = "execution" | "client" | "commercial";
export type CaseSeverity = "critical" | "proven" | "signal";

// A specific task a proof points at. The UI renders these as clickable
// "<title> · <project>" chips that deep-link to /tasks/[id] — never a raw code
// like "PRJ-01798-045", which no operator can act on. Any proof that references
// concrete tasks (AI complaints citing a task, rework rebounds) carries these.
export interface TaskRef {
  taskId: string;
  code: string | null;
  title: string;
  projectName: string | null;
}

export interface CaseProof {
  stream: CaseStream;
  kind:
    | "overdue_task"
    | "silent"
    | "low_activity"
    | "rework"
    | "slow_review"
    | "pending_review"
    | "complaint"
    | "churn";
  text: string; // code-generated factual Arabic line
  quote: string | null; // AI-sourced client quote (badged separately in UI)
  href: string | null; // deep link to the underlying evidence
  taskCode: string | null;
  clientName: string | null;
  clientId: string | null; // canonical client — joins the case to contract value
  stage: string | null; // raw stage enum on task proofs — feeds stage clustering
  date: string | null; // YYYY-MM-DD
  crossLinked: boolean; // this proof's task/client also appears in another stream
  // For execution overdue/stuck-task proofs: actions the responsible owner
  // logged on THIS task since it entered the stuck stage, and the length of that
  // window in days. Rendered as a chip ("0 إجراء · 12 يوم") that turns a bare
  // "this task is late" into proof of neglect. null on non-task proofs.
  ownerActions?: number | null;
  windowDays?: number | null;
  // Specific tasks this proof concerns, resolved to name + project + id so the
  // UI can link straight to them. Empty/absent when the proof is not tied to
  // identifiable tasks.
  taskRefs?: TaskRef[];
  // Task proofs only: past its deadline (vs merely idle in its current stage).
  // `windowDays` counts days in the CURRENT stage, so an overdue task that just
  // changed stage has windowDays 0 — the two facts are independent and callers
  // must not read staleness off the deadline or vice-versa.
  overdue?: boolean;
  // Stable per-problem identity, assigned once in the assembly step below. The
  // per-problem status + reopen store keys off this, so it MUST be deterministic
  // across re-detections: the same underlying problem yields the same key each
  // load. Always set on emitted proofs (optional only so the push sites don't
  // have to repeat it). See problemKeyFor().
  problemKey?: string;
}

export interface CaseLedger {
  actions30d: number;
  activeDays: number; // distinct days with an authored action in the window
  lastActionAt: string | null;
  daysSinceLastAction: number | null;
  openTasks: number; // total open tasks assigned to the person (live)
  overdueOwned: number; // subset past their delivery deadline today (0257)
  onTimeRate: number | null;
  liveContracts: number; // live contracts owned as account manager (context)
  // P4 ledger polish — a 14-day activity heatmap, silent working-days, and how
  // this person's workload/output compares to the team median.
  dailyActivity: { date: string; count: number }[]; // last 14 days, oldest→newest
  silentWorkingDays14: number; // Sun–Thu days in the last 14 with zero actions
  peerMedianOpen: number; // team median open tasks
  peerMedianActions: number; // team median 30-day actions
}

// What this case puts at stake, in the only unit a CEO budgets in: clients and
// riyals. The money here is UNCOLLECTED money tied to the affected clients —
// not their total contract value (that read as the person's portfolio size and
// said nothing about the problem):
//   • dueValue     — unpaid installments already past their expected date
//   • renewalValue — expected renewal money (sheet "Value of repeated services")
//                    on the clients' live contracts
// Still NOT a loss forecast — a stuck task does not forfeit a renewal — but it
// is the money a stalled relationship actually threatens.
// `unpricedClients` are affected clients with no contract row at all (the
// Odoo-only client population — value UNKNOWN, not zero, and never "churned").
// One client's uncollected money, with the contracts behind each amount.
export interface ClientMoney {
  due: number; // overdue unpaid installments (already late)
  dueCodes: string[]; // contract codes those installments belong to
  monthDue: number; // unpaid installments still ahead inside this month
  monthDueCodes: string[];
  renewal: number; // expected renewal (repeated services) on live contracts
  renewalContracts: { code: string | null; name: string | null }[];
}

export interface CaseImpact {
  clients: number; // distinct affected clients
  pricedClients: number; // …of which carry a live contract (value is known)
  unpricedClients: number; // …of which have no contract row → unknown value
  dueValue: number; // SAR: overdue unpaid installments across affected clients
  renewalValue: number; // SAR: expected renewal on affected clients' live contracts
  atStakeValue: number; // dueValue + renewalValue — ranking input
  // Per-client breakdown (canonical client id → SAR). The band's ask badges
  // read THIS, scoped to the one client the ask is about — a case-wide sum
  // beside a single-client ask read as the person's portfolio, not the
  // problem's money (client feedback, twice). Each amount carries its
  // PROVENANCE (contract codes / sheet-twin names): contracts live on the
  // twin under its commercial name, so a bare number can't be checked
  // against the sheet without it.
  moneyByClient: Record<string, ClientMoney>;
  churnClients: string[]; // affected clients who threatened to leave
  financeFlagClients: string[]; // affected clients with overdue installments
}

export interface AccountabilityCase {
  employeeId: string | null; // null = unmatched roster name (shown as text)
  employeeName: string;
  role: string | null; // position label
  department: string | null;
  problemTags: string[]; // WHAT — distinct problem types, Arabic
  streams: CaseStream[]; // distinct streams with evidence, canonical order
  severity: CaseSeverity;
  proof: CaseProof[]; // cross-linked first, then by stream
  clientNames: string[];
  clientIds: string[]; // canonical ids of the affected clients
  impact: CaseImpact;
  ledger: CaseLedger | null;
  sort: number;
}

export interface AccountabilityCasesResult {
  generatedAt: string;
  cases: AccountabilityCase[];
  meta: {
    people: number;
    critical: number;
    proven: number;
    signal: number;
    streamsAvailable: CaseStream[]; // which streams produced any evidence
    unmatchedNames: string[];
    // Distinct tasks that WOULD have been execution evidence but are parked by
    // decision (HOLD/LOST tag, or a dashboard hold). Surfaced so the band can
    // state what it set aside rather than silently reporting a smaller number.
    heldTasksExcluded: number;
  };
}

// Red satisfaction indicator codes that mean the COMMERCIAL relationship is at
// risk (revenue, not just a grumble) — the account manager's stream.
const CHURN_CODES = new Set([
  "client_threatened_cancellation",
  "client_compared_competitor",
]);

// Per-stream evidence caps so a card stays readable.
const MAX_EXEC_TASKS = 6;
const STUCK_MIN_DAYS = 5; // a non-overdue owned task idle this long is still "stuck"

// ---- "Parked by decision" ------------------------------------------------
// Deliberately paused work is not neglected work: if somebody decided to stop a
// task, its missed deadline and its silence are consequences of THAT decision,
// not evidence against whoever holds it. Three ways a task can be parked:
//   • an Odoo HOLD/LOST tag on the task itself (project.task.tag_ids)
//   • the same tag on its PROJECT — the whole engagement is frozen or the client
//     is gone (the convention /satisfaction uses to bucket a client as lost)
//   • the dashboard's own per-task hold (tasks.hold_since, migration 0023)
// Shared by BOTH evidence paths, because filtering only the execution stream
// left the same held task visible as an AI-cited complaint (client stream).
//
// "CURRENTLY parked" — the liveness gate matters. Most HOLD tags in prod sit on
// tasks that are long finished (109 tagged org-wide, only ~6 open): the tag is
// never cleaned up when work resumes or completes. Without the open/non-archived
// test, a stale tag on a DELIVERED task would silence a real complaint about it.
// stuckSql already restricts to open work, so this is belt-and-braces there and
// load-bearing for the complaint stream, which resolves codes with no such gate.
//
// NOTE: agent_run_readonly_sql rejects write/DDL keywords word-boundary-wise
// ANYWHERE in a query, prose included — keep wording here clear of them.
const ON_HOLD_SQL = (t: string) => `(
  ${t}.stage <> 'done' and ${t}.archived_at is null and (
  ${t}.hold_since is not null
  or exists (
       select 1 from task_tag_assignments tta
         join project_tags g on g.id = tta.tag_id
        where tta.task_id = ${t}.id and upper(g.name) in ('HOLD','LOST'))
  or exists (
       select 1 from project_tag_assignments pta
         join project_tags g2 on g2.id = pta.tag_id
        where pta.project_id = ${t}.project_id and upper(g2.name) in ('HOLD','LOST'))
))`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(v: string, label: string): string {
  if (!UUID_RE.test(v)) throw new Error(`accountability-cases: invalid ${label}`);
  return v.toLowerCase();
}

async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`accountability-cases query failed: ${error.message}`);
  return (data ?? []) as T[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Task codes look like PRJ-01798-045 (migration 0050). The AI sometimes lists
// them in `taskCodes` and sometimes only inside the prose, so we scan both.
const TASK_CODE_RE = /PRJ-\d+-\d+/g;

// Remove a task code (bracketed or bare, with any "المهمة/رقم" label) from AI
// text once we render it as a linkable chip — otherwise the code is repeated.
function stripTaskCode(text: string, code: string | null): string {
  if (!text || !code) return text;
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\s*(?:المهمة\\s*|رقم\\s*)?\\[?\\s*${esc}\\s*\\]?`, "g"), " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([،.,:])/g, "$1")
    .trim();
}

const SEVERITY_RANK: Record<CaseSeverity, number> = { critical: 3, proven: 2, signal: 1 };
const STREAM_ORDER: Record<CaseStream, number> = { execution: 0, client: 1, commercial: 2 };

// ---- raw row shapes --------------------------------------------------------
interface EmpRow {
  id: string;
  full_name: string | null;
  position_label: string | null;
  department: string | null;
  // From positions (via position_id) — feeds isLeadershipPosition, the same
  // rule every performance table uses (src/lib/data/leadership.ts).
  position_role: string | null;
  position_name: string | null;
}
interface LedgerRow {
  actor_employee_id: string;
  actions: number;
  active_days: number;
  last_at: string | null;
  daily: { d: string; n: number }[];
}
interface StuckRow {
  employee_id: string;
  task_id: string;
  task_code: string | null;
  title: string | null;
  stage: string;
  overdue: boolean;
  // The stage's SLA limit from sla_rules, or null when the template defines no
  // limit for it (جديد / قيد التنفيذ). Null ⇒ the task can NEVER be reported as
  // "stuck" — only a missed deadline can make it a case.
  stage_sla_minutes: number | null;
  days_in_stage: number | null;
  last_action: string | null;
  // How many actions (notes / stage moves) the RESPONSIBLE owner logged on THIS
  // task since it entered the current (stuck) stage — the "prove the problem"
  // number. 0 over many days = neglect.
  owner_actions_in_stage: number | null;
  client_id: string | null;
  client_name: string | null;
  project_name: string | null;
  // Deliberately parked: HOLD/LOST tag on the task or its project, or the
  // dashboard's own per-task hold. Never counted as a problem — see stuckSql.
  on_hold: boolean;
}
interface ClientValueRow {
  client_id: string;
  renewal_value: number;
  live: number;
  // Provenance of the renewal money: sheet-twin client name + contract code
  // per live contract carrying a repeated-services value (renewal desc).
  renewal_contracts: { code: string | null; name: string | null; renewal: number }[];
}
interface TaskRefRow {
  task_id: string;
  task_code: string | null;
  title: string | null;
  project_name: string | null;
  on_hold: boolean;
}
interface ReworkTaskRow {
  employee_id: string;
  task_id: string;
  task_code: string | null;
  title: string | null;
  project_name: string | null;
}
interface ContractRow {
  account_manager_name: string | null;
  live: number;
}
interface ClientAnalysisRow {
  analysis_id: string;
  client_id: string;
  client_name: string | null;
  accountability: unknown;
  indicators: unknown;
}

// A responsible entry as stored by the satisfaction analyses.
interface ResponsibleJson {
  name?: string;
  role?: string;
  basis?: string;
}
interface AccountabilityJson {
  complaint?: string;
  finding?: string;
  evidence?: string;
  service?: string | null;
  confidence?: string;
  taskCodes?: string[];
  responsible?: ResponsibleJson[];
}

// Every task code an analysis row cites — the structured `taskCodes` plus any
// PRJ-…-… the model wrote only into the prose. Deduped, order-stable.
function rowTaskCodes(row: AccountabilityJson): string[] {
  const set = new Set<string>();
  for (const c of Array.isArray(row.taskCodes) ? row.taskCodes : []) if (c) set.add(c);
  const blob = `${row.finding ?? ""} ${row.complaint ?? ""} ${row.evidence ?? ""}`;
  for (const m of blob.matchAll(TASK_CODE_RE)) set.add(m[0]);
  return [...set];
}
interface IndicatorJson {
  code?: string;
  severity?: string;
  label?: string;
  evidence?: string;
  date?: string | null;
}

// Mutable accumulator per employee while detectors fire.
interface Bucket {
  employeeId: string | null;
  employeeName: string;
  role: string | null;
  department: string | null;
  proof: CaseProof[];
  tags: Set<string>;
  clients: Set<string>;
  clientIds: Set<string>;
  hardSilent: boolean;
  // A case needs at least one MATERIAL proof (an overdue task, silence, rework,
  // a client complaint, a churn, a review problem, or a badly-stuck task).
  // Soft signals alone (low activity, a mildly-idle task) don't make a case.
  material: boolean;
  execTaskCodes: Set<string>; // for cross-linking with client taskCodes
}

// A non-overdue owned task idle at least this long counts as a material stuck.
const STUCK_MATERIAL_DAYS = 10;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

function daysBetween(fromIso: string | null, nowMs: number): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 86_400_000));
}

// Small deterministic string hash (djb2) — only used to give a stable id to a
// problem that has no natural key (a client complaint with no cited task code).
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function taskIdFromHref(href: string | null): string | null {
  const m = href?.match(/\/tasks\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

// The identity of a problem WITHIN one person's file. Combined with the employee
// id (below) it forms the global problem key. Deterministic by design:
//   • a task problem IS the task (code, else its id, else a text hash);
//   • a complaint IS the client + the cited task (else a hash of the finding, so
//     two different complaints on one client stay distinct);
//   • churn IS the client;
//   • the operational signals (silence / low activity / rework / review rigor)
//     are one-open-problem-per-person, so they carry no discriminator.
function problemDiscriminator(p: CaseProof): string {
  switch (p.kind) {
    case "overdue_task":
      return p.taskCode ?? taskIdFromHref(p.href) ?? djb2(p.text);
    case "complaint":
      return `${p.clientId ?? "?"}:${p.taskCode ?? djb2(norm(p.text))}`;
    case "churn":
      return p.clientId ?? "?";
    default:
      return "";
  }
}

async function _getAccountabilityCases(
  orgId: string,
  overview?: AccountabilityCaseOverview,
): Promise<AccountabilityCasesResult> {
  const org = assertUuid(orgId, "organization id");

  // The scorecard/reviewer overview is the execution backbone (already cached).
  // Each supporting evidence read degrades to empty so a single timeout cannot
  // take the whole page down.
  const [
    ov,
    liveTotals,
    emps,
    ledger,
    stuck,
    contracts,
    analyses,
    clientValues,
    financeMap,
    reworkTasks,
  ] = await Promise.all([
    overview ? Promise.resolve(overview) : getAccountabilityCaseOverview(orgId),
    getAccountabilityLiveTotals(orgId).catch((e) => {
      console.error("[cases] live desk totals failed:", e);
      return {} as Record<string, AccountabilityLiveTotals>;
    }),
    runSql<EmpRow>(empSql(org)).catch((e) => {
      console.error("[cases] empSql failed:", e);
      return [] as EmpRow[];
    }),
    runSql<LedgerRow>(ledgerSql(org)).catch((e) => {
      console.error("[cases] ledgerSql failed:", e);
      return [] as LedgerRow[];
    }),
    runSql<StuckRow>(stuckSql(org)).catch((e) => {
      console.error("[cases] stuckSql failed:", e);
      return [] as StuckRow[];
    }),
    runSql<ContractRow>(contractsSql(org)).catch((e) => {
      console.error("[cases] contractsSql failed:", e);
      return [] as ContractRow[];
    }),
    runSql<ClientAnalysisRow>(analysesSql(org)).catch((e) => {
      console.error("[cases] analysesSql failed:", e);
      return [] as ClientAnalysisRow[];
    }),
    runSql<ClientValueRow>(clientValueSql(org)).catch((e) => {
      console.error("[cases] clientValueSql failed:", e);
      return [] as ClientValueRow[];
    }),
    getClientFinanceMap(orgId).catch((e) => {
      console.error("[cases] financeMap failed:", e);
      return {} as ClientFinanceMap;
    }),
    runSql<ReworkTaskRow>(reworkTasksSql(org)).catch((e) => {
      console.error("[cases] reworkTasksSql failed:", e);
      return [] as ReworkTaskRow[];
    }),
  ]);

  // Per-employee list of the tasks behind their rework count (capped for UI).
  const reworkTasksByEmp = new Map<string, TaskRef[]>();
  for (const r of reworkTasks) {
    const list = reworkTasksByEmp.get(r.employee_id) ?? [];
    if (list.length < 6) {
      list.push({
        taskId: r.task_id,
        code: r.task_code,
        title: (r.title ?? "").trim() || "مهمة",
        projectName: r.project_name,
      });
    }
    reworkTasksByEmp.set(r.employee_id, list);
  }

  const nowMs = Date.now();

  // 14-day date axis (Riyadh calendar dates, oldest→newest) for the heatmap.
  const axis14: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(nowMs - i * 86_400_000);
    axis14.push(d.toISOString().slice(0, 10));
  }
  const dailyByEmp = new Map<string, Map<string, number>>();
  for (const r of ledger) {
    let m = dailyByEmp.get(r.actor_employee_id);
    if (!m) {
      m = new Map();
      dailyByEmp.set(r.actor_employee_id, m);
    }
    for (const day of r.daily) m.set(day.d, day.n);
  }
  // Team medians (peer comparison) across all measured employees.
  const peerMedianOpen =
    median(
      ov.rows.map(
        (r) => liveTotals[r.employeeId]?.openLive ?? r.openTasks,
      ),
    ) ?? 0;
  const peerMedianActions = median(ledger.map((l) => l.actions)) ?? 0;
  // Sun–Thu working day? getUTCDay: 0=Sun … 4=Thu, 5=Fri, 6=Sat.
  const isWorkingDay = (iso: string) => {
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return dow !== 5 && dow !== 6;
  };
  const buildDaily = (employeeId: string) => {
    const m = dailyByEmp.get(employeeId);
    const dailyActivity = axis14.map((date) => ({ date, count: m?.get(date) ?? 0 }));
    const silentWorkingDays14 = dailyActivity.filter(
      (d) => isWorkingDay(d.date) && d.count === 0,
    ).length;
    return { dailyActivity, silentWorkingDays14 };
  };

  // Identity maps.
  const empById = new Map<string, EmpRow>();
  const empByName = new Map<string, EmpRow>();
  for (const e of emps) {
    empById.set(e.id, e);
    if (e.full_name) empByName.set(norm(e.full_name), e);
  }
  const scoreByEmp = new Map(ov.rows.map((r) => [r.employeeId, r]));
  const ledgerByEmp = new Map(ledger.map((l) => [l.actor_employee_id, l]));
  const contractsByName = new Map<string, number>();
  for (const c of contracts) {
    if (c.account_manager_name) contractsByName.set(norm(c.account_manager_name), c.live);
  }

  // Resolve every task code the AI cited across the analyses to a linkable task
  // (name + project + id). One extra indexed lookup, off the Promise.all because
  // it depends on the analyses payload. Degrades to an empty map on failure.
  const complaintCodes = new Set<string>();
  for (const a of analyses) {
    const rows = Array.isArray(a.accountability) ? (a.accountability as AccountabilityJson[]) : [];
    for (const row of rows) for (const c of rowTaskCodes(row)) complaintCodes.add(c);
  }
  const taskRefByCode = new Map<string, TaskRef>();
  // Cited codes that resolve to a task parked by decision. A code we could NOT
  // resolve is deliberately absent: unknown is not held, so an unresolvable
  // citation never silences a complaint.
  const heldCodes = new Set<string>();
  if (complaintCodes.size > 0) {
    const refs = await runSql<TaskRefRow>(taskRefsSql(org, [...complaintCodes])).catch((e) => {
      console.error("[cases] taskRefsSql failed:", e);
      return [] as TaskRefRow[];
    });
    for (const r of refs)
      if (r.task_code) {
        taskRefByCode.set(r.task_code, {
          taskId: r.task_id,
          code: r.task_code,
          title: (r.title ?? "").trim() || "مهمة",
          projectName: r.project_name,
        });
        if (r.on_hold) heldCodes.add(r.task_code);
      }
  }

  // The satisfaction resolution overlay: append-only ai_events that close a
  // finding (manual "تأكيد أنها حُلّت" or the AI refresh pass) without mutating
  // the frozen analysis. A complaint whose issue key — its exact `complaint`
  // text — is currently resolved must not keep feeding a live case here.
  // Keyed per (analysis, issue) since issue text could collide across clients.
  // Degrades to empty (= nothing filtered) on failure.
  const resolvedIssuesByAnalysis = new Map<string, Set<string>>();
  if (analyses.length > 0) {
    const { data: overlayEvents, error: overlayError } = await supabaseAdmin
      .from("ai_events")
      .select("entity_id, payload, created_at")
      .eq("organization_id", org)
      .eq("event_type", "SATISFACTION_RECOMMENDATION_STATUS_CHANGED")
      .eq("entity_type", "satisfaction_analysis")
      .in(
        "entity_id",
        analyses.map((a) => a.analysis_id),
      )
      .order("created_at", { ascending: true });
    if (overlayError) {
      console.error("[cases] resolution overlay failed:", overlayError.message);
    } else {
      const eventsByAnalysis = new Map<
        string,
        Array<{ payload: unknown; created_at: string }>
      >();
      for (const event of overlayEvents ?? []) {
        if (!event.entity_id) continue;
        const list = eventsByAnalysis.get(event.entity_id) ?? [];
        list.push(event);
        eventsByAnalysis.set(event.entity_id, list);
      }
      for (const [analysisId, events] of eventsByAnalysis) {
        const resolved = new Set<string>();
        for (const [issue, entry] of foldResolutionOverlayEvents(events))
          if (entry.state === "resolved") resolved.add(issue);
        if (resolved.size > 0) resolvedIssuesByAnalysis.set(analysisId, resolved);
      }
    }
  }

  const buckets = new Map<string, Bucket>();
  const streamsAvailable = new Set<CaseStream>();
  const unmatched = new Set<string>();

  const bucketFor = (
    key: string,
    seed: () => Omit<
      Bucket,
      "proof" | "tags" | "clients" | "clientIds" | "hardSilent" | "material" | "execTaskCodes"
    >,
  ): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = {
        ...seed(),
        proof: [],
        tags: new Set(),
        clients: new Set(),
        clientIds: new Set(),
        hardSilent: false,
        material: false,
        execTaskCodes: new Set(),
      };
      buckets.set(key, b);
    }
    return b;
  };

  const empBucket = (employeeId: string): Bucket => {
    const e = empById.get(employeeId);
    const sc = scoreByEmp.get(employeeId);
    return bucketFor(`emp:${employeeId}`, () => ({
      employeeId,
      employeeName: e?.full_name ?? sc?.fullName ?? "—",
      role: sc?.positionLabel ?? e?.position_label ?? null,
      department: e?.department ?? null,
    }));
  };

  // ---- EXECUTION: overdue / stuck owned tasks ----
  const stuckByEmp = new Map<string, StuckRow[]>();
  // Parked work set aside (HOLD/LOST tag, or a dashboard hold). Reported in
  // meta so the band can say what it excluded instead of silently shrinking.
  const heldTaskIds = new Set<string>();
  for (const s of stuck) {
    // A held task is paused BY DECISION — its deadline slipping and its silence
    // are both consequences of that decision, not evidence against the person.
    // Dropped before either arm is evaluated so neither can resurrect it.
    if (s.on_hold) {
      heldTaskIds.add(s.task_id);
      continue;
    }
    // Mirrors stuckSql's two arms. A stage with no SLA can only qualify by
    // missing its DEADLINE — never by sitting, however long it sits.
    const stuckEligible = s.stage_sla_minutes !== null;
    if (!s.overdue && (!stuckEligible || (s.days_in_stage ?? 0) < STUCK_MIN_DAYS)) continue;
    const arr = stuckByEmp.get(s.employee_id);
    if (arr) arr.push(s);
    else stuckByEmp.set(s.employee_id, [s]);
  }
  for (const [employeeId, rows] of stuckByEmp) {
    const b = empBucket(employeeId);
    streamsAvailable.add("execution");
    const top = rows
      .sort((a, z) => (z.days_in_stage ?? 0) - (a.days_in_stage ?? 0))
      .slice(0, MAX_EXEC_TASKS);
    let anyOverdue = false;
    for (const s of top) {
      if (s.overdue) anyOverdue = true;
      if (s.overdue || (s.stage_sla_minutes !== null && (s.days_in_stage ?? 0) >= STUCK_MATERIAL_DAYS))
        b.material = true;
      if (s.task_code) b.execTaskCodes.add(s.task_code);
      if (s.client_id) b.clientIds.add(s.client_id);
      if (s.client_name) b.clients.add(s.client_name);
      const d = s.days_in_stage ?? 0;
      const owner = s.owner_actions_in_stage ?? 0;
      // The proof: what did the OWNER actually do on this task while it sat stuck?
      const actionTxt =
        owner === 0
          ? `دون أي إجراء منه عليها طوال هذه المدة`
          : `سجّل عليها ${arCount(owner, "إجراء", "إجراءين", "إجراءات")} خلال هذه المدة${s.last_action ? ` (آخر إجراء ${s.last_action})` : ""}`;
      // Lead with the PROJECT name (the id is meaningless to a reader — the
      // task title carries the identity). Keep the client only when the project
      // name doesn't already carry it, to avoid "…- Chic Boutique (Chic Boutique)".
      const projectName = (s.project_name ?? "").trim() || s.client_name || "مشروع";
      const clientTag = s.client_name && !projectName.includes(s.client_name) ? ` (${s.client_name})` : "";
      b.proof.push({
        stream: "execution",
        kind: "overdue_task",
        // Lead with the failure that actually qualified the task. A missed
        // DEADLINE is the finding; how long it has sat is context. Only say
        // «عالقة» when the stage has a defined limit it has overstayed —
        // otherwise a long-lived execution stage reads as a fault when it isn't.
        text: s.overdue
          ? `${projectName} — ${(s.title ?? "").trim() || "بدون عنوان"}${clientTag} تجاوزت موعد تسليمها وما زالت في ${stageAr(s.stage)} منذ ${d} يومًا — ${actionTxt}.`
          : `${projectName} — ${(s.title ?? "").trim() || "بدون عنوان"}${clientTag} عالقة في ${stageAr(s.stage)} منذ ${d} يومًا رغم أن مهلة المرحلة ${slaLabel(s.stage_sla_minutes)} — ${actionTxt}.`,
        quote: null,
        href: `/tasks/${s.task_id}`,
        taskCode: s.task_code,
        clientName: s.client_name,
        clientId: s.client_id,
        stage: s.stage,
        date: s.last_action,
        crossLinked: false,
        ownerActions: owner,
        windowDays: d,
        overdue: s.overdue,
      });
    }
    b.tags.add(anyOverdue ? "تأخير تسليم" : "تعثّر مرحلة");
  }

  // ---- EXECUTION: operational silence / rework (from scorecard + ledger) ----
  for (const r of ov.rows) {
    const l = ledgerByEmp.get(r.employeeId);
    const actions = l?.actions ?? 0;
    // Hard silence: has open owned work but authored nothing in 30 days.
    if (r.openTasks > 0 && actions === 0) {
      const b = empBucket(r.employeeId);
      streamsAvailable.add("execution");
      b.hardSilent = true;
      b.material = true;
      b.tags.add("صمت تشغيلي");
      b.proof.push({
        stream: "execution",
        kind: "silent",
        text: `${r.openTasks} مهمة مفتوحة تحت مسؤوليته، وصفر إجراء مسجّل (ملاحظة أو نقل مرحلة) خلال آخر ٣٠ يومًا.`,
        quote: null,
        href: `/accountability`,
        taskCode: null,
        clientName: null,
        clientId: null,
        stage: null,
        date: l?.last_at ? l.last_at.slice(0, 10) : null,
        crossLinked: false,
      });
    } else if (r.openTasks >= 3 && (l?.active_days ?? 0) <= 2 && actions < 10) {
      const b = empBucket(r.employeeId);
      streamsAvailable.add("execution");
      b.tags.add("نشاط منخفض");
      b.proof.push({
        stream: "execution",
        kind: "low_activity",
        text: `${r.openTasks} مهمة مفتوحة، لكن نشاطه اقتصر على ${l?.active_days ?? 0} يوم عمل و${actions} إجراء خلال ٣٠ يومًا.`,
        quote: null,
        href: `/accountability`,
        taskCode: null,
        clientName: null,
        clientId: null,
        stage: null,
        date: l?.last_at ? l.last_at.slice(0, 10) : null,
        crossLinked: false,
      });
    }

    if (r.reworkReturns30d > 0) {
      const b = empBucket(r.employeeId);
      streamsAvailable.add("execution");
      b.material = true;
      b.tags.add("ارتداد عمل");
      const reworkRefs = reworkTasksByEmp.get(r.employeeId) ?? [];
      b.proof.push({
        stream: "execution",
        kind: "rework",
        text: `${r.reworkReturns30d} ارتداد إلى تنفيذ/تعديلات العميل خلال آخر ٣٠ يومًا — عمل رجع بعد أن تقدّم.`,
        quote: null,
        // The proof carries its own task links; keep the card anchored here only
        // when we could not resolve any rebounded task.
        href: reworkRefs.length ? null : `/accountability`,
        taskCode: null,
        taskRefs: reworkRefs,
        clientName: null,
        clientId: null,
        stage: null,
        date: null,
        crossLinked: false,
      });
    }
  }

  // ---- EXECUTION: review rigor (rubber-stamp + pending backlog) ----
  for (const section of [ov.reviewers.managerReview, ov.reviewers.specialistReview]) {
    for (const rv of section) {
      const low = rv.confidence === "low";
      if (!low && rv.fastReviewShare !== null && rv.fastReviewShare >= 30) {
        const b = empBucket(rv.employeeId);
        streamsAvailable.add("execution");
        b.material = true;
        b.tags.add("مراجعة متساهلة");
        b.proof.push({
          stream: "execution",
          kind: "slow_review",
          text: `${rv.fastReviewCount} من ${rv.reviewsCompleted} تاسك مراجَع أُغلق في أقل من ١٠ دقائق عمل — مؤشر مراجعة شكلية.`,
          quote: null,
          href: `/accountability`,
          taskCode: null,
          clientName: null,
          clientId: null,
          stage: null,
          date: null,
          crossLinked: false,
        });
      }
      if (rv.pendingReviews >= 3) {
        const b = empBucket(rv.employeeId);
        streamsAvailable.add("execution");
        b.material = true;
        b.tags.add("مراجعات معلّقة");
        const oldest =
          rv.oldestPendingBusinessMinutes !== null
            ? ` أقدمها منتظرة ${Math.round(rv.oldestPendingBusinessMinutes / 60)} ساعة عمل`
            : "";
        b.proof.push({
          stream: "execution",
          kind: "pending_review",
          text: `${rv.pendingReviews} مراجعة تنتظر قراره${oldest} — العمل متوقف على اعتماده.`,
          quote: null,
          href: `/accountability`,
          taskCode: null,
          clientName: null,
          clientId: null,
          stage: null,
          date: null,
          crossLinked: false,
        });
      }
    }
  }

  // ---- CLIENT + COMMERCIAL: satisfaction accountability + churn ----
  for (const a of analyses) {
    const rows = Array.isArray(a.accountability) ? (a.accountability as AccountabilityJson[]) : [];
    const inds = Array.isArray(a.indicators) ? (a.indicators as IndicatorJson[]) : [];
    const churn = inds.filter((i) => i.code && CHURN_CODES.has(i.code) && i.severity === "red");
    const clientName = a.client_name ?? "عميل";
    const resolvedIssues = resolvedIssuesByAnalysis.get(a.analysis_id);

    for (const row of rows) {
      // Overlay-resolved complaint — no longer an open problem. Skipping it
      // before any bucket side effects also lets the daily materializer
      // auto-resolve the persisted case/problem rows; a later `cleared` event
      // re-surfaces it (→ 'reopened'). Churn indicators below are not
      // issue-keyed, so they intentionally still see every row.
      if (row.complaint && resolvedIssues?.has(row.complaint)) continue;
      // Parked-by-decision, the client-stream half. Filtering only the execution
      // stream left a held task still on the band as an AI-cited complaint —
      // exactly the row the client pointed at. An accountability row whose ONLY
      // cited tasks are held is blaming somebody for work that was stopped on
      // purpose. A row citing no task at all is untouched: that is pure client
      // voice with no paused work behind it. Mixed rows survive on the live task.
      const citedCodes = rowTaskCodes(row);
      if (citedCodes.length > 0 && citedCodes.every((c) => heldCodes.has(c))) {
        for (const c of citedCodes) {
          const ref = taskRefByCode.get(c);
          if (ref) heldTaskIds.add(ref.taskId);
        }
        continue;
      }
      const responsible = Array.isArray(row.responsible) ? row.responsible : [];
      // Leadership dedup. The analyses name the direct owner AND the escalation
      // chain (basis team_manager; team leads also match as plain assignees
      // because they sit on every team task) — so one complaint fanned out to
      // 2–3 people and the SAME problem ranked twice on the band (سلمى #1 and
      // her head اية #3, word for word). Attribution rule: the case belongs to
      // the non-leadership responsible; a leader carries it ONLY when nobody
      // else was named, so a problem can never vanish. Same leadership
      // definition as every performance table (src/lib/data/leadership.ts).
      const resolvedResp: EmpRow[] = [];
      for (const resp of responsible) {
        if (!resp.name) continue;
        const m = empByName.get(norm(resp.name));
        if (!m) unmatched.add(resp.name);
        else if (!resolvedResp.some((r) => r.id === m.id)) resolvedResp.push(m);
      }
      const directOwners = resolvedResp.filter(
        (m) => !isLeadershipPosition({ role: m.position_role, name: m.position_name }),
      );
      for (const match of directOwners.length > 0 ? directOwners : resolvedResp) {
        streamsAvailable.add("client");
        const b = empBucket(match.id);
        b.material = true;
        b.tags.add("شكوى عميل");
        b.clients.add(clientName);
        if (a.client_id) b.clientIds.add(a.client_id);
        // Cross-link: this complaint cites a task actually stuck in their stage.
        const codes = rowTaskCodes(row);
        const crossLinked = codes.some((c) => b.execTaskCodes.has(c));
        // Resolve cited codes to linkable tasks; strip the raw codes from the
        // text so we don't print an unclickable "PRJ-…" next to the chip.
        const taskRefs = codes
          .map((c) => taskRefByCode.get(c))
          .filter((r): r is TaskRef => Boolean(r));
        let evidence = (row.evidence ?? "").trim();
        let finding = (row.finding ?? row.complaint ?? "").trim();
        for (const c of codes) {
          if (!taskRefByCode.has(c)) continue; // keep unresolved codes as a fallback
          finding = stripTaskCode(finding, c);
          evidence = stripTaskCode(evidence, c);
        }
        b.proof.push({
          stream: "client",
          kind: "complaint",
          text: `${clientName}: ${finding || "شكوى/تعثّر منسوب إليه"}${evidence ? ` — ${evidence}` : ""}`,
          quote: (row.complaint ?? "").trim() || null,
          // Land on the accountability section that names this person, not the
          // top of the page (see AnalysisView hash-scroll effect).
          href: `/satisfaction?client=${a.client_id}#accountability`,
          taskCode: codes[0] ?? null,
          taskRefs,
          clientName,
          clientId: a.client_id,
          stage: null,
          date: null,
          crossLinked,
        });
      }
    }

    // Commercial: an account manager named responsible on an analysis whose
    // client raised a cancellation / competitor threat → revenue at risk.
    if (churn.length > 0) {
      const responsibleNames = new Set<string>();
      for (const row of rows)
        for (const resp of row.responsible ?? [])
          if (resp.name) responsibleNames.add(norm(resp.name));
      // Same leadership dedup as the complaint stream — and needed here even
      // more, because the /حساب|account/ gate happily matches the AM dept HEAD
      // («مدير قسم إدارة الحسابات»), handing her a copy of every churn threat.
      const amMatches: EmpRow[] = [];
      for (const nm of responsibleNames) {
        const match = empByName.get(nm);
        if (!match) continue;
        // Only the account-management side owns the commercial relationship.
        const role = match.position_label ?? "";
        const isAm = /حساب|account/i.test(role) || contractsByName.has(nm);
        if (!isAm) continue;
        amMatches.push(match);
      }
      const directAms = amMatches.filter(
        (m) => !isLeadershipPosition({ role: m.position_role, name: m.position_name }),
      );
      for (const match of directAms.length > 0 ? directAms : amMatches) {
        streamsAvailable.add("commercial");
        const b = empBucket(match.id);
        b.material = true;
        b.tags.add("عميل مهدَّد");
        b.clients.add(clientName);
        if (a.client_id) b.clientIds.add(a.client_id);
        const worst = churn[0];
        b.proof.push({
          stream: "commercial",
          kind: "churn",
          text: `${clientName} تحت إدارته أبدى ${worst.code === "client_compared_competitor" ? "مقارنة بمنافس" : "تهديدًا بإلغاء/إيقاف التعاقد"} — علاقة إيرادية مهدَّدة.`,
          quote: (worst.evidence ?? "").trim() || null,
          href: `/satisfaction?client=${a.client_id}`,
          taskCode: null,
          clientName,
          clientId: a.client_id,
          stage: null,
          date: worst.date ?? null,
          crossLinked: false,
        });
      }
    }
  }

  // ---- assemble cases ----
  const valueByClient = new Map(clientValues.map((c) => [c.client_id, c]));
  const churnClientIds = new Set<string>();
  for (const b of buckets.values())
    for (const p of b.proof)
      if (p.kind === "churn" && p.clientId) churnClientIds.add(p.clientId);

  const cases: AccountabilityCase[] = [];
  for (const b of buckets.values()) {
    if (b.proof.length === 0 || !b.material) continue;
    const streamSet = new Set(b.proof.map((p) => p.stream));
    const streams = [...streamSet].sort((x, y) => STREAM_ORDER[x] - STREAM_ORDER[y]);

    // Corroboration ranking. The unarguable case — a client complaint that
    // names a task literally stuck in this person's own stage (cross-linked) —
    // is the top tier. Two streams that agree is "proven". A lone stream is a
    // "signal", unless it is hard operational silence (open work, zero actions).
    const crossLinked = b.proof.some((p) => p.crossLinked);
    let severity: CaseSeverity;
    if (streams.length >= 3) severity = "critical";
    else if (streams.length === 2) severity = crossLinked ? "critical" : "proven";
    else severity = b.hardSilent ? "proven" : "signal";

    // proof order: cross-linked first, then execution → client → commercial.
    const proof = b.proof.sort((x, y) => {
      if (x.crossLinked !== y.crossLinked) return x.crossLinked ? -1 : 1;
      return STREAM_ORDER[x.stream] - STREAM_ORDER[y.stream];
    });

    // Stamp each proof with its stable per-problem key. Scoped by employee so the
    // same client complaint naming two people yields two independent problems; a
    // `#n` suffix disambiguates the rare within-person collision so two distinct
    // problems never collapse onto one status row.
    const seenKeys = new Set<string>();
    for (const p of proof) {
      const base = `${b.employeeId ?? "?"}::${p.kind}::${problemDiscriminator(p)}`;
      let key = base;
      for (let n = 2; seenKeys.has(key); n++) key = `${base}#${n}`;
      seenKeys.add(key);
      p.problemKey = key;
    }

    const l = b.employeeId ? ledgerByEmp.get(b.employeeId) : undefined;
    const sc = b.employeeId ? scoreByEmp.get(b.employeeId) : undefined;
    const liveContracts =
      b.employeeId && empById.get(b.employeeId)?.full_name
        ? contractsByName.get(norm(empById.get(b.employeeId)!.full_name!)) ?? 0
        : 0;
    const daily = b.employeeId
      ? buildDaily(b.employeeId)
      : { dailyActivity: [], silentWorkingDays14: 0 };
    const ledgerObj: CaseLedger | null = sc
      ? {
          actions30d: l?.actions ?? 0,
          activeDays: l?.active_days ?? 0,
          lastActionAt: l?.last_at ?? null,
          daysSinceLastAction: daysBetween(l?.last_at ?? null, nowMs),
          // The ledger is the lower, live Team Pulse strip — deliberately
          // separate from the modal's top delivery-deadline scorecard.
          openTasks: liveTotals[sc.employeeId]?.openLive ?? sc.openTasks,
          overdueOwned:
            liveTotals[sc.employeeId]?.overdueLive ?? sc.overdueOwned,
          onTimeRate: sc.onTimeRate,
          liveContracts,
          dailyActivity: daily.dailyActivity,
          silentWorkingDays14: daily.silentWorkingDays14,
          peerMedianOpen,
          peerMedianActions,
        }
      : null;

    // ---- impact: what this case puts at stake, in clients and riyals ----
    // Money = what the affected clients haven't paid yet: overdue installments
    // (client-finance map, installments past expected_date with no actual)
    // plus expected renewal value on their live contracts. Both maps key by
    // canonical client id, same as b.clientIds.
    const clientIds = [...b.clientIds];
    let dueValue = 0;
    let renewalValue = 0;
    let pricedClients = 0;
    const moneyByClient: Record<string, ClientMoney> = {};
    const churnClients: string[] = [];
    const financeFlagClients: string[] = [];
    for (const cid of clientIds) {
      const v = valueByClient.get(cid);
      const renewal = v && v.live > 0 ? v.renewal_value : 0;
      if (v && v.live > 0) pricedClients += 1;
      const fin = financeMap[cid];
      const due = fin?.overdueAmount ?? 0;
      const monthDue = fin?.monthDueAmount ?? 0;
      renewalValue += renewal;
      dueValue += due;
      if (due > 0 || monthDue > 0 || renewal > 0)
        moneyByClient[cid] = {
          due: Math.round(due),
          dueCodes: fin?.overdueContractCodes ?? [],
          monthDue: Math.round(monthDue),
          monthDueCodes: fin?.monthDueContractCodes ?? [],
          renewal: Math.round(renewal),
          renewalContracts: (v?.renewal_contracts ?? []).map((r) => ({
            code: r.code,
            name: r.name,
          })),
        };
      const nameOf = () =>
        b.proof.find((p) => p.clientId === cid)?.clientName ?? "عميل";
      if (churnClientIds.has(cid)) churnClients.push(nameOf());
      if ((fin?.overdueInstallments ?? 0) > 0) financeFlagClients.push(nameOf());
    }
    const impact: CaseImpact = {
      clients: clientIds.length,
      pricedClients,
      unpricedClients: clientIds.length - pricedClients,
      dueValue: Math.round(dueValue),
      renewalValue: Math.round(renewalValue),
      atStakeValue: Math.round(dueValue + renewalValue),
      moneyByClient,
      churnClients,
      financeFlagClients,
    };

    // Ranking. The old sort ordered by how WELL-PROVEN a case was — a metric
    // about our detector, not about the business. A CEO ranks by what it costs,
    // so impact leads: money at stake first, then corroboration as the
    // tie-breaker (an expensive case we can prove outranks an expensive hunch).
    // "At stake" is the UNCOLLECTED money (dues + expected renewal), log-scaled:
    // a 100k exposure should outrank a 10k one, but not by 10× — a well-proven
    // neglect case on a mid-size client still deserves air.
    const valueScore = impact.atStakeValue > 0 ? Math.log10(impact.atStakeValue) * 60_000 : 0;
    const sort =
      valueScore +
      churnClients.length * 250_000 + // an actual leaving threat dominates
      financeFlagClients.length * 40_000 +
      impact.clients * 15_000 +
      SEVERITY_RANK[severity] * 30_000 + // corroboration = tie-breaker, not lead
      (crossLinked ? 20_000 : 0) +
      (b.hardSilent ? 15_000 : 0) +
      b.proof.length * 500 +
      (ledgerObj?.overdueOwned ?? 0) * 100;

    cases.push({
      employeeId: b.employeeId,
      employeeName: b.employeeName,
      role: b.role,
      department: b.department,
      problemTags: [...b.tags],
      streams,
      severity,
      proof,
      clientNames: [...b.clients],
      clientIds,
      impact,
      ledger: ledgerObj,
      sort,
    });
  }

  cases.sort((a, z) => z.sort - a.sort);

  return {
    generatedAt: new Date().toISOString(),
    cases,
    meta: {
      people: cases.length,
      critical: cases.filter((c) => c.severity === "critical").length,
      proven: cases.filter((c) => c.severity === "proven").length,
      signal: cases.filter((c) => c.severity === "signal").length,
      streamsAvailable: [...streamsAvailable].sort((x, y) => STREAM_ORDER[x] - STREAM_ORDER[y]),
      unmatchedNames: [...unmatched],
      heldTasksExcluded: heldTaskIds.size,
    },
  };
}

export const getAccountabilityCases = cache(_getAccountabilityCases);

// ---- stage label (Arabic) — mirrors TasksBoard.stages, kept server-side ----
const STAGE_AR: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة الأخصائي",
  client_changes: "تعديلات العميل",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  done: "منجزة",
};
function stageAr(s: string): string {
  return STAGE_AR[s] ?? s;
}

// Minimal Arabic count phrasing: 1 → "إجراء واحد", 2 → "إجراءين", 3-10 →
// "N إجراءات", 11+ → "N إجراء". Enough for the small counts we show.
// The stage's configured limit, in the units a reader thinks in. Only ever
// called for SLA-bearing stages (the null case is a defensive fallback).
function slaLabel(minutes: number | null): string {
  if (minutes === null) return "غير محدّدة";
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} ساعة عمل` : `${hours.toFixed(1)} ساعة عمل`;
}

function arCount(n: number, one: string, two: string, few: string): string {
  if (n === 1) return `${one} واحد`;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}

// ---- SQL builders ----------------------------------------------------------
function empSql(org: string): string {
  return `
select e.id, e.full_name, e.job_title as position_label, d.name as department,
       pos.role as position_role, pos.name as position_name
  from employee_profiles e
  left join departments d on d.id = e.department_id
  left join positions pos on pos.id = e.position_id
 where e.organization_id = '${org}'`;
}

function ledgerSql(org: string): string {
  return `
with recent as (
  -- Author-attributed actions on LIVE tasks only. The tasks join (archived_at
  -- is null) is load-bearing: it excludes actions on archived tasks so this
  -- «إجراءات 30ي» reconciles with the نبض الفريق action-log (getEmployeeActionLog),
  -- which is likewise non-archived, AND obeys the engine's "archived excluded
  -- everywhere" rule. Without it the ledger over-counted (e.g. 111 vs 97).
  select c.actor_employee_id, c.created_at
    from task_comments c
    join tasks t on t.id = c.task_id and t.archived_at is null
   where c.organization_id = '${org}'
     and c.actor_employee_id is not null
     and c.created_at > now() - interval '30 days'
), ledger as (
  select actor_employee_id,
         count(*)::int as actions,
         count(distinct created_at::date)::int as active_days,
         max(created_at) as last_at
    from recent
   group by 1
), daily as (
  select actor_employee_id,
         jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d) as days
    from (
      select actor_employee_id, created_at::date::text as d, count(*)::int as n
        from recent
       where created_at > now() - interval '14 days'
       group by 1, 2
    ) grouped
   group by 1
)
select l.actor_employee_id, l.actions, l.active_days, l.last_at,
       coalesce(d.days, '[]'::jsonb) as daily
  from ledger l
  left join daily d using (actor_employee_id)`;
}

function stuckSql(org: string): string {
  // Overdue OR long-idle tasks whose CURRENT open stage is owned by the
  // assignee's position (same template-driven ownership the scorecard uses).
  return `
with attrib as (
  select distinct ta.task_id, ta.employee_id, pos.role as position_role
    from task_assignees ta
    join employee_profiles e on e.id = ta.employee_id
    join positions pos on pos.id = e.position_id
   where ta.organization_id = '${org}'
     and public.accountability_role_of_position(pos.role) is not null
)
select a.employee_id, t.id as task_id, t.task_code, t.title, t.stage::text as stage,
       (t.stage <> 'done' and t.planned_date < current_date) as overdue,
       sla.max_minutes as stage_sla_minutes,
       (current_date - h.entered_at::date) as days_in_stage,
       max(tc.created_at)::date as last_action,
       count(tc.id) filter (where tc.created_at >= h.entered_at)::int as owner_actions_in_stage,
       coalesce(cl.merged_into_client_id, cl.id)::text as client_id,
       cl.name as client_name, pj.name as project_name,
       coalesce(hold.on_hold, false) as on_hold
  from attrib a
  join tasks t on t.id = a.task_id and t.archived_at is null
  left join projects pj on pj.id = t.project_id
  left join clients cl on cl.id = pj.client_id
  join lateral (
    select h2.entered_at from task_stage_history h2
     where h2.task_id = t.id and h2.exited_at is null
     order by h2.entered_at desc limit 1
  ) h on true
  -- Parked-by-decision flag (see ON_HOLD_SQL). Flagged rather than filtered so
  -- the caller can count the exclusions instead of quietly reporting less.
  left join lateral (
    select true as on_hold where ${ON_HOLD_SQL("t")}
  ) hold on true
  left join task_comments tc
    on tc.task_id = t.id and tc.actor_employee_id = a.employee_id
  left join sla_rules sla
    on sla.organization_id = t.organization_id and sla.stage_key = t.stage::text
 where a.position_role = public.accountable_position_for_stage(t.stage_owner_positions, t.stage::text)
   and t.stage <> 'done'
   and (
     -- Arm 1 — the DEADLINE was missed. True for any stage, including a
     -- not-started (new) task nobody picked up (0257/0258).
     (t.planned_date < current_date)
     -- Arm 2 — "stuck in a stage". Only meaningful where the template DEFINES a
     -- limit for the stage: a task can only overstay a limit that exists. Stages
     -- with no sla_rules row (جديد / قيد التنفيذ) are never called stuck — an
     -- execution stage legitimately spans the client's whole month, so "عالقة
     -- منذ 25 يومًا" on a monthly reporting task was a false alarm, not a
     -- finding. Same rule as مراحل متأخرة on the team table.
     or (sla.max_minutes is not null
         and (current_date - h.entered_at::date) >= ${STUCK_MIN_DAYS})
   )
 group by a.employee_id, t.id, t.task_code, t.title, t.stage, t.planned_date, h.entered_at,
          sla.max_minutes, cl.id, cl.merged_into_client_id, cl.name, pj.name, hold.on_hold`;
}

// Live contract value per CANONICAL client. Contracts sit on the sheet twin of
// a merged client, so fold twin→canonical the same way client-finance does —
// otherwise a merged client's work looks unpriced. Clients with no contract row
// are absent here on purpose: unknown value, not zero.
// See [[project_satisfaction_contract_bridge]].
// Per client (canonical id): the expected-renewal money on their LIVE contracts
// (the sheet's " Value of repeated services") plus how many live contracts they
// hold. Full contract value is deliberately NOT read here anymore — the badge
// this feeds shows money the client hasn't paid yet, not their portfolio size.
// `renewal_contracts` carries PROVENANCE — the sheet-twin client name + the
// contract code behind each renewal amount. Contracts live on the sheet twin
// under its commercial name (محمد أبو بكر's renewal sits on «كري اروما» C40-1),
// so a bare number beside the Odoo name reads as someone else's money.
function clientValueSql(org: string): string {
  return `
select coalesce(cl.merged_into_client_id, cl.id)::text as client_id,
       sum(coalesce(c.repeated_services_value, 0))::float8 as renewal_value,
       count(*)::int as live,
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'code', c.contract_code,
             'name', cl.name,
             'renewal', c.repeated_services_value
           )
           order by c.repeated_services_value desc
         ) filter (where coalesce(c.repeated_services_value, 0) > 0),
         '[]'::jsonb
       ) as renewal_contracts
  from contracts c
  join clients cl on cl.id = c.client_id
 where c.organization_id = '${org}'
   and c.status not in ('closed','lost')
 group by 1`;
}

function contractsSql(org: string): string {
  return `
select account_manager_name, count(*)::int as live
  from contracts
 where organization_id = '${org}'
   and status not in ('closed','lost')
   and account_manager_name is not null
 group by 1`;
}

function analysesSql(org: string): string {
  return `
select csa.id::text as analysis_id, csa.client_id, c.name as client_name, csa.accountability, csa.indicators
  from client_satisfaction_analyses csa
  left join clients c on c.id = csa.client_id
 where csa.organization_id = '${org}'
   and csa.is_current
   and jsonb_array_length(coalesce(csa.accountability, '[]'::jsonb)) > 0`;
}

// Resolve a set of human task codes (PRJ-01798-045) to their id/title/project so
// the UI can link the AI's cited tasks instead of printing an unclickable code.
// Codes are allow-listed to [A-Za-z0-9_-] before interpolation.
function taskRefsSql(org: string, codes: string[]): string {
  const safe = codes.filter((c) => /^[A-Za-z0-9_-]+$/.test(c)).map((c) => `'${c}'`);
  return `
select t.id::text as task_id, t.task_code, t.title, pj.name as project_name,
       ${ON_HOLD_SQL("t")} as on_hold
  from tasks t
  left join projects pj on pj.id = t.project_id
 where t.organization_id = '${org}'
   and t.task_code in (${safe.join(",")})`;
}

// The specific tasks behind each employee's rework count: tasks that re-entered
// the client_changes stage in the last 30 days on a stage that person's position
// owns — the exact intervals refresh_accountability_scorecard counts as rework_30d
// (migration 0223), so the listed tasks reconcile with the "N ارتداد" number.
function reworkTasksSql(org: string): string {
  return `
with attrib as (
  select distinct ta.task_id, ta.employee_id, pos.role as position_role
    from task_assignees ta
    join employee_profiles e on e.id = ta.employee_id
    join positions pos on pos.id = e.position_id
   where ta.organization_id = '${org}'
     and public.accountability_role_of_position(pos.role) = 'agent'
)
select a.employee_id, t.id::text as task_id, t.task_code, t.title, pj.name as project_name
  from attrib a
  join tasks t on t.id = a.task_id and t.archived_at is null
  left join projects pj on pj.id = t.project_id
  join task_stage_history h on h.task_id = t.id
   and h.to_stage::text = 'client_changes'
   and h.entered_at >= now() - interval '30 days'
 where a.position_role = public.accountable_position_for_stage(t.stage_owner_positions, 'client_changes')
 group by a.employee_id, t.id, t.task_code, t.title, pj.name
 order by max(h.entered_at) desc`;
}
