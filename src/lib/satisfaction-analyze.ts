import "server-only";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { SatisfactionSchema, type SatisfactionResult } from "@/lib/satisfaction-schema";
import { buildClientTranscripts } from "@/lib/data/satisfaction";
import { getClientBrief } from "@/lib/satisfaction-brief";
import { GEMINI_MODEL } from "@/lib/ai-model";

// Shared client-satisfaction analysis core. Used by the on-demand API route
// (/api/satisfaction/analyze) AND the daily cron (/api/cron/wa-analyze).
// Reads the merged transcript (one-time .txt import + live WhatsApp messages),
// runs Gemini, and stores the result as the client's current analysis.

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = GEMINI_MODEL;
const MAX_CHARS = 45_000;

function trim(t: string, budget: number = MAX_CHARS): string {
  if (t.length <= budget) return t;
  return "…(الأقدم محذوف)\n" + t.slice(t.length - budget);
}

export class NoTranscriptError extends Error {
  constructor() {
    super("لا توجد محادثات مستوردة لهذا العميل بعد");
    this.name = "NoTranscriptError";
  }
}

export interface AnalyzeOutcome {
  analysisId: string;
  result: SatisfactionResult;
}

// Default "current status" window: the last 7 days of live conversation.
const CURRENT_WINDOW_DAYS = 7;

export interface AnalyzeOptions {
  // 'week' (default) → current-status analysis over the last 7 days; this is
  // the one that feeds the board + executive index (sets is_current).
  // 'all' → on-demand full-history snapshot, stored but never is_current.
  windowKind?: "week" | "all";
}

export class NoRecentActivityError extends Error {
  constructor() {
    super("لا توجد رسائل حديثة لهذا العميل في آخر ٧ أيام");
    this.name = "NoRecentActivityError";
  }
}

