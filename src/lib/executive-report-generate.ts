import "server-only";
import { generateObject, gateway } from "ai";
import type { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GEMINI_MODEL, MODELS } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import {
  buildExecutiveReportFacts,
  type ExecutiveReportFacts,
} from "@/lib/data/executive-report";
import type { DashboardRange } from "@/lib/dashboard-range";
import {
  SummaryAiSchema,
  FinanceClientsAiSchema,
  DeliveryAiSchema,
  TeamAiSchema,
  sanitizeExecutiveReportResult,
  type ExecutiveReportResult,
  type StoredExecutiveReport,
} from "@/lib/executive-report-schema";

// =========================================================================
// Executive Report generator — mirrors ceo-brief-generate.ts.
//
// buildExecutiveReportFacts() computes every number; Gemini writes the four
// Arabic chapters around them like a human analyst. The whole run (facts +
// prose) is frozen in executive_report_runs keyed by the report period, so
// the screen and the printed report always show the same content.
// =========================================================================

export const EXECUTIVE_REPORT_MODEL = process.env.EXECUTIVE_REPORT_MODEL ?? MODELS.arabicHiQ;

type RunRow = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  range_from: string;
  range_to: string;
  preset: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  facts_json: ExecutiveReportFacts | null;
  result_json: unknown;
};

const RUN_COLUMNS =
  "id, status, model, range_from, range_to, preset, created_at, completed_at, error_message, facts_json, result_json";

function rowToStored(row: RunRow): StoredExecutiveReport {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    rangeFrom: row.range_from,
    rangeTo: row.range_to,
    preset: row.preset,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    facts: row.facts_json,
    result: sanitizeExecutiveReportResult(row.result_json),
  };
}

/** Current ready report for the exact period, or null. */
export async function getCurrentExecutiveReport(
  orgId: string,
  range: { from: string; to: string },
): Promise<StoredExecutiveReport | null> {
  const { data } = await supabaseAdmin
    .from("executive_report_runs")
    .select(RUN_COLUMNS)
    .eq("organization_id", orgId)
    .eq("range_from", range.from)
    .eq("range_to", range.to)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToStored(data as RunRow) : null;
}

/** Recent ready reports (any period) — the report archive list. */
export async function listRecentExecutiveReports(
  orgId: string,
  limit = 8,
): Promise<Array<Pick<StoredExecutiveReport, "id" | "rangeFrom" | "rangeTo" | "preset" | "completedAt">>> {
  const { data } = await supabaseAdmin
    .from("executive_report_runs")
    .select("id, range_from, range_to, preset, completed_at")
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    rangeFrom: row.range_from as string,
    rangeTo: row.range_to as string,
    preset: row.preset as string | null,
    completedAt: row.completed_at as string | null,
  }));
}

// ---- prompts -------------------------------------------------------------

const fence = (facts: unknown) => "```json\n" + JSON.stringify(facts) + "\n```";

function sharedHeader(facts: ExecutiveReportFacts): string {
  const caveats = facts.dataQualityCaveats;
  const dataQualityBlock = caveats.length
    ? `\n\n⚠️ قيود جودة البيانات (التزم بها حرفيًا):\n${caveats.map((c) => `- ${c}`).join("\n")}\n- إن لم يكن الرقم مُعطى صراحةً في الحقائق أدناه، فلا تذكره أبدًا.`
    : "";
  return `أنت محلل تنفيذي أول تكتب «التقرير التنفيذي الدوري» للرئيس التنفيذي لوكالة تسويق سعودية (رواسم / Sky Light).
فترة التقرير: من ${facts.period.from} إلى ${facts.period.to} (${facts.period.days} يومًا)، مقارنةً بالفترة المكافئة السابقة (${facts.previousPeriod.from} → ${facts.previousPeriod.to}).

قواعد صارمة:
- **لا تخترع أي رقم**. كل الأرقام محسوبة مسبقًا في الحقائق أدناه؛ دورك التحليل والصياغة وربط الأسباب فقط.
- اكتب كما يكتب محلل بشري محترف: فقرات متماسكة تروي قصة الفترة وتفسّر «لماذا» — لا قوائم جافة ولا إعادة سرد لكل رقم.
- عربية فصحى واضحة وحاسمة موجّهة للقرار. لا مجاملات ولا حشو.
- لا تعتبر مرحلة "new/جديدة" أو تراكم المهام فيها اختناقًا أو خطرًا؛ فهي أثر استيراد من Odoo ووضع طبيعي في رواسم.
- عند ذكر اتجاه (تحسّن/تراجع) استند حصريًا إلى حقول trend/prev المعطاة.${dataQualityBlock}`;
}

interface SectionDef<S extends z.ZodTypeAny> {
  key: "summary" | "financeClients" | "delivery" | "team";
  schema: S;
  pickFacts: (f: ExecutiveReportFacts) => Record<string, unknown>;
  buildPrompt: (f: ExecutiveReportFacts, knowledge: string) => string;
}

