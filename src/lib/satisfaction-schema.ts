import { z } from "zod";

// Structured output for the client-satisfaction analysis. The model reads the
// WhatsApp transcripts (client group + technical group, kept SEPARATE), the
// client's documented brief when available, the client's real Rawasm delivery
// state, and the client's contract status, then returns these fields only — no
// free narration outside the schema.

export const HIGHLIGHT_TYPES = [
  "praise",
  "complaint",
  "request",
  "escalation",
  "milestone",
] as const;

// Who the highlight is about: a message FROM the client (client group) vs an
// internal team message (technical group). Lets the UI keep team chatter — an
// account manager chasing an approval — out of the client requests/complaints.
export const HIGHLIGHT_AUDIENCES = ["client", "team"] as const;

// ---------------------------------------------------------------------------
// Indicator taxonomy — the explicit signals the operations team triages on.
// Two tiers: 🔴 relationship risks, 🟡 operational blockers. The model may ONLY
// emit codes from these lists so the UI/queries stay stable; Arabic labels live
// in messages/*.json under `satisfaction.indicator.<code>`.
// ---------------------------------------------------------------------------
export const RISK_INDICATORS = [
  "client_complained", // العميل اشتكى
  "client_dissatisfied", // العميل أبدى عدم رضا
  "client_threatened_cancellation", // هدد بالإلغاء أو التوقف
  "client_compared_competitor", // قارن بينكم وبين منافس
  "client_complained_about_person", // اشتكى من شخص معين
  "client_repeated_complaint", // كرر نفس الشكوى
  "client_question_unanswered", // سؤال مهم بلا رد لفترة
  "major_task_delay", // تأخير كبير في مهمة مؤثرة
  "client_corrected_am_repeatedly", // صحّح فهم الأكاونت مانجر عدة مرات
  "client_vs_team_mismatch", // تضارب بين طلب العميل وما نُقل للتيم
  "team_reported_unclear_requirements", // التيم أبلغ عن غموض المتطلبات من الأكاونت
] as const;

export const OPERATIONAL_INDICATORS = [
  "team_reported_blocker", // التيم أبلغ عن مشكلة تمنع التنفيذ
  "missing_access", // Missing Accesses
  "missing_brief", // Missing Brief
  "client_uncooperative", // العميل غير متعاون
  "client_late_approvals", // العميل متأخر في الاعتمادات بشكل مؤثر
  "conflicting_client_requests", // تضارب بين طلبات العميل
  "am_not_understanding", // الأكاونت مانجر غير فاهم / كرر طلب التوضيح
] as const;

export const INDICATOR_CODES = [...RISK_INDICATORS, ...OPERATIONAL_INDICATORS] as const;
export const INDICATOR_SOURCES = ["client", "technical", "tasks"] as const;
// Who a delay / problem is attributed to.
export const DELAY_OWNERS = ["client", "account_manager", "team", "department", "unknown"] as const;
// The rolled-up account health label (the "big picture").
export const ACCOUNT_HEALTH = ["healthy", "watch", "at_risk", "critical"] as const;
export const RESPONSE_SPEEDS = ["fast", "medium", "slow", "unknown"] as const;

// One example message behind a request/approval count — a real client quote or
// faithful summary so the UI can show WHAT the count is made of (click a count →
// see the actual messages), not just a number.
const SignalExampleSchema = z.object({
  text: z.string(), // Arabic, one line — real quote or faithful summary
  date: z.string().nullable().catch(null), // YYYY-MM-DD if identifiable
});

const IndicatorSchema = z.object({
  code: z.enum(INDICATOR_CODES),
  // red = relationship risk, yellow = operational blocker. Derived from `code`.
  severity: z.enum(["red", "yellow"]).catch("yellow"),
  // Which source surfaced it.
  source: z.enum(INDICATOR_SOURCES).catch("client"),
  // A real quote or faithful summary — never invented.
  evidence: z.string(),
  date: z.string().nullable(), // YYYY-MM-DD if identifiable
});

