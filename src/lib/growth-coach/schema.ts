import { z } from "zod";

// The AI growth coach reads the specialist's own scorecard + trend and returns
// a short, constructive, specialty-specific coaching note. Prose language
// follows the request locale; field names stay stable for the streamed UI.
export const GrowthCoachSchema = z.object({
  diagnosis: z
    .string()
    .describe(
      "قراءة موجزة (جملة أو جملتان) لأداء الموظف هذا الشهر مقارنة بالشهر السابق، مبنية على الأرقام الفعلية ومركّزة على أهم نقطة. نبرة بنّاءة لا عقابية.",
    ),
  focusArea: z
    .string()
    .describe("مجال واحد محدد يركّز عليه الموظف هذا الأسبوع ليتحسّن في تخصصه (جملة واحدة)."),
  actions: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe("من 2 إلى 3 خطوات تقنية عملية ومحددة في مجال تخصصه لرفع جودته أو سرعته."),
});
export type GrowthCoachAi = z.infer<typeof GrowthCoachSchema>;