const withKnowledge = (body: string, knowledge: string) =>
  knowledge ? `${body}\n\n${knowledge}` : body;

const summarySection: SectionDef<typeof SummaryAiSchema> = {
  key: "summary",
  schema: SummaryAiSchema,
  // The summary sees the whole fact universe so it can connect chapters.
  pickFacts: (f) => ({
    indicators: f.indicators,
    scores: f.scores,
    finance: f.finance,
    delivery: f.delivery
      ? { services: f.delivery.services, clientEdits: f.delivery.clientEdits }
      : null,
    team: f.team ? { totals: f.team.totals, lowPerformers: f.team.lowPerformers } : null,
    clients: f.clients,
    renewals: f.renewals
      ? { next90Count: f.renewals.next90Count, nearest: f.renewals.next90.slice(0, 3) }
      : null,
  }),
  buildPrompt: (f, knowledge) =>
    withKnowledge(
      `${sharedHeader(f)}

المهمة: اكتب «الملخص التنفيذي» — الفصل الافتتاحي الذي يقرؤه الرئيس التنفيذي أولًا، وربما لا يقرأ غيره.

الحقائق (كل فصول التقرير):
${fence(summarySection.pickFacts(f))}

التعليمات:
- **paragraphs**: ٢-٤ فقرات تروي قصة الفترة كاملة: أين تقف الشركة ماليًا وتشغيليًا، ما الذي تحسّن وما الذي تراجع ولماذا، وأين يتركّز الخطر. اربط الفصول ببعضها (مثلًا: العميل المعرّض للفقد هو نفسه المتأخر في التسليم أو الدفعات) بدل سردها منفصلة.
- **keyFindings**: أهم ٣-٦ نتائج لا يجوز أن تفوت الرئيس التنفيذي، كل واحدة جملة واحدة بأهم رقم داعم.
- **recommendations**: ٣-٦ توصيات عملية متنوعة المجالات تعالج جذور المشاكل، لكل توصية area (المجال) و action محدد و owner (الدور المسؤول).
- **bottomLine**: جملة واحدة — الخلاصة وأهم إجراء للفترة القادمة.`,
      knowledge,
    ),
};

const financeClientsSection: SectionDef<typeof FinanceClientsAiSchema> = {
  key: "financeClients",
  schema: FinanceClientsAiSchema,
  pickFacts: (f) => ({
    finance: f.finance,
    clients: f.clients,
    renewals: f.renewals,
  }),
  buildPrompt: (f, knowledge) =>
    withKnowledge(
      `${sharedHeader(f)}

المهمة: اكتب فصل «المال والعملاء» — الوضع المالي للشهر (العقود والتحصيل) وصحة محفظة العملاء ورضاهم وتجديداتهم القادمة.

الحقائق:
${fence(financeClientsSection.pickFacts(f))}

التعليمات:
- **paragraphs**: ١-٣ فقرات تحليلية: تحقيق الدخل مقابل المستهدف (الإجمالي وقسمَي Account وSales)، الدفعات المستحقة والمتأخرة، حركة العملاء (جدد/مجدِّدون/مفقودون)، ثم رضا العملاء ومن منهم في خطر، والتجديدات القريبة التي تستحق التحرك المبكر. فسّر الدلالة ولا تكرر كل رقم.`,
      knowledge,
    ),
};

const deliverySection: SectionDef<typeof DeliveryAiSchema> = {
  key: "delivery",
  schema: DeliveryAiSchema,
  pickFacts: (f) => ({
    indicators: f.indicators,
    scores: f.scores ? { delivery: f.scores.delivery, quality: f.scores.quality } : null,
    delivery: f.delivery,
  }),
  buildPrompt: (f, knowledge) =>
    withKnowledge(
      `${sharedHeader(f)}

المهمة: اكتب فصل «التسليم والتنفيذ» — أداء خطوط الخدمة والالتزام بالمواعيد وتعديلات العميل ومراحل العمل.

الحقائق:
${fence(deliverySection.pickFacts(f))}

التعليمات:
- **paragraphs**: ١-٣ فقرات: أين يتركّز التأخير (أي خدمة/مرحلة) وهل يتحسن الالتزام أم يتراجع مقارنة بالفترة السابقة، ماذا تقول تعديلات العميل عن جودة التسليم الأول، وأي مراحل العمل أبطأ من غيرها (stageDwell). سمِّ الخدمات الأضعف والأقوى بالاسم.`,
      knowledge,
    ),
};

