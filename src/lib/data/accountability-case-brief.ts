import "server-only";
import type {
  AccountabilityCase,
  AccountabilityCasesResult,
} from "@/lib/data/accountability-cases";
import type { CaseHistorySummary } from "@/lib/data/accountability-cases-store";
import type { PersistedCaseMeta } from "@/lib/accountability/case-status";

// =========================================================================
// Case Brief — the CEO layer over the القضايا feed.
//
// The feed answers "who has a problem, and can we prove it". The team's
// verdict on that was blunt: it doesn't help the CEO. The reason is that every
// number on it described the DETECTOR (3 critical / 16 proven / 26 signal =
// how many streams corroborated), not the BUSINESS. A CEO has no decision
// hanging on "26 signals".
//
// So this module reduces 45 cases to the four things a CEO actually acts on:
//   1. scope    — how much work is stalled, and how much of it is untouched
//   2. asks     — the 3 people to deal with this week, each with ONE ask
//   3. patterns — where N cases are really ONE broken stage, not N bad people
//   4. history  — what moved since last week (from the case store)
//
// Everything here is derived from facts the engine already computed. No AI, no
// new queries — a pure fold over the cases the page loads anyway.
//
// HONESTY: per-ask `contractValue` is the value of the clients whose work is
// stalled under that person — EXPOSURE for ranking, not a loss forecast, and a
// stuck task does not put a whole contract at risk. It is shown beside a name
// and an ask (where it is actionable), never rolled up into an org headline:
// the inclusion bar is low enough that an org rollup catches half the book.
// Clients with no contract row are the Odoo-only population — value UNKNOWN,
// never zero, never "churned". See [[project_clients_centralization]].
// =========================================================================

export interface CaseAsk {
  employeeId: string | null;
  employeeName: string;
  role: string | null;
  department: string | null;
  severity: AccountabilityCase["severity"];
  why: string; // the single hardest FACT behind this ranking
  ask: string; // the one thing to do about it — code-derived, never AI
  contractValue: number;
  clientNames: string[]; // the ask's own client first
  moreClients: number;
  // Set ONLY when the case was resolved and came back. Deliberately not derived
  // from `times_seen` — that is a daily-poll counter, identical (6) on 42 of 52
  // live cases, and labelling it "تكرّرت N×" claimed a recurrence that never
  // happened. Real recurrence is rare, so this badge stays meaningful.
  recurrenceNote: string | null;
}

export interface CasePattern {
  kind: "stage" | "department";
  key: string;
  label: string;
  tasks: number;
  people: number;
  sharePct: number; // share of all stalled tasks sitting here
  worstDays: number;
  href: string | null;
  text: string;
}

// Scope of the open case set — context for the asks, deliberately NOT a
// headline. An org-level contract-value rollup used to live here; it was
// dropped because "client has a task past its deadline" catches ~41% of the
// client base and 55% of the live book, so the number flagged half the company
// as at-risk while naming nobody. Money is per-ask now (see CaseAsk), and
// client-level risk belongs to the CEO brief / satisfaction.
export interface CaseExposure {
  cases: number; // people carrying a case
  clients: number; // distinct clients touched by stalled work
  stalledTasks: number;
  zeroActionTasks: number; // …of which the responsible owner never touched
}

export interface CaseBrief {
  exposure: CaseExposure;
  asks: CaseAsk[];
  patterns: CasePattern[];
  history: CaseHistorySummary | null;
}

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

// A stage/department only earns "this is systemic, not personal" if the problem
// is spread across enough PEOPLE that blaming individuals stops making sense.
const PATTERN_MIN_PEOPLE = 3;
const PATTERN_MIN_TASKS = 5;

// Neglect needs a window long enough to be neglect. `windowDays` counts days in
// the CURRENT stage, so a task that changed stage today reads 0 — claiming
// "0 days without action" as an accusation is both false and embarrassing.
// Below this, the task's problem is its DEADLINE, not the owner's silence.
const ZERO_ACTION_MIN_DAYS = 3;

