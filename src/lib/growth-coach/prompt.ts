import "server-only";
import type { AgentGrowth, MetricTrend } from "@/lib/data/agent-growth";

// =========================================================================
// Growth-coach prompt. Unlike the generic tech-tip, this is grounded in the
// specialist's OWN measured numbers (on-time %, turnaround, rework) and their
// trend vs the prior month, plus concrete returned/overdue tasks. The model
// diagnoses where they actually stand and coaches the weak spot — it never
// invents numbers (every figure is handed to it pre-computed).
// =========================================================================

function metricJson(m: MetricTrend) {
  return {
    now: m.value,
    prevMonth: m.prev,
    change: m.delta,
    improved: m.improved,
    enoughHistory: !m.noBaseline,
    sampleSize: m.sampleSize, // events behind `now`; treat <5 as not yet reliable
  };
}

export function buildGrowthCoachPrompt(
  g: AgentGrowth,
  knowledge: string,
  locale: "ar" | "en" = "ar",
): string {
  const payload = {
    specialization: g.specialization || (locale === "en" ? "their specialty" : "تخصصه"),
    score: g.score,
    scoreConfidence: g.scoreConfidence, // "low" = thin sample, keep the read tentative
    openTasks: g.openTasks,
    overdueOwned: g.overdueOwned,
    // Deadline-based delivery on-time — the PRIMARY commitment signal (drives the score).
    onTimeDelivery: {
      pct: g.deliveryOnTimePct,
      sampleSize: g.deliveryDecidable,
      note: "delivered by deadline; primary signal — weight this most",
    },
    metrics: {
      slaOnTimePct: metricJson(g.onTimeRate), // SLA-within-stage rate; secondary, often tiny sample
      avgTurnaroundHours: metricJson(g.avgTurnaroundHours), // lower is better
      reworkReturns: metricJson(g.reworkReturns), // lower is better (client revisions)
    },
    recentlyReturnedOrOverdue: g.recentReturns.map((r) => ({
      title: r.title,
      service: r.service,
      stage: r.stage,
    })),
  };

  if (locale === "en") {
    return `You are a senior technical coach at a Saudi marketing agency (Sky Light). You are speaking privately to one specialist about THEIR OWN performance. Be constructive and motivating — never punitive, never compare them to colleagues.

Strict rules:
- Ground every statement in the numbers provided. NEVER invent a figure.
- If scoreConfidence is "low", or a metric's sampleSize is under 5, acknowledge the sample is small and keep the read tentative.
- Coaching must be specialized and technical for their field (SEO, social media, paid ads, design, dev…), not generic motivation.
- Make actions immediately applicable this week. Reference the returned/overdue tasks when relevant.
- Concise, direct, professional English. No preamble.

Data:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

Produce:
- diagnosis: 1–2 sentences on how this month compares to last, focused on the single most important metric (the one that worsened, or the clear weak spot like high rework / low on-time / slow turnaround).
- focusArea: the ONE area to work on this week to improve in their specialty.
- actions: 2–3 specific technical steps in their field to lift quality or speed.${knowledge ? `\n\n${knowledge}` : ""}`;
  }

  return `أنت مدرّب تقني أول في وكالة تسويق سعودية (Sky Light). تتحدث بشكل خاص مع موظف متخصص عن أدائه هو شخصيًا. كن بنّاءً ومحفّزًا — لا عقابيًا، ولا تقارنه بزملائه أبدًا.

قواعد صارمة:
- استند في كل جملة إلى الأرقام المعطاة. لا تخترع أي رقم.
- إذا كانت "scoreConfidence" = low أو كان "sampleSize" لأي مؤشر أقل من 5، فاذكر أن العينة صغيرة واجعل القراءة متحفظة.
- التدريب يجب أن يكون تقنيًا متخصصًا في مجاله (سيو، سوشيال ميديا، إعلانات ممولة، تصميم، برمجة…) لا كلامًا تحفيزيًا عامًا.
- اجعل الخطوات قابلة للتطبيق هذا الأسبوع، واستشهد بالمهام المرتجعة/المتأخرة عند المناسبة.
- عربية فصحى موجزة ومباشرة بلا مقدمات.

البيانات:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

أخرج:
- **diagnosis**: جملة أو جملتان تقارن هذا الشهر بالسابق، مركّزة على أهم مؤشر واحد (الذي تراجع، أو نقطة الضعف الواضحة كارتفاع الإرجاعات أو انخفاض الالتزام بالموعد أو بطء الإنجاز).
- **focusArea**: المجال الأهم الذي يركّز عليه هذا الأسبوع ليتحسّن في تخصصه.
- **actions**: من 2 إلى 3 خطوات تقنية محددة في مجاله لرفع الجودة أو السرعة.${knowledge ? `\n\n${knowledge}` : ""}`;
}
