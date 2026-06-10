import { z } from "zod";

// Structured output for the client-satisfaction analysis. The model reads the
// two WhatsApp transcripts (client group + technical group) and returns these
// fields only — no free narration outside the schema.

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

export const SatisfactionSchema = z.object({
  // 0-100 overall satisfaction inferred from the CLIENT group tone & outcomes.
  satisfactionScore: z.number().int().min(0).max(100),
  // 0-100 how well delivery matched the client's stated brief/requirements,
  // judged from the TECHNICAL group. null if the technical group wasn't provided.
  briefAdherenceScore: z.number().int().min(0).max(100).nullable(),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  // Short Arabic executive summary (2-4 sentences).
  summary: z.string(),
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
