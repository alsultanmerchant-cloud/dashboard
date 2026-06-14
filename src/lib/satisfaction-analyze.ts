import "server-only";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { SatisfactionSchema, type SatisfactionResult } from "@/lib/satisfaction-schema";
import { buildClientTranscripts, getClientExecutionSnapshot } from "@/lib/data/satisfaction";
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

  // The documented brief from project/task documents is the only source of
  // truth for brief-adherence. If it cannot be fetched, the score stays null;
  // the model must not infer the brief from internal team chat.
  const brief = await getClientBrief(orgId, clientId);
  const briefInstruction = brief
    ? `- briefAdherenceScore (0-100): قيّم مدى الالتزام بالبريف من وثيقة "البريف" أدناه فقط. قارن بنود البريف المكتوبة (المخرجات/المتطلبات/النطاق) بما يظهر في محادثات العميل والفريق وبيانات رواسم: منفّذ، قيد التنفيذ، غير منفّذ، أو لا يوجد دليل. الدرجة تعكس الالتزام ببنود البريف الموثقة، وليست رضا العميل العام. لا تخفضها بسبب شكاوى عامة غير موجودة في البريف. اربط أي خفض ببند بريف محدد.`
    : `- briefAdherenceScore: أعده null لأن نص وثيقة البريف غير متاح في مدخلات التحليل. لا تستنتج الالتزام بالبريف من مجموعة الفريق التقني أو من المحادثات.`;
  const briefBlock = brief
    ? `\n\n=== البريف (وثيقة متطلبات العميل من ملفات المشروع) ===\nالمصدر: ${brief.filename} (${brief.source})\n${trim(brief.text, Math.min(brief.text.length, 15_000))}`
    : "\n\n=== البريف ===\n(لم يتم العثور على نص بريف قابل للقراءة من ملفات المشروع/المهام لهذا العميل)";

  // Real delivery state from Rawasm — the client's actually-overdue tasks and
  // the stages they're stuck in. Feeding this lets the model CORRELATE chat
  // complaints with concrete delayed work and give grounded recommendations
  // (the team's explicit ask: "compare the chat with the tasks in Rawasm").
  const execution = await getClientExecutionSnapshot(orgId, clientId);
  const executionBlock = execution
    ? `\n\n=== العمل الفعلي في رواسم (المهام المتأخرة) ===\n(بيانات نظام تُزامَن دوريًا من أودو وقد تكون غير محدّثة لحظيًا؛ أرقام «في هذه المرحلة منذ» تقريبية وتقيس المدة منذ آخر تحديث للمرحلة فقط — ليست «مدة تأخير اعتماد» دقيقة.)\nإجمالي المهام: ${execution.totalTasks} — متأخرة: ${execution.overdueCount}${
        execution.maxDaysStuck != null ? ` — أطول ركود: ${execution.maxDaysStuck} يوم` : ""
      }\nتوزّع المتأخرات على المراحل: ${execution.byStage
        .map((s) => `${s.stage} (${s.count})`)
        .join("، ")}\nأبرز المهام العالقة:\n${execution.topTasks
        .map(
          (t) =>
            `- ${t.taskCode ? `[${t.taskCode}] ` : ""}${t.title} — مرحلة: ${t.stage}${
              t.daysStuck != null ? ` — في هذه المرحلة منذ ~${t.daysStuck} يوم` : ""
            }${t.delayDays != null ? ` — متأخرة ${t.delayDays} يوم عمل` : ""}`,
        )
        .join("\n")}`
    : "\n\n=== العمل الفعلي في رواسم ===\n(لا توجد مهام متأخرة مسجّلة لهذا العميل في رواسم)";

  const runOnce = async (budget: number) =>
    (
      await generateObject({
        model: google(MODEL),
        maxRetries: 2,
        schema: SatisfactionSchema,
        prompt: `أنت محلل علاقات عملاء في وكالة تسويق سعودية (Sky Light). حلّل حالة العميل "${client.name}" من خلال محادثات واتساب، والبريف الموثق عند توفره، وبيانات العمل في رواسم:
${
  windowKind === "week"
    ? `\n⏱️ النطاق الزمني: آخر ٧ أيام فقط (الوضع الحالي للعميل). قيّم رضاه بناءً على هذه الفترة الأخيرة فقط — لا تُحمّل التقييم بشكاوى أو أحداث أقدم من ذلك.\n`
    : `\n⏱️ النطاق الزمني: كامل تاريخ التعامل مع العميل (نظرة شاملة).\n`
}

1) "مجموعة العميل" — التواصل المباشر مع العميل (هنا يظهر الرضا، الشكاوى، التعديلات، نبرة العميل).
2) "مجموعة الفريق التقني" — التنسيق الداخلي للفريق حول التنفيذ والتسليم، ويُستخدم كسياق فقط لاستخراج سبب التأخير أو الاحتكاك.
3) "البريف" — وثيقة متطلبات العميل من ملفات المشروع/المهام، وهي مصدر قياس الالتزام بالبريف فقط.
4) "العمل الفعلي في رواسم" — المهام المتأخرة الحقيقية للعميل ومراحلها (بيانات نظام، ليست محادثة).

التعليمات:
- satisfactionScore (0-100): من نبرة العميل ونتائج التعامل في "مجموعة العميل".
${briefInstruction}
- sentiment, summary (عربي ٢-٤ جمل), highlights (ثناء/شكوى/طلب/تصعيد/إنجاز مع التاريخ)، sentimentTimeline (period مثل 2026-04)، risks (الأهم أولًا).
- recommendations (توصيات قابلة للتنفيذ للفريق، الأهم أولًا، حتى ٦): اربط ما يشكو منه العميل أو يطلبه في المحادثة بالعمل الفعلي في رواسم. لكل توصية: issue = المشكلة موصولة بالواقع (مثال: «العميل يستعجل تسليم الحملة، ويوجد فعليًا في رواسم مهمتان متأخرتان عالقتان في مرحلة التصميم منذ ١٢ يومًا»)، action = الخطوة العملية التالية (مثال: «تصعيد مهمة PRJ-007-014 لقسم التصميم وتحديد موعد تسليم للعميل»). استخدم رموز/عناوين المهام من قسم رواسم عند توفرها. لا تخترع مهامًا غير مذكورة. إن لم توجد مشكلة جوهرية تستحق توصية، أعِد مصفوفة فارغة.
- حدود استخدام بيانات رواسم: اذكر رقم «في هذه المرحلة منذ» كما ورد حرفيًا ولا تُعِد صياغته كـ«تأخّر في اعتماد العميل X أيام» أو أي مقياس آخر. لا تنسب لأي مهمة أثرًا لم يُذكر صراحةً (مثل «يعيق تقدّم الحملات» أو «يؤخّر النتائج») ما لم يقُل العميل ذلك بنفسه في «مجموعة العميل». اربط مهمة متأخرة بتوصية فقط حين يشكو العميل فعليًا في المحادثة من النقطة نفسها؛ وإلا فاذكرها كسياق تشغيلي محايد دون استنتاج تأثير.
- لكل عنصر في highlights حدّد audience:
  • "client" = رسالة أو موقف صادر من العميل نفسه (طلب/شكوى/ثناء حقيقي من العميل).
  • "team" = تنسيق داخلي بين الفريق (مثل أن يستعجل الأكاونت مانجر العميل على الاعتماد). لا تَعُدّ رسائل الفريق الداخلية طلباتٍ للعميل.
- "إنجاز" (milestone) للمخرجات الجوهرية المعتمدة فقط (إطلاق حملة، اعتماد تصميم/تسليم، نتيجة قابلة للقياس). الخطوات اللوجستية الروتينية (إرسال دعوات وصول، جدولة اجتماع، تبادل صلاحيات) ليست إنجازًا. الاسترداد المالي أو إنهاء التعاقد أو مغادرة العميل أو فسخ الاتفاق ليست إنجازًا أبدًا — صنّفها "تصعيد" (escalation) واعكسها في خفض satisfactionScore والمخاطر.
- نص كل highlight يجب أن يكون مقتبسًا فعليًا من رسالة موجودة أو تلخيصًا أمينًا لها — لا تخترع رسائل أو تفاصيل (مثل "تم اعتماد/الانتهاء") غير واردة حرفيًا.
- ميّز بين الطلب/الاستفسار المحايد والشكوى: طلب خيارات إضافية أو استفسار عادي ليس شكوى ولا تبنِ عليه عدم رضا. لكن عدم الوفاء بوعد (وعدٌ بموعد ولم يُسلَّم)، أو تكرار المتابعة دون استجابة، أو احتكاك في العملية، إشاراتٌ سلبية حقيقية صنّفها شكوى/طلبًا واخفِض الدرجة بمقدارها — دون مبالغة في أي اتجاه.
- درجات الرضا: 75+ تتطلب رضا واضحًا أو ثناءً صريحًا من العميل. علاقة تعاونية لكن فيها احتكاك لوجستي أو تأخيرات = محايد/متباين (55-70)، وليست "إيجابية".
- في المشاريع الجديدة/مرحلة الإعداد التي لم تُسلَّم فيها مخرجات بعد، اذكر في الملخص أن التقييم مبكّر إذا كانت إشارات الرضا محدودة.
استند فقط لما ورد في المحادثات والبريف وبيانات رواسم.

=== مجموعة العميل ===
${trim(clientBlock, budget)}

=== مجموعة الفريق التقني ===
${trim(technicalBlock, budget)}${briefBlock}${executionBlock}`,
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
  if (!brief) result.briefAdherenceScore = null;

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
      recommendations: result.recommendations,
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
      briefUsed: brief ? { source: brief.source, filename: brief.filename, url: brief.url } : null,
      windowKind,
    },
    importance: result.satisfactionScore < 50 ? "high" : "normal",
  });

  return { analysisId: inserted.id, result };
}
