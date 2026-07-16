import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getAccountabilityCaseOverview,
  type AccountabilityCaseOverview,
} from "@/lib/data/accountability";

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
  date: string | null; // YYYY-MM-DD
  crossLinked: boolean; // this proof's task/client also appears in another stream
  // For execution overdue/stuck-task proofs: actions the responsible owner
  // logged on THIS task since it entered the stuck stage, and the length of that
  // window in days. Rendered as a chip ("0 إجراء · 12 يوم") that turns a bare
  // "this task is late" into proof of neglect. null on non-task proofs.
  ownerActions?: number | null;
  windowDays?: number | null;
}

export interface CaseLedger {
  actions30d: number;
  activeDays: number; // distinct days with an authored action in the window
  lastActionAt: string | null;
  daysSinceLastAction: number | null;
  openTasks: number;
  overdueOwned: number;
  onTimeRate: number | null;
  liveContracts: number; // live contracts owned as account manager (context)
  // P4 ledger polish — a 14-day activity heatmap, silent working-days, and how
  // this person's workload/output compares to the team median.
  dailyActivity: { date: string; count: number }[]; // last 14 days, oldest→newest
  silentWorkingDays14: number; // Sun–Thu days in the last 14 with zero actions
  peerMedianOpen: number; // team median open tasks
  peerMedianActions: number; // team median 30-day actions
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

const SEVERITY_RANK: Record<CaseSeverity, number> = { critical: 3, proven: 2, signal: 1 };
const STREAM_ORDER: Record<CaseStream, number> = { execution: 0, client: 1, commercial: 2 };

// ---- raw row shapes --------------------------------------------------------
interface EmpRow {
  id: string;
  full_name: string | null;
  position_label: string | null;
  department: string | null;
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
  days_in_stage: number | null;
  last_action: string | null;
  // How many actions (notes / stage moves) the RESPONSIBLE owner logged on THIS
  // task since it entered the current (stuck) stage — the "prove the problem"
  // number. 0 over many days = neglect.
  owner_actions_in_stage: number | null;
}
interface ContractRow {
  account_manager_name: string | null;
  live: number;
}
interface ClientAnalysisRow {
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

async function _getAccountabilityCases(
  orgId: string,
  overview?: AccountabilityCaseOverview,
): Promise<AccountabilityCasesResult> {
  const org = assertUuid(orgId, "organization id");

  // The scorecard/reviewer overview is the execution backbone (already cached).
  // The four extra reads are per-stream evidence; each degrades to empty so a
  // single timeout can't take the page down.
  const [ov, emps, ledger, stuck, contracts, analyses] = await Promise.all([
    overview ? Promise.resolve(overview) : getAccountabilityCaseOverview(orgId),
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
  ]);

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
  const peerMedianOpen = median(ov.rows.map((r) => r.openTasks)) ?? 0;
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

  const buckets = new Map<string, Bucket>();
  const streamsAvailable = new Set<CaseStream>();
  const unmatched = new Set<string>();

  const bucketFor = (
    key: string,
    seed: () => Omit<
      Bucket,
      "proof" | "tags" | "clients" | "hardSilent" | "material" | "execTaskCodes"
    >,
  ): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = {
        ...seed(),
        proof: [],
        tags: new Set(),
        clients: new Set(),
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
  for (const s of stuck) {
    if (!s.overdue && (s.days_in_stage ?? 0) < STUCK_MIN_DAYS) continue;
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
      if (s.overdue || (s.days_in_stage ?? 0) >= STUCK_MATERIAL_DAYS) b.material = true;
      if (s.task_code) b.execTaskCodes.add(s.task_code);
      const d = s.days_in_stage ?? 0;
      const owner = s.owner_actions_in_stage ?? 0;
      // The proof: what did the OWNER actually do on this task while it sat stuck?
      const actionTxt =
        owner === 0
          ? `دون أي إجراء منه عليها طوال هذه المدة`
          : `سجّل عليها ${arCount(owner, "إجراء", "إجراءين", "إجراءات")} خلال هذه المدة${s.last_action ? ` (آخر إجراء ${s.last_action})` : ""}`;
      b.proof.push({
        stream: "execution",
        kind: "overdue_task",
        text: `${s.task_code ?? "مهمة"} — ${(s.title ?? "").trim() || "بدون عنوان"} عالقة في ${stageAr(s.stage)} منذ ${d} يومًا${s.overdue ? " ومتأخرة عن موعدها" : ""} — ${actionTxt}.`,
        quote: null,
        href: `/tasks/${s.task_id}`,
        taskCode: s.task_code,
        clientName: null,
        date: s.last_action,
        crossLinked: false,
        ownerActions: owner,
        windowDays: d,
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
        date: l?.last_at ? l.last_at.slice(0, 10) : null,
        crossLinked: false,
      });
    }

    if (r.reworkReturns30d > 0) {
      const b = empBucket(r.employeeId);
      streamsAvailable.add("execution");
      b.material = true;
      b.tags.add("ارتداد عمل");
      b.proof.push({
        stream: "execution",
        kind: "rework",
        text: `${r.reworkReturns30d} ارتداد إلى تنفيذ/تعديلات العميل خلال آخر ٣٠ يومًا — عمل رجع بعد أن تقدّم.`,
        quote: null,
        href: `/accountability`,
        taskCode: null,
        clientName: null,
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

    for (const row of rows) {
      const responsible = Array.isArray(row.responsible) ? row.responsible : [];
      for (const resp of responsible) {
        if (!resp.name) continue;
        const match = empByName.get(norm(resp.name));
        if (!match) {
          unmatched.add(resp.name);
          continue;
        }
        streamsAvailable.add("client");
        const b = empBucket(match.id);
        b.material = true;
        b.tags.add("شكوى عميل");
        b.clients.add(clientName);
        // Cross-link: this complaint cites a task actually stuck in their stage.
        const codes = Array.isArray(row.taskCodes) ? row.taskCodes : [];
        const crossLinked = codes.some((c) => b.execTaskCodes.has(c));
        const evidence = (row.evidence ?? "").trim();
        const finding = (row.finding ?? row.complaint ?? "").trim();
        b.proof.push({
          stream: "client",
          kind: "complaint",
          text: `${clientName}: ${finding || "شكوى/تعثّر منسوب إليه"}${evidence ? ` — ${evidence}` : ""}`,
          quote: (row.complaint ?? "").trim() || null,
          // Land on the accountability section that names this person, not the
          // top of the page (see AnalysisView hash-scroll effect).
          href: `/satisfaction?client=${a.client_id}#accountability`,
          taskCode: codes[0] ?? null,
          clientName,
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
      for (const nm of responsibleNames) {
        const match = empByName.get(nm);
        if (!match) continue;
        // Only the account-management side owns the commercial relationship.
        const role = match.position_label ?? "";
        const isAm = /حساب|account/i.test(role) || contractsByName.has(nm);
        if (!isAm) continue;
        streamsAvailable.add("commercial");
        const b = empBucket(match.id);
        b.material = true;
        b.tags.add("عميل مهدَّد");
        b.clients.add(clientName);
        const worst = churn[0];
        b.proof.push({
          stream: "commercial",
          kind: "churn",
          text: `${clientName} تحت إدارته أبدى ${worst.code === "client_compared_competitor" ? "مقارنة بمنافس" : "تهديدًا بإلغاء/إيقاف التعاقد"} — علاقة إيرادية مهدَّدة.`,
          quote: (worst.evidence ?? "").trim() || null,
          href: `/satisfaction?client=${a.client_id}`,
          taskCode: null,
          clientName,
          date: worst.date ?? null,
          crossLinked: false,
        });
      }
    }
  }

  // ---- assemble cases ----
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
          openTasks: sc.openTasks,
          overdueOwned: sc.overdueOwned,
          onTimeRate: sc.onTimeRate,
          liveContracts,
          dailyActivity: daily.dailyActivity,
          silentWorkingDays14: daily.silentWorkingDays14,
          peerMedianOpen,
          peerMedianActions,
        }
      : null;

    const sort =
      SEVERITY_RANK[severity] * 1_000_000 +
      streams.length * 100_000 +
      (crossLinked ? 50_000 : 0) +
      (b.hardSilent ? 40_000 : 0) +
      b.proof.length * 1_000 +
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
function arCount(n: number, one: string, two: string, few: string): string {
  if (n === 1) return `${one} واحد`;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}

// ---- SQL builders ----------------------------------------------------------
function empSql(org: string): string {
  return `
select e.id, e.full_name, e.job_title as position_label, d.name as department
  from employee_profiles e
  left join departments d on d.id = e.department_id
 where e.organization_id = '${org}'`;
}

function ledgerSql(org: string): string {
  return `
with recent as (
  select actor_employee_id, created_at
    from task_comments
   where organization_id = '${org}'
     and actor_employee_id is not null
     and created_at > now() - interval '30 days'
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
       (t.stage not in ('done','new') and t.planned_date < current_date) as overdue,
       (current_date - h.entered_at::date) as days_in_stage,
       max(tc.created_at)::date as last_action,
       count(tc.id) filter (where tc.created_at >= h.entered_at)::int as owner_actions_in_stage
  from attrib a
  join tasks t on t.id = a.task_id and t.archived_at is null
  join lateral (
    select h2.entered_at from task_stage_history h2
     where h2.task_id = t.id and h2.exited_at is null
     order by h2.entered_at desc limit 1
  ) h on true
  left join task_comments tc
    on tc.task_id = t.id and tc.actor_employee_id = a.employee_id
 where a.position_role = public.accountable_position_for_stage(t.stage_owner_positions, t.stage::text)
   and t.stage not in ('done','new')
   and (
     (t.planned_date < current_date)
     or (current_date - h.entered_at::date) >= ${STUCK_MIN_DAYS}
   )
 group by a.employee_id, t.id, t.task_code, t.title, t.stage, t.planned_date, h.entered_at`;
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
select csa.client_id, c.name as client_name, csa.accountability, csa.indicators
  from client_satisfaction_analyses csa
  left join clients c on c.id = csa.client_id
 where csa.organization_id = '${org}'
   and csa.is_current
   and jsonb_array_length(coalesce(csa.accountability, '[]'::jsonb)) > 0`;
}
