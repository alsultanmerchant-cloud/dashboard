import "server-only";
import { stageLabel, type AgentTipContext, type TaskTipContext } from "@/lib/tech-tips/context";

const RULES = `أنت خبير تقني أول في وكالة تسويق سعودية (Sky Light). مهمتك: إعطاء الموظف المتخصص نصيحة تقنية عملية تساعده فعليًا على إنجاز عمله بجودة أعلى.

قواعد صارمة:
- نصيحة **تقنية متخصصة** في مجاله (سيو، سوشيال ميديا، إعلانات ممولة، تصميم، برمجة…) — لا كلام عام ولا تحفيزي.
- ملموسة وقابلة للتطبيق فورًا على المهمة/المشروع المذكور — استشهد بطبيعة المهمة والعميل.
- عربية فصحى موجزة ومباشرة. لا مقدمات.`;

function taskBlock(ctx: TaskTipContext): object {
  return {
    task: { title: ctx.task.title, code: ctx.task.code, stage: stageLabel(ctx.task.stage), service: ctx.task.service },
    project: ctx.project ? { name: ctx.project.name, client: ctx.project.client } : null,
    otherTasksInProject: ctx.siblings.map((s) => ({ title: s.title, stage: stageLabel(s.stage) })),
  };
}

export function buildAgentTipPrompt(
  ctx: AgentTipContext,
  knowledge: string,
  locale: "ar" | "en" = "ar",
): string {
  const payload = {
    specialization: ctx.specialization,
    activeServices: ctx.activeServices,
    focusTask: ctx.focusContext ? taskBlock(ctx.focusContext) : null,
  };
  if (locale === "en") {
    return `You are a senior technical expert at a Saudi marketing agency following the Sky Light workflow. Give the specialist practical technical guidance that materially improves the quality of their work.

Strict rules:
- Give specialized technical advice for their field, not generic motivation.
- Make it immediately applicable to the referenced task and project.
- Write concise, direct, professional English with no introduction.

Data:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

Instructions:
- focusTip: Give a specific technical recommendation that moves focusTask forward in its current stage. If no focusTask exists, give advice for specialization.
- generalTip: Give one best-practice recommendation for specialization that can be applied this week.${knowledge ? `\n\n${knowledge}` : ""}`;
  }

  return `${RULES}

البيانات:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

التعليمات:
- **focusTip**: نصيحة تقنية محددة لدفع "focusTask" خطوة للأمام في مرحلتها الحالية، مستندة لطبيعة المشروع والعميل. إن لم توجد focusTask، اكتب نصيحة في مجال "specialization".
- **generalTip**: نصيحة أفضل-ممارسة في مجال "specialization" قابلة للتطبيق هذا الأسبوع.${knowledge ? `\n\n${knowledge}` : ""}`;
}

export function buildTaskTipPrompt(ctx: TaskTipContext, specialization: string | null, knowledge: string): string {
  const payload = { specialization, ...taskBlock(ctx) };
  return `${RULES}

البيانات:
\`\`\`json
${JSON.stringify(payload)}
\`\`\`

التعليمات:
- **headline**: عنوان النصيحة التقنية الأنسب لإنجاز هذه المهمة بالذات بجودة عالية.
- **steps**: 2 إلى 4 خطوات عملية محددة لتطبيق النصيحة على هذه المهمة (وليست خطوات عامة).${knowledge ? `\n\n${knowledge}` : ""}`;
}
