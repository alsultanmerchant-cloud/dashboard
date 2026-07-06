import "server-only";
import type { z } from "zod";
import {
  TrajectoryAiSchema,
  RisksAiSchema,
  ActionsAiSchema,
  SynthesisAiSchema,
  type BriefSection,
} from "@/lib/ceo-brief-schema";
import type { CeoBriefSignals } from "@/lib/data/ceo-brief-signals";

// Per-section prompt builders for the CEO brief. The monolithic ~131-line
// prompt is split here into three focused prompts — one per visual question —
// each fed only the signal slice it needs. The blocking generator
// (generateAndStoreCeoBrief) and the streaming re-analyze route both import
// SECTION_DEFS, so the prompt + schema + signal-pick stay in lockstep across
// the two call sites. Re-export BriefSection so callers have one import.
export { isBriefSection, BRIEF_SECTIONS, type BriefSection } from "@/lib/ceo-brief-schema";

// The stronger brief model, shared so the blocking and streaming paths agree.
// The blocking path additionally falls back to GEMINI_MODEL on a model-rejection
// error; a committed stream cannot switch models mid-flight, so the route uses
// this value as-is.
export const CEO_BRIEF_MODEL = process.env.CEO_BRIEF_MODEL ?? "gemini-3.5-flash";

const VERDICT_AR = {
  improving: "تتحسّن",
  stable: "مستقرة",
  declining: "تتراجع",
} as const;

// Shared rules header + the live data-quality guardrail (lifted verbatim from
// the original prompt). Every section prompt starts with this so the model can
// never invent a number or flag the benign "new stage" as a risk.
function sharedHeader(signals: CeoBriefSignals): string {
  const caveats = signals.dataQuality.caveats;
  const dataQualityBlock = caveats.length
    ? `\n\n⚠️ قيود جودة البيانات (التزم بها حرفيًا):\n${caveats
        .map((c) => `- ${c}`)
        .join("\n")}\n- إن لم يكن الرقم مُعطى صراحةً في الحقائق أدناه، فلا تذكره. الأفضل عدم ذكر مؤشر على أن لا تذكره خاطئًا.`
    : "";
  return `أنت رئيس أركان (Chief of Staff) للرئيس التنفيذي لوكالة تسويق سعودية (رواسم).

قواعد صارمة:
- **لا تخترع أي رقم**. الأرقام كلها محسوبة مسبقًا في البيانات أدناه؛ مهمتك الصياغة وربط الأسباب فقط.
- عربية فصحى، حاسمة وموجزة، موجّهة للقرار. لا تشجيع ولا حشو.
- لا تعتبر مرحلة "new/جديدة" أو تراكم المهام فيها اختناقًا أو خطرًا أو إجراءً مطلوبًا. في رواسم هذا وضع طبيعي/أثر استيراد من Odoo، وليس مؤشرًا تشغيليًا مهمًا. ممنوع اقتراح "تحريك مهام جديدة" أو تقليل انتظار مرحلة جديدة.${dataQualityBlock}`;
}

const fence = (facts: unknown) => "```json\n" + JSON.stringify(facts) + "\n```";
const withKnowledge = (body: string, knowledge: string) =>
  knowledge ? `${body}\n\n${knowledge}` : body;

export interface SectionDef<S extends z.ZodTypeAny> {
  schema: S;
  pickSignals: (s: CeoBriefSignals) => Record<string, unknown>;
  buildPrompt: (s: CeoBriefSignals, knowledge: string) => string;
}

// Q1 «هل الشركة تتحسّن؟» → { headline }
export const trajectorySection: SectionDef<typeof TrajectoryAiSchema> = {
  schema: TrajectoryAiSchema,
  pickSignals: (s) => ({
    verdict: s.verdict,
    verdictArabic: VERDICT_AR[s.verdict],
    statusPct: s.statusPct,
    grade: s.grade,
    changes: s.changes,
    context: s.context,
    dataQuality: s.dataQuality,
  }),
  buildPrompt: (s, knowledge) => {
    const f = trajectorySection.pickSignals(s);
    return withKnowledge(
      `${sharedHeader(s)}

السؤال: هل الشركة تتحسّن أم تتراجع؟

البيانات (الحقائق المحسوبة):
${fence(f)}

استخدم **context** لتحديد جذور التغيّر (worstServices/bestService = أين يتركّز التراجع وأين القوة؛ wip = مزمن أم طارئ؛ discipline = صحة العملية).

التعليمات:
- **headline**: جملة واحدة تجيب السؤال وتُحدّد **أين** يتركّز التغيّر (الخدمة/المرحلة)، مستندةً إلى verdictArabic و statusPct و changes و context. مثال: "الوضع التشغيلي ${VERDICT_AR[s.verdict]} عند ${s.statusPct}% — مدفوعًا بـ… وتتركّز المشكلة في…".`,
      knowledge,
    );
  },
};