// The single ask per person, chosen by what the evidence most demands and
// ordered by what it costs to ignore: a client walking out > proof they aren't
// working at all > an angry client > provable neglect > a missed deadline >
// a bottleneck blocking everyone else.
//
// Each branch may only assert what its own proof supports. `primaryClient` is
// the client the ask is ABOUT, so the UI can lead with it instead of an
// unrelated one.
function deriveAsk(c: AccountabilityCase): {
  why: string;
  ask: string;
  primaryClient: string | null;
} {
  const churn = c.proof.find((p) => p.kind === "churn");
  if (churn) {
    return {
      why: churn.text,
      ask: `قرار احتفاظ بـ${churn.clientName ?? "العميل"} — تواصل معه اليوم قبل أن يغادر.`,
      primaryClient: churn.clientName,
    };
  }

  const silent = c.proof.find((p) => p.kind === "silent");
  if (silent) {
    return {
      why: silent.text,
      ask: `اسأله مباشرة عمّا أنجزه: ${c.ledger?.openTasks ?? 0} مهمة تحت اسمه بلا أي أثر منذ ٣٠ يومًا.`,
      primaryClient: null,
    };
  }

  const complaint = c.proof.find((p) => p.kind === "complaint");
  if (complaint) {
    return {
      why: complaint.text,
      ask: `أغلق شكوى ${complaint.clientName ?? "العميل"} وتحقّق من معالجتها فعليًا.`,
      primaryClient: complaint.clientName,
    };
  }

  // The sharpest execution proof: tasks left untouched long enough to be neglect.
  const zeroAction = c.proof.filter(
    (p) =>
      p.kind === "overdue_task" &&
      (p.ownerActions ?? -1) === 0 &&
      (p.windowDays ?? 0) >= ZERO_ACTION_MIN_DAYS,
  );
  if (zeroAction.length > 0) {
    const worst = zeroAction.reduce((a, b) => ((b.windowDays ?? 0) > (a.windowDays ?? 0) ? b : a));
    return {
      why: worst.text,
      ask:
        zeroAction.length === 1
          ? `اطلب تحديثًا مكتوبًا على ${worst.taskCode ?? "المهمة"} — ${worst.windowDays ?? 0} يومًا دون أي إجراء منه.`
          : `اطلب خطة على ${zeroAction.length} مهام لم يسجّل عليها أي إجراء (أطولها ${worst.windowDays ?? 0} يومًا).`,
      primaryClient: worst.clientName,
    };
  }

  // Overdue but recently moved: the deadline is the story, not staleness.
  const overdue = c.proof.filter((p) => p.kind === "overdue_task" && p.overdue);
  if (overdue.length > 0) {
    const worst = overdue.reduce((a, b) => ((b.windowDays ?? 0) > (a.windowDays ?? 0) ? b : a));
    return {
      why: worst.text,
      ask:
        overdue.length === 1
          ? `اطلب موعد تسليم جديدًا لـ${worst.taskCode ?? "المهمة"} — تجاوزت موعدها المتفق عليه.`
          : `${overdue.length} مهام تحت مسؤوليته تجاوزت مواعيدها — اطلب خطة تسليم بمواعيد صريحة.`,
      primaryClient: worst.clientName,
    };
  }

  const pending = c.proof.find((p) => p.kind === "pending_review");
  if (pending) {
    return {
      why: pending.text,
      ask: `فكّ الاختناق: عمل الفريق متوقف على اعتماده.`,
      primaryClient: null,
    };
  }

  const rework = c.proof.find((p) => p.kind === "rework");
  if (rework) {
    return {
      why: rework.text,
      ask: `راجع جودة التسليم معه — العمل يرجع بعد أن يتقدّم.`,
      primaryClient: null,
    };
  }

  const stalled = c.proof.find((p) => p.kind === "overdue_task");
  if (stalled) {
    return {
      why: stalled.text,
      ask: `اسأل عن سبب توقّف ${stalled.taskCode ?? "المهمة"} — ${stalled.windowDays ?? 0} يومًا في نفس المرحلة.`,
      primaryClient: stalled.clientName,
    };
  }

  const first = c.proof[0];
  return {
    why: first?.text ?? "—",
    ask: `راجع ملفه: ${c.problemTags.join("، ") || "قضية مفتوحة"}.`,
    primaryClient: null,
  };
}

function fmtRecurrence(meta: PersistedCaseMeta | undefined): string | null {
  const n = meta?.reopenCount ?? 0;
  if (n < 1) return null;
  return n === 1 ? "عادت بعد إغلاقها" : `عادت بعد إغلاقها ${n}×`;
}

