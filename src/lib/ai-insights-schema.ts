import { z } from "zod";

export const InsightsSchema = z.object({
  executiveSummary: z
    .string()
    .describe("فقرة تلخيصية شاملة للحالة الراهنة بأسلوب مدير تنفيذي، 3-4 جمل، بالعربية"),
  overallHealth: z
    .enum(["excellent", "good", "concerning", "critical"])
    .describe("التقييم العام الشامل للوكالة"),
  alerts: z
    .array(
      z.object({
        level: z.enum(["critical", "warning", "info"]),
        title: z.string().describe("عنوان قصير للتنبيه"),
        body: z.string().describe("شرح موجز مع أرقام محددة من البيانات"),
        action: z.string().describe("الإجراء المقترح (جملة واحدة)"),
      }),
    )
    .describe("تنبيهات تحتاج اهتمامًا فوريًا — حرجة أو تحذيرية أو معلوماتية"),
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["urgent", "important", "suggestion"]),
        title: z.string().describe("عنوان الاقتراح"),
        body: z.string().describe("شرح تفصيلي مع تبرير مبني على البيانات"),
        estimatedImpact: z.string().describe("الأثر المتوقع على الأداء"),
      }),
    )
    .describe("توصيات عملية مرتبة حسب الأولوية"),
  patterns: z
    .array(
      z.object({
        title: z.string().describe("اسم النمط"),
        body: z.string().describe("وصف النمط المكتشف من البيانات مع شواهد رقمية"),
        type: z.enum(["positive", "negative", "neutral"]),
      }),
    )
    .describe("أنماط مكتشفة في سير العمل"),
  teamInsights: z
    .array(
      z.object({
        observation: z.string().describe("ملاحظة متعلقة بالفريق أو قسم أو موظف بعينه"),
        recommendation: z.string().describe("توصية محددة"),
      }),
    )
    .describe("رؤى تتعلق بأداء الفريق وتوزيع الأعمال"),
});

export type InsightsResult = z.infer<typeof InsightsSchema>;

export type StoredInsightRun = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  result: InsightsResult | null;
};