export const SatisfactionSchema = z.object({
  // 0-100 overall satisfaction inferred from the CLIENT group tone & outcomes.
  satisfactionScore: z.number().int().min(0).max(100),
  // 0-100 how well delivery matched the client's documented brief. null when
  // the actual brief document text is not available; never infer this from chat.
  briefAdherenceScore: z.number().int().min(0).max(100).nullable(),
  // WHY the score landed where it did: a per-requirement breakdown comparing the
  // documented brief clauses against delivery. Populated ONLY when a brief
  // document was available (else null — same rule as briefAdherenceScore). The
  // model already reasons per clause; this captures it so the UI can explain the
  // score and the assistant can answer "why 40 / what wasn't delivered".
  briefAdherence: z
    .object({
      // One-line Arabic synthesis of why the score is what it is.
      reason: z.string(),
      // Each documented brief requirement and how delivery measured against it.
      items: z
        .array(
          z.object({
            requirement: z.string(), // the brief clause/deliverable, Arabic
            status: z
              .enum(["delivered", "partial", "not_delivered", "no_evidence"])
              .catch("no_evidence"),
            note: z.string().nullable(), // short evidence / why this status
          }),
        )
        .max(20)
        .default([]),
    })
    .nullable()
    .default(null),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  // Short Arabic executive summary (2-4 sentences) — "تحليل الحالة الحالية".
  summary: z.string(),

  // ---- Big picture: each source rolls UP into one account-health verdict ----
  // This is the synthesis the team asked for — relationship (client group) +
  // execution (technical group + tasks) + commercial (contract) combined.
  bigPicture: z
    .object({
      accountHealth: z.enum(ACCOUNT_HEALTH).catch("watch"),
      // One-line الخلاصة tying the dimensions together.
      headline: z.string(),
      // 0-100 per dimension so the UI can show the composition of the verdict.
      relationshipScore: z.number().int().min(0).max(100).catch(50), // from client group
      executionScore: z.number().int().min(0).max(100).catch(50), // from technical + tasks
      commercialScore: z.number().int().min(0).max(100).nullable(), // from contract; null if unknown
    })
    .default({
      accountHealth: "watch",
      headline: "",
      relationshipScore: 50,
      executionScore: 50,
      commercialScore: null,
    }),

  // ---- Detected indicators (the core taxonomy) -----------------------------
  indicators: z.array(IndicatorSchema).max(24).default([]),

  // ---- Per-source extraction (each group's own reading) --------------------
  // Client group 💫: what the client asked for + how approvals went + how
  // responsive they are.
  clientGroupSignals: z
    .object({
      requests: z
        .object({
          new: z.number().int().min(0).catch(0),
          edit: z.number().int().min(0).catch(0),
          complaint: z.number().int().min(0).catch(0),
          inquiry: z.number().int().min(0).catch(0),
          approval: z.number().int().min(0).catch(0),
        })
        .default({ new: 0, edit: 0, complaint: 0, inquiry: 0, approval: 0 }),
      approvals: z
        .object({
          approved: z.number().int().min(0).catch(0),
          rejected: z.number().int().min(0).catch(0),
          changesRequested: z.number().int().min(0).catch(0),
          noResponse: z.number().int().min(0).catch(0),
        })
        .default({ approved: 0, rejected: 0, changesRequested: 0, noResponse: 0 }),
      // The actual client messages behind each request count, so clicking a
      // count in the UI reveals what it's made of. count = examples.length.
      requestExamples: z
        .object({
          new: z.array(SignalExampleSchema).max(12).default([]),
          edit: z.array(SignalExampleSchema).max(12).default([]),
          complaint: z.array(SignalExampleSchema).max(12).default([]),
          inquiry: z.array(SignalExampleSchema).max(12).default([]),
          approval: z.array(SignalExampleSchema).max(12).default([]),
        })
        .default({ new: [], edit: [], complaint: [], inquiry: [], approval: [] }),
      // The actual messages behind each approval-outcome count.
      approvalExamples: z
        .object({
          approved: z.array(SignalExampleSchema).max(12).default([]),
          rejected: z.array(SignalExampleSchema).max(12).default([]),
          changesRequested: z.array(SignalExampleSchema).max(12).default([]),
          noResponse: z.array(SignalExampleSchema).max(12).default([]),
        })
        .default({ approved: [], rejected: [], changesRequested: [], noResponse: [] }),
      responseSpeed: z.enum(RESPONSE_SPEEDS).catch("unknown"),
    })
    .default({
      requests: { new: 0, edit: 0, complaint: 0, inquiry: 0, approval: 0 },
      approvals: { approved: 0, rejected: 0, changesRequested: 0, noResponse: 0 },
      requestExamples: { new: [], edit: [], complaint: [], inquiry: [], approval: [] },
      approvalExamples: { approved: [], rejected: [], changesRequested: [], noResponse: [] },
      responseSpeed: "unknown",
    }),

  // Technical group 📍: internal blockers, who delays are attributed to, and
  // the team's own evaluation of the account.
  technicalGroupSignals: z
    .object({
      blockers: z.array(z.string()).max(12).default([]),
      delayCauses: z
        .array(
          z.object({
            cause: z.string(),
            attributedTo: z.enum(DELAY_OWNERS).catch("unknown"),
          }),
        )
        .max(12)
        .default([]),
      accountEvaluation: z.array(z.string()).max(8).default([]),
    })
    .default({ blockers: [], delayCauses: [], accountEvaluation: [] }),

  // ---- Causes (أسباب المشاكل): problem → root cause → who owns it -----------
  causes: z
    .array(
      z.object({
        problem: z.string(),
        rootCause: z.string(),
        owner: z.enum(DELAY_OWNERS).catch("unknown"),
      }),
    )
    .max(8)
    .default([]),

  highlights: z
    .array(
      z.object({
        type: z.enum(HIGHLIGHT_TYPES),
        // client message vs internal team. `.catch` defaults a missing/invalid
        // value to "client" so a single bad enum can't fail the whole analysis
        // (flash occasionally omits it → schema-validation failures otherwise).
        audience: z.enum(HIGHLIGHT_AUDIENCES).catch("client"),
        text: z.string(), // Arabic, one line
        date: z.string().nullable(), // YYYY-MM-DD if identifiable
      }),
    )
    .max(12),
  // Coarse sentiment over time so the page can draw a trend.
  sentimentTimeline: z
    .array(
      z.object({
        period: z.string(), // e.g. "2026-04" (month) or "2026-W18"
        score: z.number().int().min(0).max(100),
      }),
    )
    .max(24),
  // Relationship risks / churn signals, Arabic, most important first.
  risks: z.array(z.string()).max(8),
  // Actionable advice for the team, grounded in BOTH the chats and the client's
  // real Rawasm work (overdue tasks / stuck stages). Each item links a problem
  // to a concrete next step. Empty array when there's nothing material to advise.
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["high", "medium", "low"]).catch("medium"),
        // The problem, correlating the chat with the real delivery state.
        issue: z.string(), // Arabic, one line
        // What the team should do next about it.
        action: z.string(), // Arabic, one line
      }),
    )
    .max(6),
});

export type SatisfactionResult = z.infer<typeof SatisfactionSchema>;
export type SatisfactionHighlightType = (typeof HIGHLIGHT_TYPES)[number];
export type SatisfactionHighlightAudience = (typeof HIGHLIGHT_AUDIENCES)[number];
export type SatisfactionIndicatorCode = (typeof INDICATOR_CODES)[number];
export type SatisfactionIndicatorSource = (typeof INDICATOR_SOURCES)[number];
export type DelayOwner = (typeof DELAY_OWNERS)[number];
export type AccountHealth = (typeof ACCOUNT_HEALTH)[number];

// Which tier a code belongs to (drives severity + UI grouping).
export function indicatorSeverity(code: SatisfactionIndicatorCode): "red" | "yellow" {
  return (RISK_INDICATORS as readonly string[]).includes(code) ? "red" : "yellow";
}
