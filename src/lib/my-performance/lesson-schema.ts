import { z } from "zod";

// Per-failure "post-mortem" the AI writes when an agent opens a past miss.
// Grounded in that task's own numbers (delay, rework, time-in-stage) — the
// model writes only prose/advice, never invents figures. Field names stay
// stable for the streamed UI; prose language follows the request locale.
export const FailureLessonSchema = z.object({
  whatHappened: z
    .string()
    .describe("جملة أو جملتان تلخّص ما حدث في هذه المهمة بالأرقام (التأخير/الإرجاع/المرحلة التي طال فيها الوقت). وقائعي لا عقابي."),
  rootCauses: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe("من 1 إلى 3 أسباب جذرية محتملة للتعثّر، مستنبطة من المؤشرات المتاحة."),
  lesson: z
    .string()
    .describe("الدرس المستفاد في جملة واحدة واضحة — ما الذي يجب تذكّره من هذه التجربة."),
  improvements: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe("من 2 إلى 4 خطوات عملية محددة تمنع تكرار هذا التعثّر مستقبلًا في تخصص الموظف."),
});

export type FailureLesson = z.infer<typeof FailureLessonSchema>;
