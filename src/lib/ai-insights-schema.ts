import { z } from "zod";

// Sky Light operations-tuned insight schema.
// All numeric/entity fields are pre-computed server-side from synced Odoo data;
// the model only writes Arabic narrative around them. This keeps tokens down
// and prevents the model from inventing numbers.

const SERVICE = z.enum(["social_media", "seo", "media_buying", "other"]);
const STAGE = z.enum([
  "new",
  "in_progress",
  "manager_review",
  "specialist_review",
  "ready_to_send",
  "sent_to_client",
  "client_changes",
  "done",
]);
const ROLE = z.enum([
  "specialist",
  "manager",
  "agent",
  "account_manager",
  "supporting_lead",
  "supporting_agent",
]);

export const InsightsSchema = z.object({
  executiveSummary: z
    .string()
    .describe("ملخص تنفيذي شامل من 3-4 جمل بالعربية الفصحى يصف الحالة الراهنة"),
  overallHealth: z
    .enum(["excellent", "good", "concerning", "critical"])
    .describe("التقييم العام للوكالة"),

  stageBottlenecks: z
    .array(
      z.object({
        stage: STAGE,
        count: z.number().int(),
        oldestDays: z.number().int().describe("أقدم مهمة في هذه المرحلة (بالأيام)"),
        sampleTaskCodes: z.array(z.string()).max(3).describe("أكواد أسوأ 3 مهام للاستشهاد"),
        narrative: z.string().describe("جملة عربية واحدة تشرح المشكلة والأثر"),
      }),
    )
    .max(4)
    .describe("اختناقات المراحل التي تتجمع فيها المهام أكثر من المتوقع"),

  clientsAtRisk: z
    .array(
      z.object({
        clientName: z.string(),
        projectCode: z.string().nullable(),
        reason: z.string().describe("سبب الخطر مع أرقام محددة"),
        suggestedAction: z.string().describe("إجراء واحد يمكن اتخاذه هذا الأسبوع"),
      }),
    )
    .max(5)
    .describe("عملاء يحتاجون انتباهًا فوريًا (مشاريع متأخرة قرب نهاية العقد، أو معلقة عند العميل)"),

  serviceHealth: z
    .array(
      z.object({
        service: SERVICE,
        openCount: z.number().int(),
        overdueCount: z.number().int(),
        onTimePct: z.number().int().min(0).max(100),
        note: z.string().describe("ملاحظة قصيرة تشخص الوضع، تذكر الفجوة الرئيسية"),
      }),
    )
    .max(4)
    .describe("صحة الخدمات الثلاث: السوشيال ميديا، SEO، ميديا باينج"),

  teamHotspots: z
    .array(
      z.object({
        employeeName: z.string(),
        role: ROLE,
        openCount: z.number().int(),
        overdueCount: z.number().int(),
        recommendation: z.string().describe("توصية محددة (إعادة توزيع، دعم، ترقية)"),
      }),
    )
    .max(5)
    .describe("نقاط الضغط في الفريق — فقط من يحتاج تدخلًا. الصمت = صحي."),

  quickWins: z
    .array(
      z.object({
        title: z.string().describe("عنوان قصير للإجراء"),
        description: z.string().describe("شرح موجز يستشهد بأكواد المهام أو المشاريع"),
        taskCodes: z.array(z.string()).max(5),
        expectedImpact: z.string().describe("الأثر المتوقع بجملة واحدة"),
      }),
    )
    .max(4)
    .describe("مكاسب سريعة يمكن إنجازها هذا الأسبوع لإزالة عوائق محددة"),
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
