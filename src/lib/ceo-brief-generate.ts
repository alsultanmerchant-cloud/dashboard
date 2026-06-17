import "server-only";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildCeoBriefSignals } from "@/lib/data/ceo-brief-signals";
import {
  buildKnowledgeBlock,
  getKnowledgeStamp,
  isStaleAgainstKnowledge,
} from "@/lib/data/ai-knowledge";
import {
  CeoBriefAiSchema,
  sanitizeCeoBriefResult,
  type CeoBriefResult,
  type CeoBriefRiskRendered,
  type StoredCeoBrief,
} from "@/lib/ceo-brief-schema";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

// The CEO brief synthesizes the richest, most connected pack in the app, so it
// runs on a stronger tier than the shared GEMINI_MODEL — overridable via env,
// and falls back to the shared model if the id is rejected.
const CEO_BRIEF_MODEL = process.env.CEO_BRIEF_MODEL ?? "gemini-3.5-flash";

// Clicking "تحديث" (or a second cron pass) within this window returns the
// cached brief instead of burning a Gemini call. force=true bypasses.
export const CEO_BRIEF_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const VERDICT_AR = {
  improving: "تتحسّن",
  stable: "مستقرة",
  declining: "تتراجع",
} as const;

type BriefRunRow = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  result_json: CeoBriefResult | null;
};

function rowToStored(row: BriefRunRow): StoredCeoBrief {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    result: sanitizeCeoBriefResult(row.result_json),
  };
}

export async function getCurrentCeoBrief(orgId: string): Promise<StoredCeoBrief | null> {
  const { data } = await supabaseAdmin
    .from("ceo_brief_runs")
    .select("id, status, model, created_at, completed_at, error_message, result_json")
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as BriefRunRow | null;
  if (!row) return null;
  const stamp = await getKnowledgeStamp(orgId);
  return { ...rowToStored(row), stale: isStaleAgainstKnowledge(row.completed_at, stamp) };
}

