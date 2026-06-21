import "server-only";
import {
  InsightSectionSchemas,
  type InsightSection,
} from "@/lib/ai-insights-schema";

// Per-section prompt builders for AI Insights. The monolithic prompt's
// per-section instructions are split here so each visual block can be
// re-analyzed independently and streamed. The full pre-computed payload is
// passed to every section (the model only narrates / copies numbers from it,
// never invents) — fresh each call so re-analyze reflects live data.
export {
  InsightSectionSchemas,
  INSIGHT_SECTIONS,
  isInsightSection,
  type InsightSection,
} from "@/lib/ai-insights-schema";

const HEADER = `أنت رئيس أركان (Chief of Staff) للرئيس التنفيذي لوكالة تسويق سعودية تتبع منهجية Sky Light (8 مراحل، 4 أدوار).
مهمتك: تحويل الإشارات المحتسبة مسبقًا إلى تقرير تنفيذي يساعد الشركة على التحسّن.

قواعد صارمة:
- **لا تخترع أرقامًا** — استخدم الأرقام كما وردت تمامًا في البيانات.
- استشهد بأكواد المهام/المشاريع الحقيقية الواردة في الإشارات.
- عربية فصحى، أسلوب رئيس أركان حاسم وموجز وموجّه للقرار. لا تشجيع ولا تعميم.
- اكتب فقط البنود المستندة فعلاً للبيانات — اترك المصفوفة فارغة إن لم يوجد ما يستحق.`;

// Section-specific instruction, lifted verbatim from the monolithic prompt.
const SECTION_INSTRUCTION: Record<InsightSection, string> = {
  summary:
    "- **executiveSummary**: 3-4 جمل تلخّص حالة الشركة وأبرز ما يحتاج قرارًا، مستعينًا بـ clientSatisfaction عند وجوده.\n- **overallHealth**: التقييم العام (excellent/good/concerning/critical) المتسق مع البيانات.",
  priorities:
    "- **topPriorities** (3 إلى 5 بنود): انظر عبر كل العدسات (المال/العملاء، التسليم، الأفراد، النمو) واختر أهم ما يجب أن يعرفه الرئيس التنفيذي اليوم، مرتّبًا بالأثر. لكل بند: finding (الحقيقة الرقمية)، businessImpact (الأثر)، recommendedAction (من يتحرك وماذا يفعل). category وseverity إلزاميان. استعن بـ clientSatisfaction عند وجوده.",
  delivery:
    "- **deliveryTrend**: انسخ الأرقام كما هي من deliveryTrend في البيانات (direction, onTimePctThisMonth, onTimePctLastMonth, completedThisMonth, completedLastMonth) واكتب narrative من جملتين يشرح الاتجاه وسببه. إذا كان deliveryTrend في البيانات null، أعِد null.",
  people:
    "- **peoplePerformance**: لكل موظف في القائمة، انسخ الحقول الرقمية وtier وtrend كما هي، واكتب assessment (تقييم واقعي مبني على الأرقام) وrecommendation (دعم، تخفيف حمل، أو تقدير للمتميزين). أبرز المتعثّرين (at_risk) والمحمّلين فوق طاقتهم والمتميزين بوضوح.",
  operations:
    "- **stageBottlenecks**: مراحل تتراكم فيها المهام >3 أيام — narrative يشرح الأثر التشغيلي.\n- **serviceHealth**: note قصيرة تشخّص الفجوة لكل خدمة.\n- **teamHotspots**: اقترح إعادة توزيع أو دعمًا محددًا لمن يحتاج تدخلًا فقط.",
  clients:
    "- **clientsAtRisk**: اقترح إجراءً ملموسًا. راعِ التجديدات القادمة في moneyAndGrowth، **وأدرج العملاء ذوي الرضا المنخفض أو الانطباع السلبي من clientSatisfaction.lowest** مع ذكر درجة الرضا وسبب الخطر، واقترح خطوة لإنقاذ العلاقة.",
  quickWins:
    "- **quickWins**: إجراءات قابلة للتنفيذ هذا الأسبوع، كل واحدة مربوطة بأكواد مهام حقيقية.",
};

export function buildInsightSectionPrompt(
  section: InsightSection,
  payloadForModel: object,
  knowledge: string,
): string {
  return `${HEADER}

البيانات:
\`\`\`json
${JSON.stringify(payloadForModel)}
\`\`\`

التعليمات (هذا القسم فقط):
${SECTION_INSTRUCTION[section]}${knowledge ? `\n\n${knowledge}` : ""}`;
}

export const INSIGHT_SECTION_SCHEMA = InsightSectionSchemas;
