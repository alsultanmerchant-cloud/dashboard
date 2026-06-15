import "server-only";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import {
  SatisfactionSchema,
  type SatisfactionResult,
  RISK_INDICATORS,
} from "@/lib/satisfaction-schema";
import {
  buildClientTranscripts,
  getClientExecutionSnapshot,
  getClientContractContext,
  getClientContractActivity,
} from "@/lib/data/satisfaction";
import { getClientBrief } from "@/lib/satisfaction-brief";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
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
    ? `\n\n=== البريف (وثيقة متطلبات العميل من ملفات المشروع) ===\nالمصدر: ${brief.filename} (${brief.source}, ${brief.kind})\n${trim(brief.text, Math.min(brief.text.length, 15_000))}`
    : "\n\n=== البريف ===\n(لم يتم العثور على نص بريف قابل للقراءة من ملفات المشروع/المهام لهذا العميل)";

  // Real delivery state from Rawasm — the client's actually-overdue tasks and
  // the stages they're stuck in. Feeding this lets the model CORRELATE chat
  // complaints with concrete delayed work and give grounded recommendations
  // (the team's explicit ask: "compare the chat with the tasks in Rawasm").
  const execution = await getClientExecutionSnapshot(orgId, clientId);
  const bottleneckLine =
    execution && execution.bottlenecks.length
      ? `\nBottlenecks (تركّز التأخير): ${execution.bottlenecks
          .map((b) => `${b.stage} ${b.pct}% (${b.count})`)
          .join("، ")}`
      : "";
  const executionBlock = execution
    ? `\n\n=== التاسكات والمشروع (مواعيد التسليم + Bottlenecks) ===\n(بيانات نظام تُزامَن دوريًا من أودو وقد تكون غير محدّثة لحظيًا؛ أرقام «في هذه المرحلة منذ» تقريبية وتقيس المدة منذ آخر تحديث للمرحلة فقط — ليست «مدة تأخير اعتماد» دقيقة.)\nإجمالي المهام: ${execution.totalTasks} — متأخرة: ${execution.overdueCount}${
        execution.maxDaysStuck != null ? ` — أطول ركود: ${execution.maxDaysStuck} يوم` : ""
      }${bottleneckLine}\nأبرز المهام العالقة (مع موعد التسليم إن وُجد):\n${execution.topTasks
        .map(
          (t) =>
            `- ${t.taskCode ? `[${t.taskCode}] ` : ""}${t.title} — مرحلة: ${t.stage}${
              t.dueDate ? ` — موعد التسليم: ${t.dueDate}` : ""
            }${t.daysStuck != null ? ` — في هذه المرحلة منذ ~${t.daysStuck} يوم` : ""}${
              t.delayDays != null ? ` — متأخرة ${t.delayDays} يوم عمل` : ""
            }`,
        )
        .join("\n")}`
    : "\n\n=== التاسكات والمشروع ===\n(لا توجد مهام متأخرة مسجّلة لهذا العميل في رواسم)";

  // Contract status — the commercial dimension of the big picture. Lets the
  // model weigh relationship/execution signals against contract health.
  const contract = await getClientContractContext(orgId, clientId);
  // Contract activity log — the trajectory (holds, edits, close/renew) that the
  // snapshot can't show. Behavioral signal for the commercial dimension.
  const activity = await getClientContractActivity(orgId, clientId);
  const activityBlock = activity.length
    ? `\nسجل نشاط العقد (الأحدث أولًا — أحداث سلوكية: ON HOLD=تجميد/احتكاك، HOLD LIFTED=رفع التجميد، Contract Close (Lost)=خسارة/إنهاء، Contract Close (Renew)=تجديد، EDIT MODE=تعديل بنود):\n${activity
        .map(
          (a) =>
            `- ${a.logTime ? a.logTime.slice(0, 10) : "?"} ${a.logType}${
              a.notes ? ` — ${a.notes.replace(/\s+/g, " ").trim().slice(0, 240)}` : ""
            }`,
        )
        .join("\n")}`
    : "";
  const contractBlock = contract
    ? `\n\n=== حالة العقد ===\nالوضع (target): ${contract.target} — الحالة (status): ${contract.status}\nالقيمة الإجمالية: ${contract.totalValue} — المدفوع: ${contract.paidValue} — المتبقّي: ${
        contract.totalValue - contract.paidValue
      }\nتاريخ البداية: ${contract.startDate}${contract.endDate ? ` — تاريخ الانتهاء: ${contract.endDate}` : ""}${activityBlock}`
    : `\n\n=== حالة العقد ===\n(لا يوجد عقد مسجّل لهذا العميل)${activityBlock}`;

  // Org-wide lessons the team taught the AI — applied to this analysis too.
  const knowledgeBlock = await buildKnowledgeBlock(orgId);

  const runOnce = async (budget: number) =>
    (
      await generateObject({
        model: google(MODEL),
        maxRetries: 2,
        schema: SatisfactionSchema,
        prompt: `أنت محلل علاقات عملاء في وكالة تسويق سعودية (Sky Light). حلّل حالة العميل "${client.name}" من خلال أربعة مصادر مفصولة: مجموعة العميل 💫، مجموعة الفريق التقني 📍، التاسكات والمشروع، وحالة العقد — بالإضافة للبريف الموثق عند توفره. اقرأ كل مصدر على حدة، استخرج إشاراته الخاصة، ثم ادمج الكل في "الصورة الكبرى" (big picture).
${
  windowKind === "week"
    ? `\n⏱️ النطاق الزمني: آخر ٧ أيام فقط (الوضع الحالي للعميل). قيّم بناءً على هذه الفترة الأخيرة فقط — لا تُحمّل التقييم بشكاوى أو أحداث أقدم من ذلك.\n`
    : `\n⏱️ النطاق الزمني: كامل تاريخ التعامل مع العميل (نظرة شاملة).\n`
}
وصف المصادر:
1) "مجموعة العميل 💫" — التواصل المباشر مع العميل (الرضا، الشكاوى، التعديلات، الاعتمادات، نبرة العميل).
2) "مجموعة الفريق التقني 📍" — التنسيق الداخلي (المشاكل التي تمنع التنفيذ، أسباب التأخير، تقييم الفريق للحساب). سياق فقط — ليست طلبات العميل.
3) "التاسكات والمشروع" — المهام المتأخرة الحقيقية ومراحلها ومواعيد التسليم و Bottlenecks (بيانات نظام، ليست محادثة).
4) "حالة العقد" — وضع العقد المالي والتعاقدي (البُعد التجاري).

التعليمات حسب المخرجات:

— الحالة الحالية —
- summary: ٢-٤ جمل بالعربية تلخّص الوضع الآن.
- satisfactionScore (0-100): من نبرة العميل ونتائج التعامل في "مجموعة العميل" فقط.
${briefInstruction}
- sentiment، sentimentTimeline (period مثل 2026-04).

— bigPicture (الصورة الكبرى — اجمع كل مصدر) —
- relationshipScore (0-100): من مجموعة العميل (النبرة + الاعتمادات + التعاون).
- executionScore (0-100): من مجموعة الفريق التقني + التاسكات (التأخيرات + Bottlenecks + المهام العالقة).
- commercialScore (0-100): من حالة العقد + سجل نشاط العقد (On-Target/مدفوعات سليمة = مرتفع، Overdue/متأخرات = منخفض). التجميد ON HOLD والتعديلات المتكررة = إشارات سلبية على الاستقرار؛ التجديد Renew = إيجابي؛ الخسارة/الإغلاق Lost = منخفض جدًا. اقرأ ملاحظات أحداث الإغلاق لمعرفة السبب وانعكسه في causes/risks عند الأهمية. أعده null إن لم يوجد عقد.
- accountHealth: healthy / watch / at_risk / critical — حكم شامل يوازن الأبعاد الثلاثة (علاقة متوترة على عقد Overdue = critical).
- headline: جملة واحدة تربط الأبعاد ("الخلاصة").

— indicators (المؤشرات — استخرجها من المصادر، استخدم الأكواد التالية حصراً) —
كل عنصر: { code, severity, source, evidence (اقتباس/تلخيص حقيقي), date }.
🔴 مخاطر (severity=red): client_complained (اشتكى)، client_dissatisfied (عدم رضا)، client_threatened_cancellation (هدد بالإلغاء/التوقف)، client_compared_competitor (قارن بمنافس)، client_complained_about_person (اشتكى من شخص)، client_repeated_complaint (كرّر نفس الشكوى)، client_question_unanswered (سؤال مهم بلا رد لفترة)، major_task_delay (تأخير كبير في مهمة مؤثرة)، client_corrected_am_repeatedly (صحّح فهم الأكاونت عدة مرات)، client_vs_team_mismatch (تضارب بين طلب العميل وما نُقل للتيم)، team_reported_unclear_requirements (التيم أبلغ عن غموض المتطلبات من الأكاونت).
🟡 تشغيلية (severity=yellow): team_reported_blocker (مشكلة تمنع التنفيذ)، missing_access (صلاحيات ناقصة)، missing_brief (بريف ناقص)، client_uncooperative (غير متعاون)، client_late_approvals (متأخر في الاعتمادات بشكل مؤثر)، conflicting_client_requests (تضارب بين طلبات العميل)، am_not_understanding (الأكاونت غير فاهم/كرّر طلب التوضيح).
لا تخترع أكواداً خارج القائمة. أصدر المؤشر فقط عند وجود دليل صريح. source = client أو technical أو tasks بحسب أين ظهر.

— clientGroupSignals (من مجموعة العميل فقط) —
- requests: عدّ {new, edit, complaint, inquiry, approval}.
- approvals: عدّ {approved, rejected, changesRequested, noResponse}.
- responseSpeed: fast/medium/slow/unknown (متوسط سرعة تعاون/رد العميل).

— technicalGroupSignals (من مجموعة الفريق التقني + التاسكات) —
- blockers: المشاكل الداخلية (التصميم متأخر، المحتوى متأخر، الحملة لم تبدأ، محتاجين بيانات من العميل، مشكلة تقنية...).
- delayCauses: [{cause, attributedTo}] حيث attributedTo = client/account_manager/team/department/unknown.
- accountEvaluation: تقييم الفريق الداخلي (العميل غير واضح، يغيّر رأيه كثيراً، الأكاونت غير فاهم، البريف ناقص...).

— causes (أسباب المشاكل) —
[{problem, rootCause, owner}] — لكل مشكلة جوهرية سببها الجذري ومن يملكها (نفس قيم attributedTo).

— recommendations (الأكشنز المقترحة، الأهم أولاً، حتى ٦) —
اربط ما يشكو/يطلبه العميل بالعمل الفعلي في التاسكات. issue = المشكلة موصولة بالواقع، action = الخطوة العملية. استخدم رموز/عناوين المهام عند توفرها. لا تخترع مهاماً. إن لم توجد مشكلة جوهرية أعِد مصفوفة فارغة.

ضوابط عامة:
- حدود رواسم: اذكر رقم «في هذه المرحلة منذ» كما ورد ولا تُعِد صياغته كـ«تأخّر اعتماد X أيام». لا تنسب لمهمة أثراً لم يُذكر صراحةً ما لم يقُله العميل في مجموعته.
- highlights: لكل عنصر audience: "client" (من العميل) أو "team" (تنسيق داخلي). نص كل عنصر اقتباس حقيقي أو تلخيص أمين — لا تخترع رسائل أو "تم الاعتماد/الانتهاء". milestone للمخرجات المعتمدة الجوهرية فقط؛ الاسترداد المالي/فسخ التعاقد/مغادرة العميل = escalation وليست milestone.
- ميّز الاستفسار المحايد عن الشكوى. عدم الوفاء بوعد أو تكرار المتابعة دون رد أو احتكاك العملية = إشارات سلبية حقيقية.
- درجات الرضا: 75+ تتطلب رضا/ثناءً صريحاً. علاقة فيها احتكاك لوجستي/تأخيرات = 55-70 (محايد/متباين) وليست إيجابية.
- في المشاريع الجديدة بلا مخرجات مُسلَّمة، اذكر أن التقييم مبكّر إذا كانت الإشارات محدودة.
استند فقط لما ورد في المصادر أدناه.

=== مجموعة العميل 💫 ===
${trim(clientBlock, budget)}

=== مجموعة الفريق التقني 📍 ===
${trim(technicalBlock, budget)}${briefBlock}${executionBlock}${contractBlock}${knowledgeBlock ? `\n\n${knowledgeBlock}` : ""}`,
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
      indicators: result.indicators,
      client_group_signals: result.clientGroupSignals,
      technical_group_signals: result.technicalGroupSignals,
      causes: result.causes,
      big_picture: result.bigPicture,
      contract_context: contract ? { ...contract, recentActivity: activity } : null,
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
      accountHealth: result.bigPicture.accountHealth,
      // The red (relationship-risk) indicator codes detected this run — the
      // headline triage signals the team acts on.
      redIndicators: result.indicators
        .filter((i) => (RISK_INDICATORS as readonly string[]).includes(i.code))
        .map((i) => i.code),
      briefUsed: brief ? { source: brief.source, kind: brief.kind, filename: brief.filename, url: brief.url } : null,
      windowKind,
    },
    importance:
      result.satisfactionScore < 50 ||
      result.bigPicture.accountHealth === "critical" ||
      result.bigPicture.accountHealth === "at_risk"
        ? "high"
        : "normal",
  });

  return { analysisId: inserted.id, result };
}
