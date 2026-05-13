import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { InsightsSchema, type InsightsResult, type StoredInsightRun } from "@/lib/ai-insights-schema";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const INSIGHT_MODEL = "gemini-3-flash-preview";

// How long a stored insight is considered fresh. Clicking "تحديث التحليل"
// within this window returns the cached run instead of burning another
// Gemini call. Pass ?force=1 to bypass.
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

// Sky Light–shaped signal pack. All heavy classification happens here so the
// model only narrates pre-computed numbers and cites concrete task/project
// codes that already exist in the data — it cannot invent.
async function buildSignalPack(orgId: string): Promise<{
  snapshotForStorage: string;
  payloadForModel: object;
}> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const SERVICE_SLUGS: Record<string, "social_media" | "seo" | "media_buying"> = {
    "social-media-management": "social_media",
    seo: "seo",
    "media-buying": "media_buying",
  };

  const [
    projectsRes,
    openTasksRes,
    doneWeekRes,
    servicesRes,
    assigneesRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, project_code, end_date, status, client:clients(name)")
      .eq("organization_id", orgId)
      .eq("status", "active"),
    supabaseAdmin
      .from("tasks")
      .select(
        "id, task_code, title, stage, priority, due_date, planned_date, is_overdue, delay_days, stage_entered_at, service_id, project_id",
      )
      .eq("organization_id", orgId)
      .not("stage", "eq", "done"),
    supabaseAdmin
      .from("tasks")
      .select("id, service_id")
      .eq("organization_id", orgId)
      .eq("stage", "done")
      .gte("completed_at", weekAgo),
    supabaseAdmin
      .from("services")
      .select("id, slug, name")
      .eq("organization_id", orgId),
    supabaseAdmin
      .from("task_assignees")
      .select(
        "task_id, role_type, employee:employee_profiles!task_assignees_employee_id_fkey(id, full_name)",
      )
      .eq("organization_id", orgId),
  ]);

  const projects = projectsRes.data ?? [];
  const openTasks = openTasksRes.data ?? [];
  const services = servicesRes.data ?? [];
  const assignees = assigneesRes.data ?? [];

  const serviceKey = (id: string | null) => {
    if (!id) return "other" as const;
    const slug = services.find((s) => s.id === id)?.slug;
    return slug && SERVICE_SLUGS[slug] ? SERVICE_SLUGS[slug] : ("other" as const);
  };

  // Stage bottlenecks: bucket open tasks by stage, sort by oldest stage_entered_at.
  type StageBucket = {
    stage: string;
    count: number;
    oldestDays: number;
    samples: Array<{ task_code: string | null; days: number; title: string }>;
  };
  const stageBuckets = new Map<string, StageBucket>();
  for (const t of openTasks) {
    if (t.stage === "done") continue;
    const days = Math.max(
      0,
      Math.floor((now.getTime() - new Date(t.stage_entered_at).getTime()) / 86400000),
    );
    let b = stageBuckets.get(t.stage);
    if (!b) {
      b = { stage: t.stage, count: 0, oldestDays: 0, samples: [] };
      stageBuckets.set(t.stage, b);
    }
    b.count += 1;
    if (days > b.oldestDays) b.oldestDays = days;
    b.samples.push({ task_code: t.task_code, days, title: t.title });
  }
  const stageBottlenecks = Array.from(stageBuckets.values())
    // A "bottleneck" is a stage with multiple tasks where the oldest is > 3 days.
    .filter((b) => b.count >= 2 && b.oldestDays >= 3)
    .sort((a, b) => b.oldestDays - a.oldestDays)
    .slice(0, 4)
    .map((b) => ({
      stage: b.stage,
      count: b.count,
      oldestDays: b.oldestDays,
      sampleTaskCodes: b.samples
        .sort((x, y) => y.days - x.days)
        .slice(0, 3)
        .map((s) => s.task_code)
        .filter((c): c is string => !!c),
    }));

  // Service health: per-service open/overdue/onTime/doneThisWeek.
  type ServiceStat = {
    service: "social_media" | "seo" | "media_buying" | "other";
    openCount: number;
    overdueCount: number;
    doneThisWeek: number;
  };
  const serviceStats = new Map<string, ServiceStat>();
  const ensureService = (key: ServiceStat["service"]) => {
    let s = serviceStats.get(key);
    if (!s) {
      s = { service: key, openCount: 0, overdueCount: 0, doneThisWeek: 0 };
      serviceStats.set(key, s);
    }
    return s;
  };
  for (const t of openTasks) {
    const s = ensureService(serviceKey(t.service_id));
    s.openCount += 1;
    if (t.is_overdue) s.overdueCount += 1;
  }
  for (const t of doneWeekRes.data ?? []) {
    ensureService(serviceKey(t.service_id)).doneThisWeek += 1;
  }
  const serviceHealth = Array.from(serviceStats.values())
    .filter((s) => s.openCount + s.doneThisWeek > 0)
    .map((s) => {
      const total = s.openCount + s.doneThisWeek;
      const onTimePct =
        total === 0 ? 100 : Math.round(((total - s.overdueCount) / total) * 100);
      return {
        service: s.service,
        openCount: s.openCount,
        overdueCount: s.overdueCount,
        onTimePct,
      };
    });

  // Clients at risk: active project ending within 30d AND has open overdue tasks,
  // OR project has 3+ overdue tasks regardless of end_date.
  const tasksByProject = new Map<string, typeof openTasks>();
  for (const t of openTasks) {
    if (!tasksByProject.has(t.project_id))
      tasksByProject.set(t.project_id, [] as typeof openTasks);
    tasksByProject.get(t.project_id)!.push(t);
  }
  const clientsAtRisk = projects
    .map((p) => {
      const ts = tasksByProject.get(p.id) ?? [];
      const overdue = ts.filter((t) => t.is_overdue);
      const endingSoon = p.end_date && p.end_date <= in30Days && p.end_date >= today;
      const sentToClientStuck = ts.filter(
        (t) =>
          (t.stage === "sent_to_client" || t.stage === "client_changes") &&
          Math.floor(
            (now.getTime() - new Date(t.stage_entered_at).getTime()) / 86400000,
          ) >= 4,
      );
      const reasons: string[] = [];
      if (overdue.length >= 3) reasons.push(`${overdue.length} مهام متأخرة`);
      if (endingSoon && overdue.length >= 1)
        reasons.push(`عقد ينتهي ${p.end_date} مع ${overdue.length} متأخر`);
      if (sentToClientStuck.length >= 2)
        reasons.push(`${sentToClientStuck.length} عالقة مع العميل >4 أيام`);
      if (reasons.length === 0) return null;
      const client = Array.isArray(p.client) ? p.client[0] : p.client;
      return {
        clientName: client?.name ?? p.name,
        projectCode: p.project_code ?? null,
        reasons,
        overdueSampleCodes: overdue
          .map((t) => t.task_code)
          .filter((c): c is string => !!c)
          .slice(0, 3),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, 5);

  // Team hotspots: employees with high open load AND multiple overdue.
  type EmpBucket = {
    name: string;
    role: string;
    open: number;
    overdue: number;
    sampleCodes: string[];
  };
  const overdueByTask = new Map<string, boolean>();
  const codeByTask = new Map<string, string | null>();
  for (const t of openTasks) {
    overdueByTask.set(t.id, t.is_overdue);
    codeByTask.set(t.id, t.task_code);
  }
  const empBuckets = new Map<string, EmpBucket>();
  for (const a of assignees) {
    const emp = Array.isArray(a.employee) ? a.employee[0] : a.employee;
    if (!emp) continue;
    const key = `${emp.id}:${a.role_type}`;
    if (!empBuckets.has(key))
      empBuckets.set(key, {
        name: emp.full_name,
        role: a.role_type,
        open: 0,
        overdue: 0,
        sampleCodes: [],
      });
    const b = empBuckets.get(key)!;
    if (overdueByTask.has(a.task_id)) {
      b.open += 1;
      if (overdueByTask.get(a.task_id)) {
        b.overdue += 1;
        const code = codeByTask.get(a.task_id);
        if (code && b.sampleCodes.length < 3) b.sampleCodes.push(code);
      }
    }
  }
  const teamHotspots = Array.from(empBuckets.values())
    .filter((b) => b.open >= 6 || b.overdue >= 2)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    .slice(0, 5)
    .map((b) => ({
      employeeName: b.name,
      role: b.role,
      openCount: b.open,
      overdueCount: b.overdue,
      sampleOverdueCodes: b.sampleCodes,
    }));

  // Headline counters (used in summary + as a fallback denominator).
  const totalOpen = openTasks.length;
  const totalOverdue = openTasks.filter((t) => t.is_overdue).length;
  const totalDoneWeek = (doneWeekRes.data ?? []).length;

  const payloadForModel = {
    today,
    headline: {
      activeProjects: projects.length,
      openTasks: totalOpen,
      overdueTasks: totalOverdue,
      doneThisWeek: totalDoneWeek,
    },
    stageBottlenecks,
    serviceHealth,
    clientsAtRisk,
    teamHotspots,
    context: {
      stages: [
        "new",
        "in_progress",
        "manager_review",
        "specialist_review",
        "ready_to_send",
        "sent_to_client",
        "client_changes",
        "done",
      ],
      roles: ["specialist", "manager", "agent", "account_manager"],
      agency: "رواسم — وكالة تسويق سعودية",
    },
  };

  const snapshotForStorage = JSON.stringify(payloadForModel, null, 2);
  return { snapshotForStorage, payloadForModel };
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

export async function POST(req: Request) {
  let runId: string | null = null;

  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    // TTL cache: return the existing current run if it's still fresh.
    // Caller can pass ?force=1 to bypass and force a fresh Gemini run.
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force) {
      const cached = await getCurrentStoredInsight(session.orgId);
      if (cached?.completedAt) {
        const age = Date.now() - new Date(cached.completedAt).getTime();
        if (age < CACHE_TTL_MS) {
          return Response.json({ current: cached, cached: true });
        }
      }
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
    const { snapshotForStorage, payloadForModel } = await buildSignalPack(
      session.orgId,
    );

    const { object } = await generateObject({
      model: google(INSIGHT_MODEL),
      schema: InsightsSchema,
      prompt: `أنت مستشار عمليات لوكالة تسويق سعودية تتبع منهجية Sky Light (8 مراحل، 4 أدوار).
ستجد أدناه إشارات تم احتسابها مسبقًا من قاعدة البيانات. **لا تخترع أرقامًا**.
- استخدم الأرقام كما هي.
- استشهد بأكواد المهام (task_code) والمشاريع (project_code) الحقيقية الواردة في الإشارات.
- لكل قسم، اكتب فقط البنود التي تستند فعلاً للبيانات — اترك المصفوفة فارغة إذا لم يوجد ما يستحق الذكر.
- اللغة: العربية الفصحى الواضحة، أسلوب مدير عمليات، لا تشجيعي ولا تعميمي.

البيانات:
\`\`\`json
${JSON.stringify(payloadForModel)}
\`\`\`

ملاحظات تحليلية:
- "stage_bottlenecks" = مراحل تتراكم فيها المهام أكثر من 3 أيام. اكتب narrative يشرح الأثر التشغيلي.
- "clients_at_risk" = عملاء بمشاريع متعددة المتأخرات أو عقد ينتهي قريبًا. الاقتراح يجب أن يكون إجراءً ملموسًا.
- "service_health" = أعطِ note قصيرة لكل خدمة تشخص الفجوة (مثلاً "تأخر في تصاميم الأسبوع 2").
- "team_hotspots" = اقترح إعادة توزيع أو دعم محدد. لا تُضِف بنودًا تكميلية.
- "quick_wins" = إجراءات يمكن إنجازها هذا الأسبوع، كل واحدة مربوطة بأكواد مهام محددة.`,
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
        snapshot_text: snapshotForStorage,
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
