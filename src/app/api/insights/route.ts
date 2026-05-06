import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { InsightsSchema, type InsightsResult, type StoredInsightRun } from "@/lib/ai-insights-schema";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const INSIGHT_MODEL = "gemini-3-flash-preview";

type InsightRunRow = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  result_json: InsightsResult | null;
};

function rowToStoredInsight(row: InsightRunRow): StoredInsightRun {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    result: row.result_json,
  };
}

async function getCurrentStoredInsight(orgId: string): Promise<StoredInsightRun | null> {
  const { data } = await supabaseAdmin
    .from("ai_insight_runs")
    .select("id, status, model, created_at, completed_at, error_message, result_json")
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as InsightRunRow | null;
  return row ? rowToStoredInsight(row) : null;
}

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

  const buckets = new Map<string, { name: string; title: string; open: number; overdue: number; done: number }>();
  for (const row of teamLoad.data ?? []) {
    const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    if (!emp || !task) continue;
    if (!buckets.has(emp.id)) {
      buckets.set(emp.id, {
        name: emp.full_name,
        title: emp.job_title ?? "—",
        open: 0,
        overdue: 0,
        done: 0,
      });
    }
    const bucket = buckets.get(emp.id)!;
    if (task.status === "done") bucket.done += 1;
    else if (["todo", "in_progress", "review", "blocked"].includes(task.status)) {
      bucket.open += 1;
      if (task.due_date && task.due_date < today) bucket.overdue += 1;
    }
  }

  const teamRows = Array.from(buckets.values())
    .sort((a, b) => b.open - a.open)
    .slice(0, 10)
    .map((member) => `  - ${member.name}: ${member.open} مفتوحة, ${member.overdue} متأخرة, ${member.done} منجزة`)
    .join("\n");

  const eventTally: Record<string, number> = {};
  for (const event of recentEvents.data ?? []) {
    eventTally[event.event_type] = (eventTally[event.event_type] ?? 0) + 1;
  }
  const eventLines = Object.entries(eventTally)
    .sort((a, b) => b[1] - a[1])
    .map(([eventType, count]) => `  - ${eventType}: ${count}`)
    .join("\n");

  const overdueLines = (overdueTasks.data ?? [])
    .map((task) => {
      const project = Array.isArray(task.project) ? task.project[0] : task.project;
      const client = project && (Array.isArray(project.client) ? project.client[0] : project.client);
      const days = Math.floor((Date.now() - new Date(task.due_date).getTime()) / 86400000);
      return `  - "${task.title}" [${task.priority}] متأخرة ${days} يوم — ${project?.name ?? "—"} / ${client?.name ?? "—"}`;
    })
    .join("\n") || "  (لا توجد مهام متأخرة)";

  const blockedLines = (blockedTasks.data ?? [])
    .map((task) => {
      const project = Array.isArray(task.project) ? task.project[0] : task.project;
      return `  - "${task.title}" [${task.priority}] — ${project?.name ?? "—"}`;
    })
    .join("\n") || "  (لا توجد مهام متوقفة)";

  const handoverLines = (handovers.data ?? [])
    .map((handover) => `  - ${handover.client_name} [${handover.urgency_level}] — ${handover.status}`)
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
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const current = await getCurrentStoredInsight(session.orgId);
    return Response.json({ current });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل تحميل آخر تحليل" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST() {
  let runId: string | null = null;

  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("ai_insight_runs")
      .insert({
        organization_id: session.orgId,
        requested_by: session.userId,
        status: "running",
        model: INSIGHT_MODEL,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      throw new Error(insertError?.message ?? "تعذّر إنشاء سجل التحليل");
    }

    runId = inserted.id;
    const snapshot = await buildAnalysisSnapshot(session.orgId);

    const { object } = await generateObject({
      model: google(INSIGHT_MODEL),
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

    await supabaseAdmin
      .from("ai_insight_runs")
      .update({ is_current: false })
      .eq("organization_id", session.orgId)
      .eq("is_current", true);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("ai_insight_runs")
      .update({
        status: "ready",
        snapshot_text: snapshot,
        result_json: object,
        completed_at: new Date().toISOString(),
        is_current: true,
        error_message: null,
      })
      .eq("id", runId)
      .select("id, status, model, created_at, completed_at, error_message, result_json")
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "تعذّر حفظ نتيجة التحليل");
    }

    return Response.json({ current: rowToStoredInsight(updated as InsightRunRow) });
  } catch (err) {
    if (runId) {
      await supabaseAdmin
        .from("ai_insight_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : "فشل توليد الرؤى",
          is_current: false,
        })
        .eq("id", runId);
    }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "فشل توليد الرؤى" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