const teamSection: SectionDef<typeof TeamAiSchema> = {
  key: "team",
  schema: TeamAiSchema,
  pickFacts: (f) => ({
    team: f.team,
    discipline: f.scores?.discipline ?? null,
    productivity: f.scores?.productivity ?? null,
  }),
  buildPrompt: (f, knowledge) =>
    withKnowledge(
      `${sharedHeader(f)}

المهمة: اكتب فصل «الفريق والمساءلة» — نبض الأقسام، الأداء الفردي (الأعلى والأدنى)، والانضباط.

الحقائق:
${fence(teamSection.pickFacts(f))}

التعليمات:
- **paragraphs**: ١-٣ فقرات: أي الأقسام يعمل بإيقاع صحي وأيها متعثر (بالاسم)، من أبرز الأداء الفردي ومن يحتاج تدخلًا (استند إلى topPerformers/lowPerformers فقط)، وماذا يقول الانضباط (الأعضاء النشطون، المهام الراكدة) عن صحة العملية. لا تُحمّل أحدًا مسؤولية غير المذكورين في الحقائق.`,
      knowledge,
    ),
};

// ---- generation ----------------------------------------------------------

export async function generateAndStoreExecutiveReport(
  orgId: string,
  range: DashboardRange,
  requestedBy: string | null,
): Promise<StoredExecutiveReport> {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("executive_report_runs")
    .insert({
      organization_id: orgId,
      requested_by: requestedBy,
      range_from: range.from,
      range_to: range.to,
      preset: range.preset,
      status: "running",
      model: EXECUTIVE_REPORT_MODEL,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message ?? "تعذّر إنشاء سجل التقرير");
  }
  const runId = inserted.id as string;

  try {
    const [facts, knowledge] = await Promise.all([
      buildExecutiveReportFacts(orgId, range),
      buildKnowledgeBlock(orgId).catch(() => ""),
    ]);

    async function runSection<S extends z.ZodTypeAny>(
      def: SectionDef<S>,
    ): Promise<{ object: z.infer<S>; model: string }> {
      const prompt = def.buildPrompt(facts, knowledge);
      try {
        const { object } = await generateObject({
          model: gateway(EXECUTIVE_REPORT_MODEL),
          schema: def.schema,
          maxRetries: 2,
          prompt,
        });
        return { object: object as z.infer<S>, model: EXECUTIVE_REPORT_MODEL };
      } catch (err) {
        // Same degradation as the CEO brief: on ANY failure of the stronger
        // model, retry once on the known-good default before giving up.
        if (EXECUTIVE_REPORT_MODEL !== GEMINI_MODEL) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[executive-report] model "${EXECUTIVE_REPORT_MODEL}" failed (${msg}); falling back to ${GEMINI_MODEL}`,
          );
          const { object } = await generateObject({
            model: gateway(GEMINI_MODEL),
            schema: def.schema,
            maxRetries: 2,
            prompt,
          });
          return { object: object as z.infer<S>, model: GEMINI_MODEL };
        }
        throw err;
      }
    }

    const [summaryRes, financeRes, deliveryRes, teamRes] = await Promise.allSettled([
      runSection(summarySection),
      runSection(financeClientsSection),
      runSection(deliverySection),
      runSection(teamSection),
    ]);

    const result: ExecutiveReportResult = {
      summary: summaryRes.status === "fulfilled" ? summaryRes.value.object : null,
      financeClients: financeRes.status === "fulfilled" ? financeRes.value.object : null,
      delivery: deliveryRes.status === "fulfilled" ? deliveryRes.value.object : null,
      team: teamRes.status === "fulfilled" ? teamRes.value.object : null,
    };
    const settled: PromiseSettledResult<{ object: unknown; model: string }>[] = [
      summaryRes,
      financeRes,
      deliveryRes,
      teamRes,
    ];
    const anySucceeded = settled.some((s) => s.status === "fulfilled");
    const modelUsed =
      settled.find(
        (s): s is PromiseFulfilledResult<{ object: unknown; model: string }> =>
          s.status === "fulfilled",
      )?.value.model ?? EXECUTIVE_REPORT_MODEL;

    // Facts alone are still a valid (numbers-only) report — the narrative
    // failing (e.g. empty gateway wallet, 402) must not lose the run. We keep
    // the run "ready" and surface the AI failure as a soft warning.
    const aiError = anySucceeded
      ? null
      : (() => {
          const rejected = settled.find(
            (s): s is PromiseRejectedResult => s.status === "rejected",
          );
          return rejected?.reason instanceof Error
            ? rejected.reason.message
            : "فشل توليد السرد التحليلي";
        })();

    await supabaseAdmin
      .from("executive_report_runs")
      .update({ is_current: false })
      .eq("organization_id", orgId)
      .eq("range_from", range.from)
      .eq("range_to", range.to)
      .eq("is_current", true);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("executive_report_runs")
      .update({
        status: "ready",
        model: modelUsed,
        facts_json: facts,
        result_json: result,
        completed_at: new Date().toISOString(),
        is_current: true,
        error_message: aiError,
      })
      .eq("id", runId)
      .select(RUN_COLUMNS)
      .single();
    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "تعذّر حفظ التقرير");
    }
    return rowToStored(updated as RunRow);
  } catch (err) {
    await supabaseAdmin
      .from("executive_report_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : "فشل توليد التقرير",
        is_current: false,
      })
      .eq("id", runId);
    throw err;
  }
}