export function buildCaseBrief(
  result: AccountabilityCasesResult,
  history: CaseHistorySummary | null,
  caseMeta: Record<string, PersistedCaseMeta> = {},
): CaseBrief {
  const cases = result.cases;

  // ---- 1. scope of the case set ----
  const allClientIds = new Set<string>();
  let stalledTasks = 0;
  let zeroActionTasks = 0;
  for (const c of cases) {
    for (const id of c.clientIds) allClientIds.add(id);
    for (const p of c.proof) {
      if (p.kind !== "overdue_task") continue;
      stalledTasks += 1;
      if ((p.ownerActions ?? -1) === 0) zeroActionTasks += 1;
    }
  }

  const exposure: CaseExposure = {
    cases: cases.length,
    clients: allClientIds.size,
    stalledTasks,
    zeroActionTasks,
  };

  // ---- 2. the three asks (feed is already impact-sorted) ----
  const asks: CaseAsk[] = cases.slice(0, 3).map((c) => {
    const { why, ask, primaryClient } = deriveAsk(c);
    // The client the ask names must lead the list — otherwise the row says
    // "close X's complaint" over a list of three unrelated clients.
    const ordered = primaryClient
      ? [primaryClient, ...c.clientNames.filter((n) => n !== primaryClient)]
      : c.clientNames;
    return {
      employeeId: c.employeeId,
      employeeName: c.employeeName,
      role: c.role,
      department: c.department,
      severity: c.severity,
      why,
      ask,
      contractValue: c.impact.contractValue,
      clientNames: ordered.slice(0, 3),
      moreClients: Math.max(0, ordered.length - 3),
      recurrenceNote: c.employeeId ? fmtRecurrence(caseMeta[c.employeeId]) : null,
    };
  });

  // ---- 3. patterns: N cases that are really ONE broken stage ----
  const byStage = new Map<string, { tasks: number; people: Set<string>; worst: number }>();
  const byDept = new Map<string, { tasks: number; people: Set<string>; worst: number }>();
  for (const c of cases) {
    for (const p of c.proof) {
      if (p.kind !== "overdue_task") continue;
      const who = c.employeeId ?? c.employeeName;
      if (p.stage) {
        const e = byStage.get(p.stage) ?? { tasks: 0, people: new Set<string>(), worst: 0 };
        e.tasks += 1;
        e.people.add(who);
        e.worst = Math.max(e.worst, p.windowDays ?? 0);
        byStage.set(p.stage, e);
      }
      if (c.department) {
        const e = byDept.get(c.department) ?? { tasks: 0, people: new Set<string>(), worst: 0 };
        e.tasks += 1;
        e.people.add(who);
        e.worst = Math.max(e.worst, p.windowDays ?? 0);
        byDept.set(c.department, e);
      }
    }
  }

  const patterns: CasePattern[] = [];
  const pushPatterns = (
    m: Map<string, { tasks: number; people: Set<string>; worst: number }>,
    kind: CasePattern["kind"],
  ) => {
    for (const [key, e] of m) {
      if (e.people.size < PATTERN_MIN_PEOPLE || e.tasks < PATTERN_MIN_TASKS) continue;
      const label = kind === "stage" ? STAGE_AR[key] ?? key : key;
      const sharePct = stalledTasks > 0 ? Math.round((e.tasks / stalledTasks) * 100) : 0;
      patterns.push({
        kind,
        key,
        label,
        tasks: e.tasks,
        people: e.people.size,
        sharePct,
        worstDays: e.worst,
        href: kind === "stage" ? `/tasks?stage=${key}` : null,
        text:
          kind === "stage"
            ? `${e.tasks} مهمة متعثّرة (${sharePct}% من الإجمالي) عالقة في «${label}» عند ${e.people.size} أشخاص — هذه مرحلة مختنقة، لا تقصير فردي.`
            : `${e.tasks} مهمة متعثّرة عند ${e.people.size} أشخاص في «${label}» — العبء مركَّز في قسم واحد.`,
      });
    }
  };
  pushPatterns(byStage, "stage");
  pushPatterns(byDept, "department");
  patterns.sort((a, b) => b.tasks - a.tasks);

  return { exposure, asks, patterns: patterns.slice(0, 3), history };
}
