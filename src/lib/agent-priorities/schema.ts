import { z } from "zod";

// AI output for the agent "Today Priorities" section. The code ranks and picks
// the tasks; the model only fills the Arabic `reason` (why this is a priority)
// and `suggestedAction` (what to do), keyed by `taskId` so we can merge the
// prose back onto the code-ranked list. It must NOT invent tasks or numbers.
export const AgentPrioritiesSchema = z.object({
  items: z
    .array(
      z.object({
        taskId: z.string().describe("معرّف المهمة كما ورد في البيانات — انسخه حرفيًا"),
        reason: z.string().describe("سبب اختيار هذه المهمة كأولوية، جملة واحدة موجزة بالعربية"),
        suggestedAction: z
          .string()
          .describe("الإجراء المقترح: ابدأ/راجع/ارفع/سلّم… جملة واحدة قصيرة بالعربية"),
      }),
    )
    .describe("الأولويات مرتّبة كما وردت في البيانات — لا تُعد الترتيب"),
});

export type AgentPrioritiesAi = z.infer<typeof AgentPrioritiesSchema>;