export async function analyzeClientSatisfaction(
  orgId: string,
  clientId: string,
  actorUserId: string | null,
  opts?: AnalyzeOptions,
): Promise<AnalyzeOutcome> {
  const windowKind = opts?.windowKind ?? "week";
  const sinceDays = windowKind === "week" ? CURRENT_WINDOW_DAYS : undefined;
  const windowStart = sinceDays
    ? new Date(Date.now() - sinceDays * 86_400_000).toISOString()
    : null;
  const windowEnd = new Date().toISOString();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("name")
    .eq("organization_id", orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("العميل غير موجود");

  const transcripts = await buildClientTranscripts(orgId, clientId, { sinceDays });
  if (!transcripts.client && !transcripts.technical) {
    // A windowed run with nothing recent is not a hard error — it just means
    // the client has been quiet (the team explicitly wants "quiet = not a live
    // complaint"). Signal it distinctly so callers can fall back to all-time.
    throw windowKind === "week" ? new NoRecentActivityError() : new NoTranscriptError();
  }

  const clientBlock = transcripts.client || "(لم تتوفر محادثة مع العميل)";
  const technicalBlock = transcripts.technical || "(لم تتوفر محادثة الفريق التقني)";

  // The documented brief (Google Doc from the project's documents) is the source
  // of truth for brief-adherence when available; otherwise we fall back to
  // inferring it from the technical group's coordination.
  const brief = await getClientBrief(orgId, clientId);

  const briefInstruction = brief
    ? `- briefAdherenceScore (0-100): مدى مطابقة العمل المُسلَّم (كما يظهر في المحادثتين) لمتطلبات العميل الموثقة في "البريف" أدناه. قارن بنودًا فعلية. null فقط إذا تعذّر الحكم.`
    : `- briefAdherenceScore (0-100): مدى مطابقة التنفيذ لمتطلبات العميل كما يظهر في "مجموعة الفريق التقني". null إن لم تتوفر.`;

  const briefBlock = brief
    ? `\n\n=== البريف (متطلبات العميل الموثقة) ===\n${trim(brief.text, Math.min(brief.text.length, 15_000))}`
    : "";

  const runOnce = async (budget: number) =>
    (
      await generateObject({
        model: google(MODEL),
        maxRetries: 2,
        schema: SatisfactionSchema,
        prompt: `أنت محلل علاقات عملاء في وكالة تسويق سعودية (Sky Light). قيّم رضا العميل "${client.name}" وجودة التنفيذ من خلال محادثتي واتساب${brief ? " والبريف الموثق" : ""}:
${
  windowKind === "week"
    ? `\n⏱️ النطاق الزمني: آخر ٧ أيام فقط (الوضع الحالي للعميل). قيّم رضاه بناءً على هذه الفترة الأخيرة فقط — لا تُحمّل التقييم بشكاوى أو أحداث أقدم من ذلك.\n`
    : `\n⏱️ النطاق الزمني: كامل تاريخ التعامل مع العميل (نظرة شاملة).\n`
}

1) "مجموعة العميل" — التواصل المباشر مع العميل (هنا يظهر الرضا، الشكاوى، التعديلات، نبرة العميل).
2) "مجموعة الفريق التقني" — التنسيق الداخلي للفريق حول البريف والتنفيذ.${brief ? '\n3) "البريف" — وثيقة متطلبات العميل الأساسية المعتمدة في بداية المشروع.' : ""}

التعليمات:
- satisfactionScore (0-100): من نبرة العميل ونتائج التعامل في "مجموعة العميل".
${briefInstruction}
- sentiment, summary (عربي ٢-٤ جمل), highlights (ثناء/شكوى/طلب/تصعيد/إنجاز مع التاريخ)، sentimentTimeline (period مثل 2026-04)، risks (الأهم أولًا).
- لكل عنصر في highlights حدّد audience:
  • "client" = رسالة أو موقف صادر من العميل نفسه (طلب/شكوى/ثناء حقيقي من العميل).
  • "team" = تنسيق داخلي بين الفريق (مثل أن يستعجل الأكاونت مانجر العميل على الاعتماد). لا تَعُدّ رسائل الفريق الداخلية طلباتٍ للعميل.
- "إنجاز" (milestone) للمخرجات الجوهرية المعتمدة فقط (إطلاق حملة، اعتماد تصميم/تسليم، نتيجة قابلة للقياس). الخطوات اللوجستية الروتينية (إرسال دعوات وصول، جدولة اجتماع، تبادل صلاحيات) ليست إنجازًا. الاسترداد المالي أو إنهاء التعاقد أو مغادرة العميل أو فسخ الاتفاق ليست إنجازًا أبدًا — صنّفها "تصعيد" (escalation) واعكسها في خفض satisfactionScore والمخاطر.
- نص كل highlight يجب أن يكون مقتبسًا فعليًا من رسالة موجودة أو تلخيصًا أمينًا لها — لا تخترع رسائل أو تفاصيل (مثل "تم اعتماد/الانتهاء") غير واردة حرفيًا.
- ميّز بين الطلب/الاستفسار المحايد والشكوى: طلب خيارات إضافية أو استفسار عادي ليس شكوى ولا تبنِ عليه عدم رضا. لكن عدم الوفاء بوعد (وعدٌ بموعد ولم يُسلَّم)، أو تكرار المتابعة دون استجابة، أو احتكاك في العملية، إشاراتٌ سلبية حقيقية صنّفها شكوى/طلبًا واخفِض الدرجة بمقدارها — دون مبالغة في أي اتجاه.
- درجات الرضا: 75+ تتطلب رضا واضحًا أو ثناءً صريحًا من العميل. علاقة تعاونية لكن فيها احتكاك لوجستي أو تأخيرات = محايد/متباين (55-70)، وليست "إيجابية".
- في المشاريع الجديدة/مرحلة الإعداد التي لم تُسلَّم فيها مخرجات بعد، اجعل briefAdherenceScore متحفظًا واذكر في الملخص أن التقييم مبكّر.
استند فقط لما ورد في المحادثات${brief ? " والبريف" : ""}.

=== مجموعة العميل ===
${trim(clientBlock, budget)}

=== مجموعة الفريق التقني ===
${trim(technicalBlock, budget)}${briefBlock}`,
      })
    ).object;

  // The model can occasionally fail structured output on long/messy
  // transcripts. Retry with a progressively SMALLER transcript each attempt —
  // a tighter input is much more likely to yield schema-valid output.
  const budgets = [MAX_CHARS, 22_000, 10_000, 5_000];
  let result: Awaited<ReturnType<typeof runOnce>> | undefined;
  let lastErr: unknown;
  for (const budget of budgets) {
    try {
      result = await runOnce(budget);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!result) throw lastErr instanceof Error ? lastErr : new Error("analysis failed");

  // Latest import ids (for provenance), best-effort.
  const { data: imp } = await supabaseAdmin
    .from("client_chat_imports")
    .select("id, group_kind, created_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  const rows = (imp ?? []) as Array<{ id: string; group_kind: string }>;
  const clientImportId = rows.find((r) => r.group_kind === "client")?.id ?? null;
  const technicalImportId = rows.find((r) => r.group_kind === "technical")?.id ?? null;

  // Only the current-status (weekly) analysis becomes is_current — that's what
  // the board + executive index read, so they reflect the client's NOW. An
  // all-time run is stored as a historical snapshot and never takes over the
  // headline.
  const isCurrent = windowKind === "week";
  if (isCurrent) {
    await supabaseAdmin
      .from("client_satisfaction_analyses")
      .update({ is_current: false })
      .eq("organization_id", orgId)
      .eq("client_id", clientId)
      .eq("is_current", true);
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .insert({
      organization_id: orgId,
      client_id: clientId,
      satisfaction_score: result.satisfactionScore,
      brief_adherence_score: result.briefAdherenceScore,
      sentiment: result.sentiment,
      summary: result.summary,
      highlights: result.highlights,
      sentiment_timeline: result.sentimentTimeline,
      risks: result.risks,
      model: MODEL,
      client_import_id: clientImportId,
      technical_import_id: technicalImportId,
      is_current: isCurrent,
      window_kind: windowKind,
      window_start: windowStart,
      window_end: windowEnd,
      analyzed_by: actorUserId,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(insErr?.message ?? "تعذر حفظ التحليل");

  await logAudit({
    organizationId: orgId,
    actorUserId,
    action: "client.satisfaction_analyzed",
    entityType: "client",
    entityId: clientId,
    metadata: { score: result.satisfactionScore, sentiment: result.sentiment, windowKind },
  });
  await logAiEvent({
    organizationId: orgId,
    actorUserId,
    eventType: "CLIENT_SATISFACTION_ANALYZED",
    entityType: "client",
    entityId: clientId,
    payload: {
      satisfactionScore: result.satisfactionScore,
      briefAdherenceScore: result.briefAdherenceScore,
      sentiment: result.sentiment,
      briefUsed: brief ? brief.url : null,
      windowKind,
    },
    importance: result.satisfactionScore < 50 ? "high" : "normal",
  });

  return { analysisId: inserted.id, result };
}
