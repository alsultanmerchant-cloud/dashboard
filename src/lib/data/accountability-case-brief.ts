import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveClientProjectIds } from "@/lib/data/satisfaction-identity";
import type {
  AccountabilityCase,
  AccountabilityCasesResult,
} from "@/lib/data/accountability-cases";
import type { ProblemHistorySummary } from "@/lib/data/accountability-problems-store";

// =========================================================================
// Case Brief — the CEO layer over the القضايا feed.
//
// The feed answers "who has a problem, and can we prove it". The team's
// verdict on that was blunt: it doesn't help the CEO. The reason is that every
// number on it described the DETECTOR (3 critical / 16 proven / 26 signal =
// how many streams corroborated), not the BUSINESS. A CEO has no decision
// hanging on "26 signals".
//
// So this module reduces the case feed to the three things a CEO actually acts on:
//   1. scope    — how much work is stalled, and how much of it is untouched
//   2. asks     — the 3 people to deal with this week, each with ONE ask
//   3. history  — what moved inside the selected period (from the case store)
//
// Everything here is derived from facts the engine already computed. No AI, no
// new queries — a pure fold over the cases the page loads anyway.
//
// HONESTY: per-ask money is the UNCOLLECTED money of the clients whose work is
// stalled under that person — overdue unpaid installments (`dueValue`) and the
// expected renewal value of their live contracts (`renewalValue`). It replaced
// total contract value, which read as the person's portfolio size and said
// nothing about the problem. EXPOSURE for ranking, not a loss forecast. It is
// shown beside a name and an ask (where it is actionable), never rolled up into
// an org headline: the inclusion bar is low enough that an org rollup catches
// half the book. Clients with no contract row are the Odoo-only population —
// value UNKNOWN, never zero, never "churned". See [[project_clients_centralization]].
// =========================================================================

export interface CaseAsk {
  employeeId: string | null;
  employeeName: string;
  role: string | null;
  department: string | null;
  severity: AccountabilityCase["severity"];
  why: string; // the single hardest FACT behind this ranking
  ask: string; // the one thing to do about it — code-derived, never AI
  // SAR — scoped to the ONE client the ask is about (primaryClient), not the
  // person's whole affected-client set: a case-wide sum beside a single-client
  // ask read as portfolio money, unrelated to the problem (client feedback).
  // Zero (chips hidden) when the ask names no client or that client has
  // neither dues nor an expected renewal.
  dueValue: number; // overdue unpaid installments on the ask's client
  renewalValue: number; // expected renewal (repeated services) on their live contracts
  clientNames: string[]; // the ask's own client first
  moreClients: number;
  // client display name → its Rawasm (Odoo) project names. The heads only
  // recognize the names that exist in Rawasm and the WA groups — the sheet's
  // contract name (which titles the ask) means nothing to them, so the UI
  // shows the project names in small text beside each client. Filled by
  // attachAskProjects (the one deliberate query layer over this pure fold).
  clientProjects: Record<string, string[]>;
  // Set ONLY when the case was resolved and came back. Deliberately not derived
  // from `times_seen` — that is a daily-poll counter, identical (6) on 42 of 52
  // live cases, and labelling it "تكرّرت N×" claimed a recurrence that never
  // happened. Real recurrence is rare, so this badge stays meaningful.
  recurrenceNote: string | null;
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
  // Tasks left OUT of the above because they are parked by decision (HOLD/LOST
  // tag, or a dashboard hold). Stated openly so the scope reads as a choice.
  heldTasksExcluded: number;
}

export interface CaseBrief {
  exposure: CaseExposure;
  asks: CaseAsk[];
  history: ProblemHistorySummary | null;
}

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

// Person-level roll-up for the ask row: how many of this person's problems have
// come back after being closed (from the per-problem store). 0 ⇒ no badge.
function fmtRecurrence(reopenedProblems: number): string | null {
  if (reopenedProblems < 1) return null;
  return reopenedProblems === 1
    ? "مشكلة عادت بعد إغلاقها"
    : `${reopenedProblems} مشاكل عادت بعد إغلاقها`;
}