// Q2 «أين الخطر؟» → { riskNotes[] }
export const risksSection: SectionDef<typeof RisksAiSchema> = {
  schema: RisksAiSchema,
  pickSignals: (s) => ({
    risks: s.risks.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      metric: r.metric,
    })),
    context: s.context,
    dataQuality: s.dataQuality,
  }),
  buildPrompt: (s, knowledge) => {
    const f = risksSection.pickSignals(s);
    return withKnowledge(
      `${sharedHeader(s)}

السؤال: أين الخطر؟

البيانات (الحقائق المحسوبة):
${fence(f)}

استخدم **context** لتحديد جذور المشكلة وربط النقاط (وليس فقط سردها):
- worstServices/bestService = أين يتركّز التراجع وأين القوة.
- wip = هل التأخير مزمن (chronicOverdue ٣١-٩٠ يومًا) أم طارئ (freshOverdue)؟
- satisfaction = الرضا والعملاء المعرّضون للفقد (topChurn).
- zeroOnTimePerformers/discipline = الخلل البشري وصحة الانضباط.

التعليمات:
- **riskNotes**: عنصر واحد لكل خطر في risks بنفس الـ id. interpretation = لماذا هذا خطر وأثره، مع **ربطه بجذر السبب من context** (مثلاً ربط التأخير بالخدمة الأضعف أو بكونه مزمنًا).`,
      knowledge,
    );
  },
};

// Q3 «ماذا أفعل؟» → { recommendations[], bottomLine }
export const actionsSection: SectionDef<typeof ActionsAiSchema> = {
  schema: ActionsAiSchema,
  pickSignals: (s) => ({
    risks: s.risks.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      metric: r.metric,
    })),
    opportunities: s.opportunities,
    context: s.context,
    dataQuality: s.dataQuality,
  }),
  buildPrompt: (s, knowledge) => {
    const f = actionsSection.pickSignals(s);
    return withKnowledge(
      `${sharedHeader(s)}

السؤال: ماذا أفعل؟

البيانات (الحقائق المحسوبة):
${fence(f)}

التعليمات:
- **recommendations**: خطة عمل من ٤ إلى ٦ بنود **متنوّعة المجالات** تعالج **جذور** المشكلة من risks و context و opportunities معًا — وجّه التركيز للخدمة الأضعف، أنقذ العملاء المعرّضين للفقد (topChurn)، أعد توزيع الحمل، تابع التجديدات، عالج فريق zeroOnTimePerformers، واحمِ/استثمر ما ينجح (bestService/topPerformers/bestClients). لكل بند: category، action محدّد، owner (الدور المسؤول).
- **إعادة توزيع الحمل (مهم جدًا)**: اعتمد حصريًا على \`context.departmentCapacity\` — وهي مجمّعة **لكل قسم** (overloaded = محمَّلون فوق متوسط قسمهم · available = زملاء **في نفس القسم** لديهم سعة). أي اقتراح بنقل المهام يجب أن يكون **داخل نفس القسم فقط** وبأسماء من نفس القسم (المتخصص لا يستلم عمل تخصص آخر — مثلاً مهمة سوشيال لا تذهب لفريق السيو). **يُمنَع منعًا باتًا** خلط موظفين من أقسام مختلفة في نفس التوصية أو اقتراح نقل مهام بين الأقسام. إن كان قسمٌ محمّلًا بلا سعة داخلية، اقترح دعمًا/توظيفًا/تصعيدًا لذلك القسم — لا نقلًا لقسم آخر. owner لإعادة التوزيع = قائد/مدير ذلك القسم.
- **bottomLine**: جملة واحدة فقط — أهم إجراء يعالج أخطر جذر سبب اليوم.`,
      knowledge,
    );
  },
};

// Cross-section synthesis «القصة الواحدة» → { synthesis }. Fed the WHOLE fact
// universe (trajectory + risks + actions slices) so it can connect the dots the
// three parallel sections can't see across — e.g. tying the churn risk to the
// same clients behind on installments. Prose-only: it never emits a number.
export const synthesisSection: SectionDef<typeof SynthesisAiSchema> = {
  schema: SynthesisAiSchema,
  pickSignals: (s) => ({
    verdict: s.verdict,
    verdictArabic: VERDICT_AR[s.verdict],
    statusPct: s.statusPct,
    changes: s.changes,
    risks: s.risks.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      metric: r.metric,
    })),
    opportunities: s.opportunities,
    context: s.context,
    dataQuality: s.dataQuality,
  }),
  buildPrompt: (s, knowledge) => {
    const f = synthesisSection.pickSignals(s);
    return withKnowledge(
      `${sharedHeader(s)}

المهمة: اربط الأسئلة الثلاثة (الاتجاه · الخطر · الإجراء) في **قصة واحدة** للرئيس التنفيذي.

البيانات (الحقائق المحسوبة لكل الأقسام):
${fence(f)}

التعليمات:
- **synthesis**: تحليلٌ رابطٌ من ٢-٤ جمل يصل بين اتجاه الشركة (verdict/changes) وأخطر المخاطر (risks) وجذور السبب (context) والفرص (opportunities) — لا سردًا منفصلًا. اكشف **الخيط المشترك** حين يوجد (مثلاً: نفس الخدمة الأضعف تفسّر التأخير وخطر الفقد معًا، أو أنّ العملاء المعرّضين للفقد هم أنفسهم المتأخرون في الدفعات). اختم بما يعنيه ذلك للأولوية اليوم. **لا تخترع أي رقم** — اربط الأرقام المعطاة فقط، ولا تكرّر نص العناوين الأخرى حرفيًا.`,
      knowledge,
    );
  },
};

export const SECTION_DEFS = {
  trajectory: trajectorySection,
  risks: risksSection,
  actions: actionsSection,
  synthesis: synthesisSection,
} satisfies Record<BriefSection, SectionDef<z.ZodTypeAny>>;
