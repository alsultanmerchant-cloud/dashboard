import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

const InsightsSchema = z.object({
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

async function buildAnalysisSnapshot(orgId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    projects,
    overdueTasks,
    blockedTasks,
    doneTasks,
    openTasks,
    handovers,
    teamLoad,
    recentEvents,
  ] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, status")
      .eq("organization_id", orgId)
      .eq("status", "active"),
    supabaseAdmin
      .from("tasks")
      .select("id, title, status, priority, due_date, project:projects(name, client:clients(name))")
      .eq("organization_id", orgId)
      .in("status", ["todo", "in_progress", "review", "blocked"])
      .lt("due_date", today)
      .order("due_date", { ascending: true })
      .limit(10),
    supabaseAdmin
      .from("tasks")
      .select("id, title, priority, project:projects(name)")
      .eq("organization_id", orgId)
      .eq("status", "blocked")
      .limit(8),
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "done")
      .gte("completed_at", weekAgo),
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("status", ["todo", "in_progress", "review", "blocked"]),
    supabaseAdmin
      .from("sales_handover_forms")
      .select("client_name, urgency_level, status, created_at")
      .eq("organization_id", orgId)
      .in("status", ["submitted", "in_review"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("task_assignees")
      .select("task_id, task:tasks!inner(id, status, due_date), employee:employee_profiles(id, full_name, job_title)")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("ai_events")
      .select("event_type, importance")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // compute team load
  const buckets = new Map<string, { name: string; title: string; open: number; overdue: number; done: number }>();
  for (const row of teamLoad.data ?? []) {
    const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    if (!emp || !task) continue;
    if (!buckets.has(emp.id)) buckets.set(emp.id, { name: emp.full_name, title: emp.job_title ?? "—", open: 0, overdue: 0, done: 0 });
    const b = buckets.get(emp.id)!;
    if (task.status === "done") b.done++;
    else if (["todo", "in_progress", "review", "blocked"].includes(task.status)) {
      b.open++;
      if (task.due_date && task.due_date < today) b.overdue++;
    }
  }
  const teamRows = Array.from(buckets.values())
    .sort((a, b) => b.open - a.open)
    .slice(0, 10)
    .map((m) => `  - ${m.name}: ${m.open} مفتوحة, ${m.overdue} متأخرة, ${m.done} منجزة`)
    .join("\n");

  // event tally
  const eventTally: Record<string, number> = {};
  for (const e of recentEvents.data ?? []) eventTally[e.event_type] = (eventTally[e.event_type] ?? 0) + 1;
  const eventLines = Object.entries(eventTally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  const overdueLines = (overdueTasks.data ?? [])
    .map((t) => {
      const proj = Array.isArray(t.project) ? t.project[0] : t.project;
      const client = proj && (Array.isArray(proj.client) ? proj.client[0] : proj.client);
      const days = Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000);
      return `  - "${t.title}" [${t.priority}] متأخرة ${days} يوم — ${proj?.name ?? "—"} / ${client?.name ?? "—"}`;
    })
    .join("\n") || "  (لا توجد مهام متأخرة)";

  const blockedLines = (blockedTasks.data ?? [])
    .map((t) => {
      const proj = Array.isArray(t.project) ? t.project[0] : t.project;
      return `  - "${t.title}" [${t.priority}] — ${proj?.name ?? "—"}`;
    })
    .join("\n") || "  (لا توجد مهام متوقفة)";

  const handoverLines = (handovers.data ?? [])
    .map((h) => `  - ${h.client_name} [${h.urgency_level}] — ${h.status}`)
    .join("\n") || "  (لا توجد تسليمات معلقة)";

  return `## لقطة تحليلية شاملة لوكالة رواسم — ${new Date().toLocaleDateString("ar-SA-u-nu-latn")}

### الأرقام الرئيسية
- المشاريع النشطة: ${projects.data?.length ?? 0}
- المهام المفتوحة: ${openTasks.count ?? 0}
- المهام المتأخرة: ${overdueTasks.data?.length ?? 0}
- المهام المتوقفة: ${blockedTasks.data?.length ?? 0}
- المهام المنجزة هذا الأسبوع: ${doneTasks.count ?? 0}
- تسليمات المبيعات المعلقة: ${handovers.data?.length ?? 0}

### المهام المتأخرة (أعلى 20)
${overdueLines}

### المهام المتوقفة
${blockedLines}

### تسليمات المبيعات المعلقة
${handoverLines}

### حمل الفريق (أعلى 15 موظفًا نشاطًا)
${teamRows || "  (لا يوجد بيانات تعيين)"}

### الأحداث الذكية المسجَّلة (آخر 100)
${eventLines || "  (لا يوجد أحداث)"}

### سياق العمل
- الوكالة: رواسم — وكالة تسويق سعودية
- الخدمات: سوشيال ميديا · SEO · ميديا باينج
- المرحلة التشغيلية: نمو نشط مع مشاريع متعددة موازية`;
}

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const snapshot = await buildAnalysisSnapshot(session.orgId);

    const { object } = await generateObject({
      model: google("gemini-3-flash-preview"),
      schema: InsightsSchema,
      prompt: `أنت مستشار عمليات خبير لوكالات التسويق. حلّل البيانات التالية وقدّم رؤى عملية دقيقة ومبنية على الأرقام الفعلية. كن مباشرًا وتحليليًا لا تشجيعيًا.

${snapshot}

قواعد مهمة:
1. استند فقط إلى الأرقام الواردة في البيانات — لا تتخيل أو تقدّر
2. إذا كانت المهام المتأخرة صفرًا فلا تذكر تحذيرات عنها
3. اكتشف الأنماط الحقيقية: هل التأخير في قسم بعينه؟ هل موظف معين مثقل؟
4. التوصيات يجب أن تكون قابلة للتنفيذ فورًا
5. اللغة: العربية الفصحى الواضحة`,
    });

    return Response.json(object);
  } catch (err) {
    console.error("Insights generation error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل توليد الرؤى" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