// Build the deterministic facts, ask Gemini to narrate them, merge, and store
// as the org's current brief. Returns the stored record. requestedBy is null
// for cron runs.
export async function generateAndStoreCeoBrief(
  orgId: string,
  requestedBy: string | null,
): Promise<StoredCeoBrief> {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("ceo_brief_runs")
    .insert({
      organization_id: orgId,
      requested_by: requestedBy,
      status: "running",
      model: CEO_BRIEF_MODEL,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message ?? "تعذّر إنشاء سجل الموجز");
  }
  const runId = inserted.id as string;

  try {
    const [signals, knowledge] = await Promise.all([
      buildCeoBriefSignals(orgId),
      buildKnowledgeBlock(orgId),
    ]);

    const facts = {
      verdict: signals.verdict,
      verdictArabic: VERDICT_AR[signals.verdict],
      statusPct: signals.statusPct,
      grade: signals.grade,
      changes: signals.changes,
      risks: signals.risks.map((r) => ({
        id: r.id,
        title: r.title,
        severity: r.severity,
        metric: r.metric,
      })),
      opportunities: signals.opportunities,
      context: signals.context,
      dataQuality: signals.dataQuality,
    };

    // Hard data-quality guardrail: the agency's Odoo-synced data has structural
    // gaps (no due dates, no snapshot history, no timesheets). Without this, the
    // model narrates unbacked metrics as confident facts — the #1 source of the
    // "most analyses are wrong" complaint. Inject the live caveats as rules.
    const caveats = signals.dataQuality.caveats;
    const dataQualityBlock = caveats.length
      ? `\n\n⚠️ قيود جودة البيانات (التزم بها حرفيًا):\n${caveats
          .map((c) => `- ${c}`)
          .join("\n")}\n- إن لم يكن الرقم مُعطى صراحةً في الحقائق أدناه، فلا تذكره. الأفضل عدم ذكر مؤشر على أن لا تذكره خاطئًا.`
      : "";

    const prompt = `أنت رئيس أركان (Chief of Staff) للرئيس التنفيذي لوكالة تسويق سعودية (رواسم).
الرئيس التنفيذي لا يريد قراءة أرقام كثيرة — يريد إجابات عملية لثلاثة أسئلة فقط:
١) هل الشركة تتحسّن أم تتراجع؟  ٢) أين الخطر؟  ٣) ماذا أفعل؟

قواعد صارمة:
- **لا تخترع أي رقم**. الأرقام كلها محسوبة مسبقًا في البيانات أدناه؛ مهمتك الصياغة وربط الأسباب فقط.
- عربية فصحى، حاسمة وموجزة، موجّهة للقرار. لا تشجيع ولا حشو.
- لا تعتبر مرحلة "new/جديدة" أو تراكم المهام فيها اختناقًا أو خطرًا أو إجراءً مطلوبًا. في رواسم هذا وضع طبيعي/أثر استيراد من Odoo، وليس مؤشرًا تشغيليًا مهمًا. ممنوع اقتراح "تحريك مهام جديدة" أو تقليل انتظار مرحلة جديدة.${dataQualityBlock}

البيانات (الحقائق المحسوبة):
\`\`\`json
${JSON.stringify(facts)}
\`\`\`

استخدم **context** لتحديد جذور المشكلة وربط النقاط (وليس فقط سردها):
- worstServices/bestService = أين يتركّز التراجع وأين القوة (مثال: الخدمة الأضعف التزامًا).
- wip = هل التأخير مزمن (chronicOverdue ٣١-٩٠ يومًا) أم طارئ (freshOverdue)؟
- satisfaction = الرضا والعملاء المعرّضون للفقد (topChurn) — البُعد التجاري/السمعة.
- zeroOnTimePerformers/topPerformers/bestClients = أين الخلل البشري وما الذي ينجح.
- discipline.staleTasks/slaCompliancePct و reworkRate = صحة الانضباط والعملية.

التعليمات:
- **headline**: جملة واحدة تجيب السؤال الأول وتُحدّد **أين** يتركّز التغيّر (الخدمة/المرحلة)، مستندةً إلى verdictArabic و statusPct و changes و context. مثال: "الوضع التشغيلي ${facts.verdictArabic} عند ${facts.statusPct}% — مدفوعًا بـ… وتتركّز المشكلة في…".
- **riskNotes**: عنصر واحد لكل خطر في risks بنفس الـ id. interpretation = لماذا هذا خطر وأثره، مع **ربطه بجذر السبب من context** (مثلاً ربط التأخير بالخدمة الأضعف أو بكونه مزمنًا).
- **recommendations**: خطة عمل من ٤ إلى ٦ بنود **متنوّعة المجالات** تعالج **جذور** المشكلة من risks و context و opportunities معًا — وجّه التركيز للخدمة الأضعف، أنقذ العملاء المعرّضين للفقد (topChurn)، أعد توزيع الحمل (overloaded/underutilized)، تابع التجديدات، عالج فريق zeroOnTimePerformers، واحمِ/استثمر ما ينجح (bestService/topPerformers/bestClients). لكل بند: category، action محدّد، owner (الدور المسؤول).
- **bottomLine**: جملة واحدة فقط — أهم إجراء يعالج أخطر جذر سبب اليوم.${knowledge ? `\n\n${knowledge}` : ""}`;

    // Prefer the stronger brief model; fall back to the shared model if the id
    // is rejected (e.g. not yet available on this key).
    let modelUsed = CEO_BRIEF_MODEL;
    let object: Awaited<ReturnType<typeof generateObject<typeof CeoBriefAiSchema>>>["object"];
    try {
      ({ object } = await generateObject({
        model: google(CEO_BRIEF_MODEL),
        schema: CeoBriefAiSchema,
        maxRetries: 2,
        prompt,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/model|not found|404|unsupported|invalid/i.test(msg) && CEO_BRIEF_MODEL !== GEMINI_MODEL) {
        console.warn(`[ceo-brief] model "${CEO_BRIEF_MODEL}" rejected (${msg}); falling back to ${GEMINI_MODEL}`);
        modelUsed = GEMINI_MODEL;
        ({ object } = await generateObject({
          model: google(GEMINI_MODEL),
          schema: CeoBriefAiSchema,
          maxRetries: 2,
          prompt,
        }));
      } else {
        throw err;
      }
    }

    // Merge code-computed risks with AI notes, keyed by id (robust to ordering).
    const noteById = new Map(object.riskNotes.map((n) => [n.id, n]));
    const risks: CeoBriefRiskRendered[] = signals.risks.map((r) => {
      const note = noteById.get(r.id);
      const { weight, ...rest } = r;
      void weight;
      return { ...rest, interpretation: note?.interpretation ?? r.metric };
    });

    const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
    const result: CeoBriefResult = {
      statusPct: signals.statusPct,
      grade: signals.grade,
      verdict: signals.verdict,
      headline: oneLine(object.headline),
      changes: signals.changes,
      risks,
      criticalEvents: signals.criticalEvents,
      timelineEvents: signals.timelineEvents,
      recommendations: object.recommendations.map((r) => ({
        category: r.category,
        action: oneLine(r.action),
        owner: oneLine(r.owner),
      })),
      bottomLine: oneLine(object.bottomLine),
    };

    await supabaseAdmin
      .from("ceo_brief_runs")
      .update({ is_current: false })
      .eq("organization_id", orgId)
      .eq("is_current", true);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("ceo_brief_runs")
      .update({
        status: "ready",
        model: modelUsed,
        snapshot_text: JSON.stringify(facts, null, 2),
        result_json: result,
        completed_at: new Date().toISOString(),
        is_current: true,
        error_message: null,
      })
      .eq("id", runId)
      .select("id, status, model, created_at, completed_at, error_message, result_json")
      .single();
    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "تعذّر حفظ الموجز");
    }
    return rowToStored(updated as BriefRunRow);
  } catch (err) {
    await supabaseAdmin
      .from("ceo_brief_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : "فشل توليد الموجز",
        is_current: false,
      })
      .eq("id", runId);
    throw err;
  }
}
