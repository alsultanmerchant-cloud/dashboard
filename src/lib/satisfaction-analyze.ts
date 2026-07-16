import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import type { ModelMessage, UserContent } from "ai";
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
  getClientStoredMediaAttachments,
  type ExecutionTask,
} from "@/lib/data/satisfaction";
import {
  getClientTeamActivitySnapshot,
  renderTeamActivityBlock,
  type ClientTeamActivitySnapshot,
} from "@/lib/data/satisfaction-team";
import { getClientBrief } from "@/lib/satisfaction-brief";
import {
  isContractPaymentComplete,
  summarizeContractPayments,
} from "@/lib/data/satisfaction-rules";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { getClientDisplayNameMap } from "@/lib/data/clients";
import { aiModel, MODELS } from "@/lib/ai-model";

// Shared client-satisfaction analysis core. Used by the on-demand API route
// (/api/satisfaction/analyze), the streaming re-analyze route
// (/api/satisfaction/analyze/stream), AND the daily cron (/api/cron/wa-analyze).
// Reads the merged transcript (one-time .txt import + live WhatsApp messages),
// runs Gemini, and stores the result as the client's current analysis.
//
// The pipeline is split into three reusable steps so the blocking and streaming
// paths share identical input-building + persistence:
//   buildSatisfactionInput → (generateObject | streamObject) → persistSatisfaction

const MODEL = MODELS.flagship;
export const SATISFACTION_MODEL = MODEL;
export const SATISFACTION_MAX_CHARS = 45_000;
const MAX_CHARS = SATISFACTION_MAX_CHARS;

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

// Everything needed to run the model + persist the result. `makePrompt(budget)`
// rebuilds the prompt at a smaller transcript budget for the retry-shrink loop.
export interface SatisfactionInput {
  clientName: string;
  windowKind: "week" | "all";
  windowStart: string | null;
  windowEnd: string;
  sourceLatestMessageAt: string | null;
  hadNewMessages: boolean | null;
  brief: Awaited<ReturnType<typeof getClientBrief>>;
  contract: Awaited<ReturnType<typeof getClientContractContext>>;
  activity: Awaited<ReturnType<typeof getClientContractActivity>>;
  // The accountability roster (people + stuck tasks + gaps) fed to the model.
  // Frozen into the analysis and used to validate the model's `accountability`
  // output — any name/task-code not present here is dropped on persist.
  team: ClientTeamActivitySnapshot;
  // The client-group transcript alone — reused by the examples repair pass to
  // re-extract the per-request quotes the main call sometimes drops.
  clientTranscript: string;
  makePrompt: (budget: number) => string;
  makeMessages: (budget: number) => ModelMessage[];
}

