import { generateObject } from "ai";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { InsightsSchema, type InsightsResult, type StoredInsightRun } from "@/lib/ai-insights-schema";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { aiModel, MODELS } from "@/lib/ai-model";
import { buildSignalPack } from "@/lib/insights/signal-pack";


// How long a stored insight is considered fresh. Clicking "تحديث التحليل"
// within this window returns the cached run instead of burning another
// Gemini call. Pass ?force=1 to bypass.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes


type InsightRunRow = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  result_json: InsightsResult | null;
};

function rowToStoredInsight(row: InsightRunRow): StoredInsightRun {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    result: row.result_json,
  };
}

async function getCurrentStoredInsight(orgId: string): Promise<StoredInsightRun | null> {
  const { data } = await supabaseAdmin
    .from("ai_insight_runs")
    .select("id, status, model, created_at, completed_at, error_message, result_json")
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as InsightRunRow | null;
  return row ? rowToStoredInsight(row) : null;
}


export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const current = await getCurrentStoredInsight(session.orgId);
    return Response.json({ current });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل تحميل آخر تحليل" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST(req: Request) {
  let runId: string | null = null;

  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    // TTL cache: return the existing current run if it's still fresh.
    // Caller can pass ?force=1 to bypass and force a fresh Gemini run.
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force) {
      const cached = await getCurrentStoredInsight(session.orgId);
      // Serve the cache only while fresh AND built on the current instructions;
      // a newly-taught lesson (stale) forces a regenerate even within the TTL.
      if (cached?.completedAt && !cached.stale) {
        const age = Date.now() - new Date(cached.completedAt).getTime();
        if (age < CACHE_TTL_MS) {
          return Response.json({ current: cached, cached: true });
        }
      }
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("ai_insight_runs")
      .insert({
        organization_id: session.orgId,
        requested_by: session.userId,
        status: "running",
        model: MODELS.arabicGen,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      throw new Error(insertError?.message ?? "تعذّر إنشاء سجل التحليل");
    }

    runId = inserted.id;
    const [{ snapshotForStorage, payloadForModel }, knowledge] = await Promise.all([
      buildSignalPack(session.orgId),
      buildKnowledgeBlock(session.orgId),
    ]);

    const { object } = await generateObject({
      model: aiModel("arabicGen"),
      schema: InsightsSchema,
      prompt: `أنت رئيس أركان (Chief of Staff) للرئيس التنفيذي لوكالة تسويق سعودية تتبع منهجية Sky Light (8 مراحل، 4 أدوار).
مهمتك: تحويل الإشارات المحتسبة مسبقًا أدناه إلى **تقرير تنفيذي يساعد الشركة على التحسّن**.

قواعد صارمة:
- **لا تخترع أرقامًا** — استخدم الأرقام كما وردت تمامًا.
- استشهد بأكواد المهام/المشاريع الحقيقية الواردة في الإشارات.
- اللغة: عربية فصحى، أسلوب رئيس أركان يخاطب الرئيس التنفيذي — حاسم، موجز، موجّه للقرار. لا تشجيعي ولا تعميمي.
- لكل قسم، اكتب فقط البنود المستندة فعلاً للبيانات — اترك المصفوفة فارغة إن لم يوجد ما يستحق.

البيانات:
\`\`\`json
${JSON.stringify(payloadForModel)}
\`\`\`

تعليمات لكل قسم:
- **topPriorities** (الأهم — 3 إلى 5 بنود): انظر عبر كل العدسات (المال/العملاء، التسليم، الأفراد، النمو) واختر أهم ما يجب أن يعرفه الرئيس التنفيذي اليوم، مرتّبًا بالأثر على الأعمال. لكل بند: finding (الحقيقة الرقمية)، businessImpact (الأثر: مال/عميل/سمعة)، recommendedAction (من يتحرك وماذا يفعل). category وseverity إلزاميان.
- **deliveryTrend**: انسخ الأرقام كما هي من deliveryTrend في البيانات (direction, onTimePctThisMonth, onTimePctLastMonth, completedThisMonth, completedLastMonth) واكتب narrative من جملتين يشرح الاتجاه وسببه. إذا كان deliveryTrend في البيانات null، أعِد null.
- **peoplePerformance**: لكل موظف في القائمة، انسخ الحقول الرقمية وtier وtrend كما هي، واكتب assessment (تقييم واقعي مبني على الأرقام) وrecommendation (دعم، تخفيف حمل، أو تقدير للمتميزين). أبرز المتعثّرين (at_risk) والمحمّلين فوق طاقتهم والمتميزين بوضوح.
- **stageBottlenecks**: مراحل تتراكم فيها المهام >3 أيام — narrative يشرح الأثر التشغيلي.
- **clientsAtRisk**: الاقتراح إجراء ملموس. راعِ التجديدات القادمة في moneyAndGrowth، **وأدرج العملاء ذوي الرضا المنخفض أو الانطباع السلبي من clientSatisfaction.lowest** مع ذكر درجة الرضا وسبب الخطر، واقترح خطوة لإنقاذ العلاقة.
- استخدم **clientSatisfaction** (متوسط الرضا، الالتزام بالبريف، عدد العملاء المعرضين للفقد) في **executiveSummary** و**topPriorities** عند وجوده — تراجع الرضا أو الالتزام بالبريف أو ارتفاع عدد العملاء المعرضين للفقد إشارة عالية الأولوية.
- **serviceHealth**: note قصيرة تشخّص الفجوة لكل خدمة.
- **teamHotspots**: اقترح إعادة توزيع أو دعمًا محددًا.
- **quickWins**: إجراءات قابلة للتنفيذ هذا الأسبوع، كل واحدة مربوطة بأكواد مهام.
- **executiveSummary**: 3-4 جمل تلخّص حالة الشركة وأبرز ما يحتاج قرارًا.${knowledge ? `\n\n${knowledge}` : ""}`,
    });

    await supabaseAdmin
      .from("ai_insight_runs")
      .update({ is_current: false })
      .eq("organization_id", session.orgId)
      .eq("is_current", true);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("ai_insight_runs")
      .update({
        status: "ready",
        snapshot_text: snapshotForStorage,
        result_json: object,
        completed_at: new Date().toISOString(),
        is_current: true,
        error_message: null,
      })
      .eq("id", runId)
      .select("id, status, model, created_at, completed_at, error_message, result_json")
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "تعذّر حفظ نتيجة التحليل");
    }

    return Response.json({ current: rowToStoredInsight(updated as InsightRunRow) });
  } catch (err) {
    if (runId) {
      await supabaseAdmin
        .from("ai_insight_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : "فشل توليد الرؤى",
          is_current: false,
        })
        .eq("id", runId);
    }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل توليد الرؤى" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
