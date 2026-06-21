import "server-only";
import type { MyFailureItem } from "@/lib/data/my-performance";

// =========================================================================
// Failure-lesson prompt. Grounded in ONE task's measured failure (delay,
// rework count, time-in-stage breakdown). The model diagnoses why it slipped
// and coaches how to avoid it — it never invents numbers (all handed to it).
// =========================================================================

const STAGE_AR: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
  done: "مكتملة",
};
const STAGE_EN: Record<string, string> = {
  new: "New",
  in_progress: "In Progress",
  manager_review: "Manager Review",
  specialist_review: "Specialist Review",
  ready_to_send: "Ready to Send",
  sent_to_client: "Sent to Client",
  client_changes: "Client Changes",
  done: "Done",
};

const KIND_AR: Record<MyFailureItem["kind"], string> = {
  overdue: "تأخّرت عن موعدها النهائي",
  rework: "أُعيدت بتعديلات من العميل",
  slow: "بقيت وقتًا طويلًا في إحدى المراحل",
};
const KIND_EN: Record<MyFailureItem["kind"], string> = {
  overdue: "missed its deadline",
  rework: "was sent back with client revisions",
  slow: "sat too long in one stage",
};

// Business minutes → working days (8h day), rounded to 1 decimal.
const toDays = (min: number | null) => (min == null ? null : Math.round((min / 480) * 10) / 10);

export function buildFailureLessonPrompt(
  item: MyFailureItem,
  specialization: string,
  knowledge: string,
  locale: "ar" | "en" = "ar",
): string {
  const stageMap = locale === "en" ? STAGE_EN : STAGE_AR;
  const payload = {
    title: item.title,
    project: item.projectName,
    client: item.clientName,
    problem: locale === "en" ? KIND_EN[item.kind] : KIND_AR[item.kind],
    delayDays: item.delayDays,
    timesReturnedToClientChanges: item.reworkCount,
    longestSingleStageDays: toDays(item.maxDwellMinutes),
    timeByStage: item.stages.map((s) => ({
      stage: stageMap[s.stage] ?? s.stage,
      days: toDays(s.dwellMinutes),
      visits: s.count,
    })),
    specialization: specialization || (locale === "en" ? "their specialty" : "تخصصه"),
  };

  if (locale === "en") {
    return `You are a senior technical coach at a Saudi marketing agency (Sky Light, an 8-stage workflow). You are reviewing ONE of a specialist's past tasks that slipped, privately with them. Be constructive and specific — never punitive, never compare to colleagues.

Strict rules:
- Ground every statement in the numbers provided. NEVER invent a figure.
- Identify where the time was actually lost using timeByStage (the stage with the most days is the bottleneck).
- Coaching must be technical and specific to their specialty, not generic motivation.
- Make improvements concrete and repeatable so this exact failure mode is avoided next time.
- Concise, direct, professional English. No preamble.

Task data:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

Produce:
- whatHappened: 1–2 factual sentences citing the numbers (delay / returns / slowest stage).
- rootCauses: 1–3 likely causes, inferred from the stage where time was lost and the failure type.
- lesson: the single takeaway to remember from this task.
- improvements: 2–4 concrete steps in their specialty to prevent this failure mode.${knowledge ? `\n\n${knowledge}` : ""}`;
  }

  return `أنت مدرّب تقني أول في وكالة تسويق سعودية (Sky Light، منهجية من 8 مراحل). تراجع بشكل خاص مع موظف متخصص إحدى مهامه السابقة التي تعثّرت. كن بنّاءً ومحددًا — لا عقابيًا، ولا تقارنه بزملائه.

قواعد صارمة:
- استند في كل جملة إلى الأرقام المعطاة. لا تخترع أي رقم.
- حدّد أين ضاع الوقت فعلًا من timeByStage (المرحلة الأكثر أيامًا هي عنق الزجاجة).
- التدريب يجب أن يكون تقنيًا متخصصًا في مجاله لا كلامًا تحفيزيًا عامًا.
- اجعل خطوات التحسين ملموسة وقابلة للتكرار حتى لا يتكرر هذا النوع من التعثّر.
- عربية فصحى موجزة ومباشرة بلا مقدمات.

بيانات المهمة:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

أخرج:
- **whatHappened**: جملة أو جملتان وقائعيتان تستشهدان بالأرقام (التأخير / الإرجاعات / أبطأ مرحلة).
- **rootCauses**: من 1 إلى 3 أسباب جذرية محتملة، مستنبطة من المرحلة التي ضاع فيها الوقت ونوع التعثّر.
- **lesson**: الدرس الواحد الذي يجب تذكّره من هذه المهمة.
- **improvements**: من 2 إلى 4 خطوات ملموسة في تخصصه لمنع تكرار هذا التعثّر.${knowledge ? `\n\n${knowledge}` : ""}`;
}