// Step 1 — assemble the four sources + brief + knowledge into a prompt builder.
// Throws NoRecentActivityError / NoTranscriptError when there's nothing to read.
export async function buildSatisfactionInput(
  orgId: string,
  clientId: string,
  opts?: AnalyzeOptions,
): Promise<SatisfactionInput> {
  const windowKind = opts?.windowKind ?? "week";
  const windowEnd = new Date().toISOString();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("name")
    .eq("organization_id", orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("العميل غير موجود");

  // Contracts own client identity — analyze (and label) the client by its
  // contract-sheet name, not the raw Odoo project name. See
  // [[project_client_display_name_resolver]].
  const displayNames = await getClientDisplayNameMap(orgId);
  const clientName = displayNames.get(clientId) ?? (client.name as string);

  // A weekly ("current status") run normally reads the last 7 days. But when the
  // groups have been quiet (no new messages because traffic genuinely paused, or
  // the live feed lagged), a strict 7-day window dead-ends with NoRecentActivity
  // on every click. So progressively WIDEN the window until we find the latest
  // available conversation — the operator gets a real analysis of the most recent
  // activity instead of an error, with effectiveDays recording what was used.
  let effectiveDays: number | undefined =
    windowKind === "week" ? CURRENT_WINDOW_DAYS : undefined;
  let transcripts = await buildClientTranscripts(orgId, clientId, { sinceDays: effectiveDays });
  if (windowKind === "week" && !transcripts.client && !transcripts.technical) {
    for (const d of [30, 90, 180]) {
      transcripts = await buildClientTranscripts(orgId, clientId, { sinceDays: d });
      if (transcripts.client || transcripts.technical) {
        effectiveDays = d;
        break;
      }
    }
    // Last resort: all available history (also folds in the one-time .txt seed).
    if (!transcripts.client && !transcripts.technical) {
      transcripts = await buildClientTranscripts(orgId, clientId);
      effectiveDays = undefined;
    }
  }
  if (!transcripts.client && !transcripts.technical) {
    throw windowKind === "week" ? new NoRecentActivityError() : new NoTranscriptError();
  }
  const { data: previousAnalysis } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .select("created_at, big_picture")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previousBigPicture = previousAnalysis?.big_picture as {
    _sourceLatestMessageAt?: string | null;
  } | null;
  const previousWatermark = previousAnalysis
    ? (previousBigPicture?._sourceLatestMessageAt ?? previousAnalysis.created_at)
    : null;
  const sourceLatestMessageAt = transcripts.latestMessageAt;
  const hadNewMessages = previousAnalysis
    ? Boolean(sourceLatestMessageAt && previousWatermark && sourceLatestMessageAt > previousWatermark)
    : null;
  const windowStart = effectiveDays
    ? new Date(Date.now() - effectiveDays * 86_400_000).toISOString()
    : null;

  const clientBlock = transcripts.client || "(لم تتوفر محادثة مع العميل)";
  const technicalBlock = transcripts.technical || "(لم تتوفر محادثة الفريق التقني)";

  const brief = await getClientBrief(orgId, clientId);
  const briefInstruction = brief
    ? `- briefAdherenceScore (0-100): قيّم مدى الالتزام بالبريف من وثيقة "البريف" أدناه فقط. قارن بنود البريف المكتوبة (المخرجات/المتطلبات/النطاق) بما يظهر في محادثات العميل والفريق وبيانات Rwasem/Odoo المستوردة إلى Sky Light: منفّذ، قيد التنفيذ، غير منفّذ، أو لا يوجد دليل. الدرجة تعكس الالتزام ببنود البريف الموثقة، وليست رضا العميل العام. لا تخفضها بسبب شكاوى عامة غير موجودة في البريف. اربط أي خفض ببند بريف محدد.
- briefAdherence: التفصيل الذي يفسّر الدرجة. { reason: جملة عربية واحدة تلخّص سبب هذه الدرجة، items: مصفوفة لكل بند مكتوب في البريف }. كل عنصر { requirement: نص البند/المخرج كما ورد في البريف، status: delivered (منفّذ) أو partial (جزئي) أو not_delivered (غير منفّذ) أو no_evidence (لا يوجد دليل في المصادر)، note: دليل قصير أو سبب الحالة (اقتباس/تلخيص أمين، أو null) }. اشمل البنود المنفّذة وغير المنفّذة معًا حتى يفهم الفريق أين الخلل بالضبط. لا تخترع بنوداً ليست في البريف.`
    : `- briefAdherenceScore: أعده null لأن نص وثيقة البريف غير متاح في مدخلات التحليل. لا تستنتج الالتزام بالبريف من مجموعة الفريق التقني أو من المحادثات.
- briefAdherence: أعده null لنفس السبب.`;
  const briefBlock = brief
    ? `\n\n=== البريف (وثيقة متطلبات العميل من ملفات المشروع) ===\nالمصدر: ${brief.filename} (${brief.source}, ${brief.kind})\n${trim(brief.text, Math.min(brief.text.length, 15_000))}`
    : "\n\n=== البريف ===\n(لم يتم العثور على نص بريف قابل للقراءة من ملفات المشروع/المهام لهذا العميل)";

  // Weekly ("current status") → live tasks only. Full-period → also include
  // archived/historical tasks as past problems. See satisfaction-team.ts.
  const includeArchivedTasks = windowKind === "all";
  const execution = await getClientExecutionSnapshot(orgId, clientId, includeArchivedTasks);
  const bottleneckLine =
    execution && execution.bottlenecks.length
      ? `\nBottlenecks (تركّز التأخير): ${execution.bottlenecks
          .map((b) => `${b.stage} ${b.pct}% (${b.count})`)
          .join("، ")}`
      : "";
  // A wound-down (lost/closed) client has EVERY task archived, so the snapshot's
  // task data IS the delivery record of a closed engagement — frame it that way
  // instead of "current work" or "stale historical noise".
  const executionScopeNote = execution?.allArchived
    ? "(هذا العميل عقده منتهٍ/مغلق وكل مهامه مؤرشفة في أودو 🗄️ — القائمة أدناه هي سجل التنفيذ الفعلي للتعامل المنتهي، وليست «مهامًا خاملة». اعتمدها كدليل على ما نُفّذ/تأخّر فعلاً.)"
    : includeArchivedTasks
      ? "(نطاق كامل التاريخ: تشمل القائمة مهامًا حالية ومهامًا مؤرشفة/تاريخية — المؤرشفة معلّمة 🗄️ وتمثّل مشاكل سابقة، لا الوضع الحالي.)"
      : "(الوضع الحالي: مهام نشطة فقط — المهام المؤرشفة مستبعدة لأن دورتها انتهت، إلا إن كان العميل منتهيًا فتُعرض مهامه المؤرشفة كسجل تنفيذ.)";
  const renderTask = (t: ExecutionTask) =>
    `- ${t.archived ? "🗄️ (مؤرشفة/تاريخية) " : ""}${t.taskCode ? `[${t.taskCode}] ` : ""}${t.title} — مرحلة: ${t.stage}${
      t.dueDate ? ` — موعد التسليم: ${t.dueDate}` : ""
    }${t.daysStuck != null ? ` — في هذه المرحلة منذ ~${t.daysStuck} يوم` : ""}${
      t.delayDays != null
        ? ` — متأخرة ${t.delayDays} يوم عمل`
        : t.archived && t.overdueDays != null
          ? ` — كان تأخّرها ~${t.overdueDays} يوم`
          : ""
    }`;
  // Delivery-state list (NOT gated on overdue): shows the AI what was actually
  // delivered vs still in-flight, so it can verify chat claims (e.g. "الحملة لم
  // تُطلق") against real task states (إطلاق الحملة = done) instead of guessing.
  const deliveryStateBlock =
    execution && execution.keyTasks.length
      ? `\nحالة التنفيذ الفعلية (منفّذ ✅ أو قيد التنفيذ — استخدمها للتحقق من مزاعم المحادثة قبل نسب أي تقصير):\n${execution.keyTasks
          .map(
            (t) =>
              `- ${t.done ? "✅ منفّذ" : "⏳ قيد التنفيذ"} ${t.archived ? "🗄️ " : ""}${t.taskCode ? `[${t.taskCode}] ` : ""}${t.title} — مرحلة: ${t.stage}${
                t.dueDate ? ` — موعد التسليم: ${t.dueDate}` : ""
              }`,
          )
          .join("\n")}`
      : "";
  const stuckBlock =
    execution && execution.topTasks.length
      ? `\nأبرز المهام العالقة/المتأخرة (مع موعد التسليم إن وُجد):\n${execution.topTasks
          .map(renderTask)
          .join("\n")}`
      : "";
  const executionBlock = execution
    ? `\n\n=== التاسكات والمشروع (مواعيد التسليم + Bottlenecks) ===\n(بيانات نظام تُزامَن دوريًا من أودو وقد تكون غير محدّثة لحظيًا؛ أرقام «في هذه المرحلة منذ» تقريبية وتقيس المدة منذ آخر تحديث للمرحلة فقط — ليست «مدة تأخير اعتماد» دقيقة.)\n${executionScopeNote}\nإجمالي المهام: ${execution.totalTasks} — متأخرة: ${execution.overdueCount}${
        execution.maxDaysStuck != null ? ` — أطول ركود: ${execution.maxDaysStuck} يوم` : ""
      }${bottleneckLine}${deliveryStateBlock}${stuckBlock}`
    : "\n\n=== التاسكات والمشروع ===\n(لا توجد مهام Rwasem/Odoo مستوردة لهذا العميل في Sky Light)";

  const contract = await getClientContractContext(orgId, clientId);
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
  // A client commonly holds SEVERAL contracts at once (one per service/project).
  // List every live contract, then give the portfolio aggregate, so the
  // commercial dimension reflects the whole relationship — not one row.
  //
  // Payment: `payment_status` (Complete/Installments) is the SOURCE OF TRUTH for
  // whether money is still owed. paid_value lags on installment contracts, so a
  // total−paid gap is NOT an outstanding due when payment is Complete — surfacing
  // it produced false "client owes X" claims (team feedback). A remaining figure
  // is shown ONLY for non-complete payments, flagged as possibly-stale sheet data.
  const paymentPhrase = (c: {
    paymentStatus: string | null;
    totalValue: number;
    paidValue: number;
  }) => {
    const remaining = Math.max(0, c.totalValue - c.paidValue);
    if (isContractPaymentComplete(c.paymentStatus)) return `الدفع: مكتمل ✅ (لا مستحقات مالية)`;
    if ((c.paymentStatus ?? "").toLowerCase() === "installments")
      return `الدفع: أقساط — مدفوع ${c.paidValue} من ${c.totalValue}${
        remaining ? ` (متبقٍّ حسب آخر تحديث للشيت ${remaining} — رقم قد لا يعكس آخر دفعة)` : ""
      }`;
    return `الدفع: غير محدّد — مدفوع ${c.paidValue} من ${c.totalValue}`;
  };
  const contractLines =
    contract && contract.contracts.length
      ? contract.contracts
          .map(
            (c, i) =>
              `  ${i + 1}) ${c.contractCode ? `[${c.contractCode}] ` : ""}الوضع: ${c.target} — الحالة: ${c.status} — القيمة: ${c.totalValue} — ${paymentPhrase(c)} — من ${c.startDate}${c.endDate ? ` إلى ${c.endDate}` : ""}`,
          )
          .join("\n")
      : "";
  // Outstanding + all-complete come from the shared, unit-tested payment rule so
  // a completed-but-stale paid_value can never resurface as a false due.
  const { outstanding, allComplete } = summarizeContractPayments(contract?.contracts ?? []);
  const contractBlock = contract
    ? `\n\n=== حالة العقد (${contract.contractCount} عقد${contract.contractCount > 1 ? " — محفظة العميل" : ""}) ===\n${contractLines}\nالإجمالي عبر العقود: القيمة ${contract.totalValue} — المدفوع ${contract.paidValue} — ${
        allComplete
          ? "المدفوعات مكتملة لكل العقود ✅ (لا مستحقات)"
          : `مستحقات غير مكتملة الدفع: ${outstanding} (من عقود الأقساط غير المكتملة فقط — قد تكون دُفعت ولم يُحدَّث الشيت)`
      } — أسوأ وضع (target): ${contract.target} — الحالة الغالبة: ${contract.status}\nملاحظة مالية: اعتمد حالة الدفع (مكتمل/أقساط) لا فرق القيمة. لا تذكر «مستحقات مالية متبقية» أو أن العميل «عليه دفعة» إلا إذا كانت حالة الدفع غير مكتملة فعلاً، ووضّح أنها بيانات شيت قد تكون متأخرة التحديث. التحصيل مسؤولية قسم الحسابات وليس مؤشّر رضا.${activityBlock}`
    : `\n\n=== حالة العقد ===\n(لا يوجد عقد مسجّل لهذا العميل)${activityBlock}`;

  // The accountability roster: who works the client's tasks, who owns the stuck
  // stages, and how much each has actually done. Rides OUTSIDE the transcript
  // budget (like the contract/execution blocks) so the retry-shrink loop never
  // amputates it.
  const team = await getClientTeamActivitySnapshot(orgId, clientId, includeArchivedTasks);
  const teamBlock = renderTeamActivityBlock(team);

  const knowledgeBlock = await buildKnowledgeBlock(orgId);
  const storedMedia = await getClientStoredMediaAttachments(orgId, clientId, {
    sinceDays: effectiveDays,
  });
  const storedMediaBlock = storedMedia.length
    ? `\n\n=== وسائط مرفقة للتحليل البصري/السمعي ===\nتم إرفاق ${storedMedia.length} ملفًا حقيقيًا من محادثات واتساب في رسالة النموذج نفسها. افحص الصور/الملفات/الصوت كمراجع مباشرة مثل عضو جودة يراجع الدردشة، واربط أي استنتاج بالرسالة/المرسل/التاريخ الظاهر في وصف كل مرفق. لا تعتمد على التخمين إن كان الملف غير واضح.`
    : "\n\n=== وسائط مرفقة للتحليل البصري/السمعي ===\n(لا توجد ملفات وسائط محفوظة كبيانات قابلة للإرسال للنموذج في هذا النطاق؛ استخدم فقط الكابتشن/أسماء الملفات الموجودة في نص المحادثة.)";

  const makePrompt = (budget: number) =>
    `أنت محلل علاقات عملاء في وكالة تسويق سعودية (Sky Light). حلّل حالة العميل "${clientName}" من خلال أربعة مصادر مفصولة: مجموعة العميل 💫، مجموعة الفريق التقني 📍، التاسكات والمشروع، وحالة العقد — بالإضافة للبريف الموثق عند توفره. اقرأ كل مصدر على حدة، استخرج إشاراته الخاصة، ثم ادمج الكل في "الصورة الكبرى" (big picture).
\n👥 هوية المرسلين (مصدر حقيقة): كل سطر محادثة موسوم مسبقًا بـ[موظف الشركة: الاسم] عند مطابقة رقم/اسم المرسل مع صفحة الموظفين، أو [فريق الشركة: الرقم المتصل]، أو [عميل/طرف خارجي]. لا تخمّن الدور من نبرة الرسالة ولا تنسب كلام موظف إلى العميل. تم التعرف على ${transcripts.identifiedEmployeeMessages} رسالة فريق و${transcripts.externalMessages} رسالة لطرف خارجي في النص المتاح. في مجموعة العميل، استخرج رضا/شكاوى العميل من الأسطر الموسومة [عميل/طرف خارجي] فقط؛ ردود [موظف الشركة] هي أداء الفريق وليست رأي العميل.\n
${
  hadNewMessages === false
    ? `\n🚫 تنبيه إلزامي عن حداثة البيانات: لم تصل أي رسالة واتساب جديدة منذ التحليل السابق. أحدث رسالة متاحة تاريخها ${sourceLatestMessageAt ? sourceLatestMessageAt.slice(0, 16).replace("T", " ") : "غير معروف"}. هذا التشغيل هو إعادة قراءة لنفس المحادثة القديمة، وليس قراءة لتواصل جديد اليوم. يجب أن تبدأ summary بعبارة واضحة تفيد أن التحليل أُعيد دون رسائل جديدة، ولا تقل إن الوضع "اليوم" أو "حاليًا" جيد بسبب صمت المحادثة. ميّز أي تغيّر ناتج من التاسكات/العقد عن تغيّر نبرة العميل.\n`
    : sourceLatestMessageAt
      ? `\n🕓 أحدث رسالة واتساب دخلت هذا التحليل: ${sourceLatestMessageAt.slice(0, 16).replace("T", " ")}. وقت تشغيل التحليل ليس وقت آخر تواصل مع العميل.\n`
      : ""
}
${
  windowKind !== "week"
    ? `\n⏱️ النطاق الزمني: كامل تاريخ التعامل مع العميل (نظرة شاملة).\n`
    : effectiveDays === CURRENT_WINDOW_DAYS
      ? `\n⏱️ النطاق الزمني: آخر ٧ أيام فقط (الوضع الحالي للعميل). قيّم بناءً على هذه الفترة الأخيرة فقط — لا تُحمّل التقييم بشكاوى أو أحداث أقدم من ذلك.\n`
      : effectiveDays
        ? `\n⏱️ النطاق الزمني: آخر ${effectiveDays} يومًا (لا توجد رسائل في آخر ٧ أيام، فتم توسيع النطاق لأحدث محادثة متاحة). قيّم الوضع الحالي بناءً على أحدث تواصل متوفر.\n`
        : `\n⏱️ النطاق الزمني: كامل تاريخ التعامل المتاح (لا توجد محادثة حديثة، استُخدم كامل السجل لأحدث صورة ممكنة).\n`
}
ملاحظة عن الوسائط في المحادثات: بعض الأسطر تحمل وسمًا يدل على مرفق: «[صورة] …» و«[فيديو] …» = نص/تعليق أرسله صاحبه مع صورة أو فيديو. إذا كان الملف مرفقًا فعليًا في قسم "وسائط مرفقة"، افحص محتواه مباشرة واستعمله كدليل جودة. إذا لم يكن مرفقًا فعليًا، فالنص/الكابتشن فقط متاح ولا يجوز اختراع محتوى الصورة/الفيديو. «[ملف: اسم]» = العميل/الفريق شارك ملفًا بهذا الاسم؛ إذا كان الملف مرفقًا فعليًا افحصه، وإلا استدل بالاسم فقط. «[جهة اتصال]» و«[موقع]» = مشاركة جهة اتصال أو موقع. اعتبر مشاركة ملف تقرير/تسليم إشارة تسليم، ومشاركة العميل لملف متطلبات/بريف إشارة على تزويد مدخلات.

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
- requestExamples: لكل نوع من أنواع الطلبات، أدرج الرسائل الفعلية التي عددتها — اقتباس حقيقي من العميل أو تلخيص أمين، مع التاريخ إن أمكن ({text, date}). يجب أن يساوي عدد العناصر في كل نوع العدد المذكور في requests لنفس النوع (حتى ١٢ مثالاً لكل نوع كحد أقصى). لا تخترع رسائل.
- approvalExamples: نفس القاعدة لنتائج الاعتماد {approved, rejected, changesRequested, noResponse} — أدرج الرسائل الفعلية خلف كل عدد بحيث يطابق عددها approvals.
- responseSpeed: fast/medium/slow/unknown (متوسط سرعة تعاون/رد العميل).

— technicalGroupSignals (من مجموعة الفريق التقني + التاسكات) —
- blockers: المشاكل الداخلية (التصميم متأخر، المحتوى متأخر، الحملة لم تبدأ، محتاجين بيانات من العميل، مشكلة تقنية...).
- delayCauses: [{cause, attributedTo}] حيث attributedTo = client/account_manager/team/department/unknown.
- accountEvaluation: تقييم الفريق الداخلي (العميل غير واضح، يغيّر رأيه كثيراً، الأكاونت غير فاهم، البريف ناقص...).

— causes (أسباب المشاكل) —
[{problem, rootCause, owner}] — لكل مشكلة جوهرية سببها الجذري ومن يملكها (نفس قيم attributedTo).

— recommendations (الأكشنز المقترحة، الأهم أولاً، حتى ٦) —
اربط ما يشكو/يطلبه العميل بالعمل الفعلي في التاسكات. issue = المشكلة موصولة بالواقع، action = الخطوة العملية. استخدم رموز/عناوين المهام عند توفرها. لا تخترع مهاماً. إن لم توجد مشكلة جوهرية أعِد مصفوفة فارغة.
لكل توصية أضف taskCodes = أكواد المهام المذكورة فعليًا (أو [] إن لم توجد)، وresolutionKind حسب دليل الإغلاق الآلي: task_completion إذا تُغلق باكتمال المهام المذكورة، no_overdue_tasks إذا تتعلق بعدد المهام المتأخرة عمومًا، brief_attached إذا تتعلق بغياب البريف، وإلا manual_confirmation. لا تعتبر تغيّر شعور العميل قابلاً للإغلاق من التاسكات وحدها.

— accountability (اربط الشكوى/التعثّر بالمسؤول — أهم مخرج لهذه الصفحة، حتى ٦) —
أنشئ صفاً في الحالتين: (١) لكل شكوى جوهرية من مجموعة العميل، و(٢) لكل تعثّر تشغيلي مؤثر في قسم "الفريق والمسؤوليات" قد يضرّ بالعميل حتى لو لم يشتكِ صراحةً بعد (مثل مهمة عالقة أسابيع بلا حركة، أو فجوة مذكورة في "فجوات مكتشفة آليًا"). حدّد الخدمة، ثم اربطها بالمهام والأشخاص من قسم "الفريق والمسؤوليات" حصراً (لا تستخدم أي اسم أو كود مهمة غير مذكور هناك). املأ:
- complaint: شكوى العميل الفعلية (اقتباس أو تلخيص أمين)، أو — إن لم توجد شكوى صريحة — وصفٌ موجز للتعثّر التشغيلي المؤثر.
- service: الخدمة المعنية كما وردت في الروستر (أو null).
- finding: أين تتركّز المشكلة فعلياً — تشخيص مهني محايد لا اتهام شخصي.
- responsible: من يتحمّل المسؤولية التشغيلية (حتى ٣، بالاسم والدور من الروستر) مع basis:
  • مهمة عالقة في التنفيذ (in_progress/specialist_review) → المنفّذ (assignee) أو مالك المرحلة إن كان أخصائياً (stage_owner).
  • مهمة عالقة في manager_review → مالك المرحلة / مدير الفريق (team_manager).
  • مهمة في sent_to_client/ready_to_send تنتظر العميل → ليست تقصير فريق؛ لا تُسند لشخص إلا إن تأخّر مدير الحساب في متابعة الاعتماد (account_manager).
  • تأخر اعتمادات أو بريف ناقص → مدير الحساب (account_manager).
  • لا يوجد منفّذ معيّن، أو مهمة خاملة بلا حركة، أو مدير حساب صامت → basis=process_gap واترك responsible فارغة أو بالاسم المذكور في الفجوات.
- taskCodes: أكواد المهام من الروستر التي تُثبت الـfinding (حتى ٥).
- evidence: السلسلة الواقعية (مهمة X عالقة في مرحلة Y منذ Z يوم، آخر إجراء من W، عدد الإجراءات...).
- confidence: high فقط عند دليل صريح يربط الشكوى بمهمة/شخص محدّد؛ إن ربطت بالخدمة فقط فاجعلها low.
لا تخترع اسماً أو كوداً أو رقماً. إن لم توجد شكوى قابلة للربط أعِد مصفوفة فارغة. كذلك في causes، إن كان لسبب المشكلة مالك مذكور بالاسم في الروستر ضعه في ownerName (وإلا null).

ضوابط عامة:
- حدود بيانات Rwasem/Odoo: اذكر رقم «في هذه المرحلة منذ» كما ورد ولا تُعِد صياغته كـ«تأخّر اعتماد X أيام». لا تنسب لمهمة أثراً لم يُذكر صراحةً ما لم يقُله العميل في مجموعته.
- highlights: لكل عنصر audience: "client" (من العميل) أو "team" (تنسيق داخلي). نص كل عنصر اقتباس حقيقي أو تلخيص أمين — لا تخترع رسائل أو "تم الاعتماد/الانتهاء". milestone للمخرجات المعتمدة الجوهرية فقط؛ الاسترداد المالي/فسخ التعاقد/مغادرة العميل = escalation وليست milestone.
- ميّز الاستفسار المحايد عن الشكوى. عدم الوفاء بوعد أو تكرار المتابعة دون رد أو احتكاك العملية = إشارات سلبية حقيقية.
- درجات الرضا: 75+ تتطلب رضا/ثناءً صريحاً. علاقة فيها احتكاك لوجستي/تأخيرات = 55-70 (محايد/متباين) وليست إيجابية.
- في المشاريع الجديدة بلا مخرجات مُسلَّمة، اذكر أن التقييم مبكّر إذا كانت الإشارات محدودة.
استند فقط لما ورد في المصادر أدناه.

=== مجموعة العميل 💫 ===
${trim(clientBlock, budget)}

=== مجموعة الفريق التقني 📍 ===
${trim(technicalBlock, budget)}${briefBlock}${executionBlock}${contractBlock}${teamBlock}${storedMediaBlock}${knowledgeBlock ? `\n\n${knowledgeBlock}` : ""}`;

  const makeMessages = (budget: number): ModelMessage[] => {
    const content: UserContent = [{ type: "text", text: makePrompt(budget) }];
    for (const media of storedMedia) {
      content.push({ type: "text", text: `\nمرفق واتساب للتحليل: ${media.label}` });
      if (media.mimeType.startsWith("image/")) {
        content.push({ type: "image", image: media.bytes, mediaType: media.mimeType });
      } else {
        content.push({
          type: "file",
          data: media.bytes,
          mediaType: media.mimeType,
          filename: media.filename ?? undefined,
        });
      }
    }
    return [{ role: "user", content }];
  };

  return {
    clientName,
    windowKind,
    windowStart,
    windowEnd,
    sourceLatestMessageAt,
    hadNewMessages,
    brief,
    contract,
    activity,
    team,
    clientTranscript: clientBlock,
    makePrompt,
    makeMessages,
  };
}

// Step 3 — store the result as the client's analysis (is_current for weekly
// runs) + audit/AI events. Shared by the blocking and streaming paths.
export async function persistSatisfaction(
  orgId: string,
  clientId: string,
  actorUserId: string | null,
  result: SatisfactionResult,
  input: SatisfactionInput,
): Promise<AnalyzeOutcome> {
  const {
    brief,
    contract,
    activity,
    team,
    windowKind,
    windowStart,
    windowEnd,
    sourceLatestMessageAt,
    hadNewMessages,
  } = input;
  // Brief text wasn't available → the model must not have inferred adherence.
  if (!brief) {
    result.briefAdherenceScore = null;
    result.briefAdherence = null;
  }

  // ---- Roster guardrail: the model may ONLY cite names/codes we handed it.
  // Drop any invented name or task code so a hallucinated attribution can never
  // reach the DB, even if the model ignores the prompt. A row that loses all of
  // its people AND task codes is dropped unless it is an explicit process_gap.
  const rosterNames = new Set<string>();
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const p of team.people) rosterNames.add(norm(p.name));
  if (team.accountManager) rosterNames.add(norm(team.accountManager));
  for (const t of team.stuckTasks) {
    for (const n of [t.executor, t.accountManager, t.stageOwner]) {
      if (!n) continue;
      // stageOwner may be a comma-joined list.
      for (const part of n.split(",")) if (part.trim()) rosterNames.add(norm(part));
    }
  }
  const rosterCodes = new Set<string>();
  for (const t of team.stuckTasks) if (t.taskCode) rosterCodes.add(t.taskCode);

  result.accountability = (result.accountability ?? [])
    .map((row) => {
      const namedPeople = (row.responsible ?? []).length;
      const responsible = (row.responsible ?? []).filter((r) => rosterNames.has(norm(r.name)));
      const taskCodes = (row.taskCodes ?? []).filter((c) => rosterCodes.has(c));
      // Drop only when the model named people but EVERY name was invented and no
      // valid task code survives — that row is a hallucination. A row that never
      // named anyone (a pure process finding) is kept.
      const hallucinated = namedPeople > 0 && responsible.length === 0 && taskCodes.length === 0;
      return hallucinated ? null : { ...row, responsible, taskCodes };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  // Same guard for the per-cause owner name.
  result.causes = (result.causes ?? []).map((c) =>
    c.ownerName && rosterNames.has(norm(c.ownerName)) ? c : { ...c, ownerName: null },
  );

  const { data: imp } = await supabaseAdmin
    .from("client_chat_imports")
    .select("id, group_kind, created_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  const rows = (imp ?? []) as Array<{ id: string; group_kind: string }>;
  const clientImportId = rows.find((r) => r.group_kind === "client")?.id ?? null;
  const technicalImportId = rows.find((r) => r.group_kind === "technical")?.id ?? null;

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
      brief_adherence: result.briefAdherence,
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
      accountability: result.accountability,
      // Freshness metadata lives with the frozen analysis snapshot. Keeping it
      // in the existing JSON object makes this deploy backward-compatible with
      // the current database schema while still persisting a source watermark.
      big_picture: {
        ...result.bigPicture,
        _sourceLatestMessageAt: sourceLatestMessageAt,
        _hadNewMessages: hadNewMessages,
      },
      contract_context: contract ? { ...contract, recentActivity: activity } : null,
      team_context: team.hasData ? team : null,
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
    metadata: {
      score: result.satisfactionScore,
      sentiment: result.sentiment,
      windowKind,
      sourceLatestMessageAt,
      hadNewMessages,
    },
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
      redIndicators: result.indicators
        .filter((i) => (RISK_INDICATORS as readonly string[]).includes(i.code))
        .map((i) => i.code),
      briefUsed: brief ? { source: brief.source, kind: brief.kind, filename: brief.filename, url: brief.url } : null,
      windowKind,
      sourceLatestMessageAt,
      hadNewMessages,
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

export async function analyzeClientSatisfaction(
  orgId: string,
  clientId: string,
  actorUserId: string | null,
  opts?: AnalyzeOptions,
): Promise<AnalyzeOutcome> {
  const input = await buildSatisfactionInput(orgId, clientId, opts);

  // The model can occasionally fail structured output on long/messy
  // transcripts. Retry with a progressively SMALLER transcript each attempt —
  // a tighter input is much more likely to yield schema-valid output.
  const budgets = [MAX_CHARS, 22_000, 10_000, 5_000];
  let result: SatisfactionResult | undefined;
  let lastErr: unknown;
  for (const budget of budgets) {
    try {
      const { object } = await generateObject({
        model: aiModel("flagship"),
        maxRetries: 2,
        schema: SatisfactionSchema,
        prompt: input.makeMessages(budget),
      });
      result = object;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!result) throw lastErr instanceof Error ? lastErr : new Error("analysis failed");

  // On heavy analyses the model reliably fills the request/approval COUNTS but
  // sometimes drops the per-type example quotes (arrays default to []), which
  // makes the /satisfaction chips non-clickable — no drill-down. Backfill the
  // missing examples with a small, focused second pass so the drill-downs
  // always work when a count is non-zero.
  await repairMissingExamples(input, result);

  return persistSatisfaction(orgId, clientId, actorUserId, result, input);
}

const RepairExampleSchema = z.object({
  text: z.string(),
  date: z.string().nullable().catch(null),
});
const RepairSchema = z.object({
  requestExamples: z.object({
    new: z.array(RepairExampleSchema).max(12).default([]),
    edit: z.array(RepairExampleSchema).max(12).default([]),
    complaint: z.array(RepairExampleSchema).max(12).default([]),
    inquiry: z.array(RepairExampleSchema).max(12).default([]),
    approval: z.array(RepairExampleSchema).max(12).default([]),
  }),
  approvalExamples: z.object({
    approved: z.array(RepairExampleSchema).max(12).default([]),
    rejected: z.array(RepairExampleSchema).max(12).default([]),
    changesRequested: z.array(RepairExampleSchema).max(12).default([]),
    noResponse: z.array(RepairExampleSchema).max(12).default([]),
  }),
});

const REQ_KEYS = ["new", "edit", "complaint", "inquiry", "approval"] as const;
const APPR_KEYS = ["approved", "rejected", "changesRequested", "noResponse"] as const;

// Re-extract the actual quotes behind each non-zero request/approval count when
// an analysis has counts but empty example arrays. Mutates the passed signals in
// place, filling ONLY the missing types (never overwriting quotes already
// present). A focused single-purpose prompt is far more reliable than the full
// analysis at this narrow task. Failures are swallowed — the counts still
// render. Shared by the live pipeline and the repair backfill script.
export async function fillMissingSignalExamples(
  cg: SatisfactionResult["clientGroupSignals"],
  clientTranscript: string,
): Promise<boolean> {
  const missingReq = REQ_KEYS.filter(
    (k) => (cg.requests?.[k] ?? 0) > 0 && (cg.requestExamples?.[k]?.length ?? 0) === 0,
  );
  const missingAppr = APPR_KEYS.filter(
    (k) => (cg.approvals?.[k] ?? 0) > 0 && (cg.approvalExamples?.[k]?.length ?? 0) === 0,
  );
  if (missingReq.length === 0 && missingAppr.length === 0) return false;
  if (!clientTranscript || clientTranscript.length < 5) return false;

  const prompt = `أنت تستخرج اقتباسات حقيقية من محادثة واتساب لمجموعة عميل بوكالة تسويق (Sky Light). المطلوب فقط: لكل نوع أدناه، أدرج الرسائل الفعلية التي تمثّله من كلام العميل [عميل/طرف خارجي] — اقتباس حقيقي أو تلخيص أمين مع التاريخ إن وُجد. لا تخترع رسائل، ولا تُدرج ردود [موظف الشركة] كطلبات عميل. اجعل عدد العناصر مطابقًا قدر الإمكان للأعداد المذكورة (حتى ١٢ لكل نوع).

الأعداد المطلوبة تغطيتها بالأمثلة:
- طلبات: ${missingReq.map((k) => `${k}=${cg.requests[k]}`).join("، ") || "لا شيء"}
- اعتمادات: ${missingAppr.map((k) => `${k}=${cg.approvals[k]}`).join("، ") || "لا شيء"}
الأنواع غير المذكورة أعلاه اتركها فارغة.

=== محادثة مجموعة العميل ===
${trim(clientTranscript, 30_000)}`;

  try {
    const { object } = await generateObject({
      model: aiModel("flagship"),
      maxRetries: 1,
      schema: RepairSchema,
      prompt,
    });
    let filled = false;
    for (const k of missingReq) {
      if (object.requestExamples[k]?.length) {
        cg.requestExamples[k] = object.requestExamples[k];
        filled = true;
      }
    }
    for (const k of missingAppr) {
      if (object.approvalExamples[k]?.length) {
        cg.approvalExamples[k] = object.approvalExamples[k];
        filled = true;
      }
    }
    return filled;
  } catch {
    /* leave counts without examples — chips still render, just not clickable */
    return false;
  }
}

async function repairMissingExamples(
  input: SatisfactionInput,
  result: SatisfactionResult,
): Promise<void> {
  await fillMissingSignalExamples(result.clientGroupSignals, input.clientTranscript);
}
