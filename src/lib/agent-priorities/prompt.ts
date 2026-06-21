import "server-only";
import type { PrioritySignal } from "@/lib/agent-priorities/signals";

const STAGE_LABELS: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
};

const STAGE_LABELS_EN: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  manager_review: "Manager review",
  specialist_review: "Specialist review",
  ready_to_send: "Ready to send",
  sent_to_client: "Sent to client",
  client_changes: "Client changes",
};

const HEADER = `أنت مساعد تشغيلي لموظف في وكالة تسويق سعودية تتبع منهجية Sky Light (8 مراحل).
مهمتك: لكل مهمة في قائمة الأولويات المرتّبة مسبقًا، اكتب سببًا موجزًا لاختيارها والإجراء المقترح.

قواعد صارمة:
- **لا تُعد ترتيب المهام** ولا تحذف أو تضيف مهامًا — اكتب بندًا واحدًا لكل مهمة وردت، بنفس taskId.
- **لا تخترع أرقامًا** — استخدم الإشارات (الموعد، SLA، التبعيات) كما وردت تمامًا.
- عربية فصحى، نبرة عملية مباشرة موجّهة للتنفيذ. لكل بند: reason جملة واحدة، suggestedAction جملة واحدة تبدأ بفعل (ابدأ/راجع/ارفع/سلّم/حدّث).`;

// Build the per-task fact lines the model narrates. We pass the already-ranked
// signals verbatim; the model only adds prose.
function describe(s: PrioritySignal, locale: "ar" | "en"): Record<string, unknown> {
  return {
    taskId: s.taskId,
    code: s.taskCode,
    title: s.title,
    stage: (locale === "ar" ? STAGE_LABELS : STAGE_LABELS_EN)[s.stage] ?? s.stage,
    project: s.projectName,
    client: s.clientName,
    dueInDays: s.dueDeltaDays,
    isOverdue: s.isOverdue,
    slaBreachedByHours: s.slaOverByHours,
    daysWithoutUpdate: s.idleDays,
    uploadDueNow: s.uploadSoon,
    tasksDependingOnIt: s.dependentsCount,
  };
}

export function buildAgentPrioritiesPrompt(
  signals: PrioritySignal[],
  knowledge: string,
  locale: "ar" | "en" = "ar",
): string {
  const payload = { priorities: signals.map((signal) => describe(signal, locale)) };
  const header = locale === "ar"
    ? HEADER
    : `You are an operations assistant for an employee at a Saudi marketing agency following the Sky Light eight-stage workflow.
For every task in the pre-ranked priorities list, write a concise reason for its selection and the recommended action.

Strict rules:
- Do not reorder, remove, or add tasks. Return one item for every task with the same taskId.
- Do not invent numbers. Use the supplied deadline, SLA, and dependency signals exactly.
- Write concise, direct, professional English. Each reason and suggestedAction must be one sentence; suggestedAction must start with an action verb.`;
  const dataLabel = locale === "ar" ? "البيانات (الأولويات مرتّبة من الأهم)" : "Data (priorities are ordered from most important)";
  const instruction = locale === "ar"
    ? "أعد المصفوفة items بنفس عدد المهام وترتيبها، لكل مهمة { taskId, reason, suggestedAction }."
    : "Return the items array with the same task count and order. Each item must contain { taskId, reason, suggestedAction }.";
  return `${header}

${dataLabel}:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

${instruction}${knowledge ? `\n\n${knowledge}` : ""}`;
}