export function buildCaseBrief(
  result: AccountabilityCasesResult,
  history: ProblemHistorySummary | null,
  reopenByEmployee: Record<string, number> = {},
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
    heldTasksExcluded: result.meta.heldTasksExcluded,
  };

  // ---- 2. the three asks (feed is already impact-sorted) ----
  const asks: CaseAsk[] = cases.slice(0, 3).map((c) => {
    const { why, ask, primaryClient } = deriveAsk(c);
    // The client the ask names must lead the list — otherwise the row says
    // "close X's complaint" over a list of three unrelated clients.
    const ordered = primaryClient
      ? [primaryClient, ...c.clientNames.filter((n) => n !== primaryClient)]
      : c.clientNames;
    // Money chips carry ONLY the ask's own client's uncollected money. The
    // proof rows pair clientName↔clientId, which the case-level Sets lost.
    const primaryClientId = primaryClient
      ? c.proof.find((p) => p.clientName === primaryClient && p.clientId)?.clientId ?? null
      : null;
    const money = primaryClientId ? c.impact.moneyByClient[primaryClientId] : undefined;
    return {
      employeeId: c.employeeId,
      employeeName: c.employeeName,
      role: c.role,
      department: c.department,
      severity: c.severity,
      why,
      ask,
      dueValue: money?.due ?? 0,
      renewalValue: money?.renewal ?? 0,
      clientNames: ordered.slice(0, 3),
      moreClients: Math.max(0, ordered.length - 3),
      clientProjects: {},
      recurrenceNote: c.employeeId ? fmtRecurrence(reopenByEmployee[c.employeeId] ?? 0) : null,
    };
  });

  return { exposure, asks, history };
}

// ---- Rawasm project names beside each ask client -------------------------
// The asks title complaints with the CONTRACT-sheet client name, but the
// department heads only know the project names that live in Rawasm (Odoo) and
// the WA groups. Resolve each displayed client to its projects (owned +
// WA-group-linked + merged twins, via the satisfaction identity resolver) and
// attach the names so the band can show them in parentheses.
//
// Name→id pairs come from the cases' own proof rows (every stream stamps both
// clientName and clientId together); the case-level name/id Sets lost the
// pairing. Only the ≤3 asks × ≤4 names each are resolved — a handful of
// cached lookups, not a table scan.
const MAX_PROJECTS_PER_CLIENT = 2;

function normName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function attachAskProjects(
  orgId: string,
  brief: CaseBrief,
  result: AccountabilityCasesResult,
): Promise<CaseBrief> {
  try {
    const displayed = new Set<string>();
    for (const a of brief.asks) for (const n of a.clientNames) displayed.add(n);
    if (displayed.size === 0) return brief;

    const idByName = new Map<string, string>();
    for (const c of result.cases.slice(0, brief.asks.length)) {
      for (const p of c.proof) {
        if (p.clientName && p.clientId && displayed.has(p.clientName) && !idByName.has(p.clientName)) {
          idByName.set(p.clientName, p.clientId);
        }
      }
    }
    if (idByName.size === 0) return brief;

    const uniqueIds = [...new Set(idByName.values())];
    const projectIdsByClient = new Map<string, string[]>();
    await Promise.all(
      uniqueIds.map(async (id) => {
        projectIdsByClient.set(id, await resolveClientProjectIds(orgId, id).catch(() => []));
      }),
    );

    const allProjectIds = [...new Set([...projectIdsByClient.values()].flat())];
    if (allProjectIds.length === 0) return brief;
    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .in("id", allProjectIds);
    const projectName = new Map(
      ((projects ?? []) as Array<{ id: string; name: string | null }>).map((p) => [
        p.id,
        (p.name ?? "").trim(),
      ]),
    );

    for (const a of brief.asks) {
      const map: Record<string, string[]> = {};
      for (const clientName of a.clientNames) {
        const clientId = idByName.get(clientName);
        if (!clientId) continue;
        const names = (projectIdsByClient.get(clientId) ?? [])
          .map((pid) => projectName.get(pid) ?? "")
          // A project literally named like the client adds nothing but noise
          // ("تطبيق خدمتي (تطبيق خدمتي)") — the head already recognizes it.
          .filter((n) => n.length > 0 && normName(n) !== normName(clientName));
        if (names.length > 0) map[clientName] = names.slice(0, MAX_PROJECTS_PER_CLIENT);
      }
      a.clientProjects = map;
    }
    return brief;
  } catch (e) {
    // Enrichment is decoration — never let it take the band down.
    console.error("[case-brief] attachAskProjects failed:", e);
    return brief;
  }
}
