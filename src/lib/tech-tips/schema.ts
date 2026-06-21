import { z } from "zod";

// Dashboard tip: one tip tied to the specialist's top-priority task, plus one
// general best-practice tip for their specialization. Arabic prose.
export const AgentTechTipSchema = z.object({
  focusTip: z
    .string()
    .describe("نصيحة تقنية ملموسة تساعد على تقديم المهمة الأهم خطوة للأمام، جملتان كحد أقصى"),
  generalTip: z
    .string()
    .describe("نصيحة عامة في مجال تخصص الموظف (مثل السيو)، قابلة للتطبيق هذا الأسبوع، جملتان كحد أقصى"),
});
export type AgentTechTipAi = z.infer<typeof AgentTechTipSchema>;

// Per-task tip on the task detail page: a headline + 2–4 actionable steps.
export const TaskTechTipSchema = z.object({
  headline: z.string().describe("عنوان النصيحة في جملة واحدة موجزة"),
  steps: z
    .array(z.string())
    .describe("2 إلى 4 خطوات عملية محددة لتنفيذ النصيحة على هذه المهمة بالذات"),
});
export type TaskTechTipAi = z.infer<typeof TaskTechTipSchema>;
