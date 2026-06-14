import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { InsightsSchema, type InsightsResult, type StoredInsightRun } from "@/lib/ai-insights-schema";
import { getOrgSatisfactionAggregate, getAtRiskClients } from "@/lib/data/satisfaction";
import { GEMINI_MODEL } from "@/lib/ai-model";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const INSIGHT_MODEL = GEMINI_MODEL;

// How long a stored insight is considered fresh. Clicking "تحديث التحليل"
// within this window returns the cached run instead of burning another
// Gemini call. Pass ?force=1 to bypass.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Run a read-only aggregate query through the analytics RPC. Used for the
// trend / per-employee metrics that are far cleaner expressed as SQL than
// re-implemented in JS.
async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql,
  });
  if (error) {
    console.warn(`insights: analytics query failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as T[];
}

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
      .is("archived_at", null)
      .not("stage", "eq", "done"),
    supabaseAdmin
      .from("tasks")
      .select("id, service_id")
      .eq("organization_id", orgId)
      .is("archived_at", null)
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

  // ── Executive metrics (SQL-backed) ──────────────────────────────────────
  const esc = orgId.replace(/'/g, "");

  const [trendRows, peopleRows, pipelineRows] = await Promise.all([
    // Delivery reliability — this month vs last month.
    runSql<{
      done_this: number;
      done_last: number;
      due_this: number;
      due_last: number;
      ontime_this: number;
      ontime_last: number;
    }>(
      `select
         count(*) filter (where date_trunc('month',completed_at)=date_trunc('month',now())) as done_this,
         count(*) filter (where date_trunc('month',completed_at)=date_trunc('month',now()-interval '1 month')) as done_last,
         count(*) filter (where date_trunc('month',completed_at)=date_trunc('month',now()) and due_date is not null) as due_this,
         count(*) filter (where date_trunc('month',completed_at)=date_trunc('month',now()-interval '1 month') and due_date is not null) as due_last,
         count(*) filter (where date_trunc('month',completed_at)=date_trunc('month',now()) and due_date is not null and actual_done_date is not null and actual_done_date<=due_date) as ontime_this,
         count(*) filter (where date_trunc('month',completed_at)=date_trunc('month',now()-interval '1 month') and due_date is not null and actual_done_date is not null and actual_done_date<=due_date) as ontime_last
       from tasks
       where stage='done' and archived_at is null and organization_id='${esc}'`,
    ),
    // Per-employee performance — last 30d throughput, on-time, load, prior 30d.
    runSql<{
      full_name: string;
      role: string | null;
      completed30: number;
      completed_prev30: number;
      withdue: number | null;
      ontime: number | null;
      avg_delay: number | null;
      open_load: number;
      overdue_load: number;
    }>(
      `with done30 as (
         select a.employee_id,
           count(*) total,
           count(*) filter (where t.due_date is not null) withdue,
           count(*) filter (where t.due_date is not null and t.actual_done_date is not null and t.actual_done_date<=t.due_date) ontime,
           round(avg(t.delay_days)::numeric,1) avg_delay,
           mode() within group (order by a.role_type) role
         from task_assignees a join tasks t on t.id=a.task_id
         where t.archived_at is null and t.stage='done' and t.completed_at>=now()-interval '30 days'
         group by 1
       ),
       prev30 as (
         select a.employee_id, count(*) total
         from task_assignees a join tasks t on t.id=a.task_id
         where t.archived_at is null and t.stage='done'
           and t.completed_at>=now()-interval '60 days' and t.completed_at<now()-interval '30 days'
         group by 1
       ),
       openload as (
         select a.employee_id,
           count(*) open_cnt,
           count(*) filter (where t.is_overdue) overdue_cnt
         from task_assignees a join tasks t on t.id=a.task_id
         where t.archived_at is null and t.stage<>'done'
         group by 1
       )
       select e.full_name,
         d.role as role,
         coalesce(d.total,0) as completed30,
         coalesce(p.total,0) as completed_prev30,
         d.withdue, d.ontime, d.avg_delay,
         coalesce(o.open_cnt,0) as open_load,
         coalesce(o.overdue_cnt,0) as overdue_load
       from employee_profiles e
       left join done30 d on d.employee_id=e.id
       left join prev30 p on p.employee_id=e.id
       left join openload o on o.employee_id=e.id
       where e.organization_id='${esc}'
         and (coalesce(d.total,0)>0 or coalesce(o.open_cnt,0)>0)
       order by coalesce(o.overdue_cnt,0) desc, coalesce(d.total,0) desc
       limit 30`,
    ),
    // Money & growth — contract renewals and sales-handover pipeline.
    runSql<{
      renewals_30d: number;
      renewals_60d: number;
      handovers_30d: number;
      handovers_prev30: number;
      handovers_pending: number;
    }>(
      `select
         (select count(*) from projects where organization_id='${esc}' and status='active' and end_date is not null and end_date between current_date and current_date+interval '30 days') as renewals_30d,
         (select count(*) from projects where organization_id='${esc}' and status='active' and end_date is not null and end_date > current_date+interval '30 days' and end_date <= current_date+interval '60 days') as renewals_60d,
         (select count(*) from sales_handover_forms where organization_id='${esc}' and created_at>=now()-interval '30 days') as handovers_30d,
         (select count(*) from sales_handover_forms where organization_id='${esc}' and created_at>=now()-interval '60 days' and created_at<now()-interval '30 days') as handovers_prev30,
         (select count(*) from sales_handover_forms where organization_id='${esc}' and status in ('submitted','in_review')) as handovers_pending`,
    ),
  ]);

  // Delivery trend — derive direction + on-time % server-side.
  const tr = trendRows[0];
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const deliveryTrend = tr
    ? (() => {
        const otThis = pct(tr.ontime_this, tr.due_this);
        const otLast = pct(tr.ontime_last, tr.due_last);
        const direction: "improving" | "stable" | "declining" =
          otThis - otLast >= 8
            ? "improving"
            : otLast - otThis >= 8
              ? "declining"
              : "stable";
        return {
          direction,
          onTimePctThisMonth: otThis,
          onTimePctLastMonth: otLast,
          completedThisMonth: Number(tr.done_this) || 0,
          completedLastMonth: Number(tr.done_last) || 0,
        };
      })()
    : null;

  // People performance — classify tier + trend server-side, model only narrates.
  const peoplePerformance = peopleRows.map((r) => {
    const completed30 = Number(r.completed30) || 0;
    const prev30 = Number(r.completed_prev30) || 0;
    const withdue = r.withdue == null ? 0 : Number(r.withdue);
    const ontime = r.ontime == null ? 0 : Number(r.ontime);
    const onTimePct = withdue > 0 ? Math.round((ontime / withdue) * 100) : null;
    const avgDelay = r.avg_delay == null ? null : Number(r.avg_delay);
    const openLoad = Number(r.open_load) || 0;
    const overdueLoad = Number(r.overdue_load) || 0;

    const trend: "improving" | "stable" | "declining" =
      prev30 > 0 && completed30 > prev30 * 1.2
        ? "improving"
        : prev30 > 0 && completed30 < prev30 * 0.7
          ? "declining"
          : "stable";

    const tier: "top" | "solid" | "at_risk" =
      (onTimePct != null && onTimePct < 60) ||
      overdueLoad >= 4 ||
      (avgDelay != null && avgDelay >= 3)
        ? "at_risk"
        : completed30 >= 4 &&
            (onTimePct == null || onTimePct >= 85) &&
            overdueLoad <= 1
          ? "top"
          : "solid";

    return {
      employeeName: r.full_name,
      role: r.role,
      tier,
      trend,
      completedLast30: completed30,
      onTimePct,
      avgDelayDays: avgDelay,
      openLoad,
      overdueLoad,
    };
  });
  // Surface the most decision-relevant people first: at-risk, then top.
  const tierRank = { at_risk: 0, top: 1, solid: 2 } as const;
  const peopleForModel = [...peoplePerformance]
    .sort(
      (a, b) =>
        tierRank[a.tier] - tierRank[b.tier] ||
        b.overdueLoad - a.overdueLoad ||
        b.openLoad - a.openLoad,
    )
    .slice(0, 8);

  const pl = pipelineRows[0];
  const moneyAndGrowth = pl
    ? {
        renewalsNext30d: Number(pl.renewals_30d) || 0,
        renewalsIn30to60d: Number(pl.renewals_60d) || 0,
        handoversLast30d: Number(pl.handovers_30d) || 0,
        handoversPrev30d: Number(pl.handovers_prev30) || 0,
        handoversPending: Number(pl.handovers_pending) || 0,
      }
    : null;

  // Client satisfaction (from imported WhatsApp chats analyzed by AI). Merge
  // satisfaction-derived at-risk clients into the at-risk list so the report's
  // clientsAtRisk + executive summary reflect relationship/churn signals.
  const [satAgg, satAtRisk] = await Promise.all([
    getOrgSatisfactionAggregate(orgId),
    getAtRiskClients(orgId),
  ]);
  const satClientRisk = satAtRisk.map((c) => ({
    clientName: c.clientName,
    projectCode: null,
    reasons: [
      c.satisfactionScore !== null ? `رضا ${c.satisfactionScore}/100` : "انطباع سلبي",
      ...(c.sentiment ? [`الانطباع: ${c.sentiment}`] : []),
      ...(c.topRisk ? [c.topRisk] : []),
    ],
    overdueSampleCodes: [] as string[],
  }));
  const mergedClientsAtRisk = [...clientsAtRisk, ...satClientRisk].slice(0, 8);

  const clientSatisfaction = {
    avgScore: satAgg.avgSatisfaction,
    avgBriefAdherence: satAgg.avgBriefAdherence,
    analyzedClients: satAgg.analyzedClients,
    atRiskCount: satAgg.atRiskClients,
    lowest: satAtRisk.slice(0, 5).map((c) => ({
      clientName: c.clientName,
      score: c.satisfactionScore,
      sentiment: c.sentiment,
      topRisk: c.topRisk,
    })),
  };

  const payloadForModel = {
    today,
    headline: {
      activeProjects: projects.length,
      openTasks: totalOpen,
      overdueTasks: totalOverdue,
      doneThisWeek: totalDoneWeek,
    },
    deliveryTrend,
    moneyAndGrowth,
    clientSatisfaction,
    peoplePerformance: peopleForModel,
    stageBottlenecks,
    serviceHealth,
    clientsAtRisk: mergedClientsAtRisk,
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
      prompt: `أنت رئيس أركان (Chief of Staff) للرئيس التنفيذي لوكالة تسويق سعودية تتبع منهجية Sky Light (8 مراحل، 4 أدوار).
مهمتك: تحويل الإشارات المحتسبة مسبقًا أدناه إلى **تقرير تنفيذي يساعد الشركة على التحسّن**.

قواعد صارمة:
- **لا تخترع أرقامًا** — استخدم الأرقام كما وردت تمامًا.
- استشهد بأكواد المهام/المشاريع الحقيقية الواردة في الإشارات.
- اللغة: عربية فصحى، أسلوب رئيس أركان يخاطب الرئيس التنفيذي — حاسم، موجز، موجّه للقرار. لا تشجيعي ولا تعميمي.
- لكل قسم، اكتب فقط البنود المستندة فعلاً للبيانات — اترك المصفوفة فارغة إن لم يوجد ما يستحق.

البيانات:
\`\`\`json
${JSON.stringify(payloadForModel)}
\`\`\`

تعليمات لكل قسم:
- **topPriorities** (الأهم — 3 إلى 5 بنود): انظر عبر كل العدسات (المال/العملاء، التسليم، الأفراد، النمو) واختر أهم ما يجب أن يعرفه الرئيس التنفيذي اليوم، مرتّبًا بالأثر على الأعمال. لكل بند: finding (الحقيقة الرقمية)، businessImpact (الأثر: مال/عميل/سمعة)، recommendedAction (من يتحرك وماذا يفعل). category وseverity إلزاميان.
- **deliveryTrend**: انسخ الأرقام كما هي من deliveryTrend في البيانات (direction, onTimePctThisMonth, onTimePctLastMonth, completedThisMonth, completedLastMonth) واكتب narrative من جملتين يشرح الاتجاه وسببه. إذا كان deliveryTrend في البيانات null، أعِد null.
- **peoplePerformance**: لكل موظف في القائمة، انسخ الحقول الرقمية وtier وtrend كما هي، واكتب assessment (تقييم واقعي مبني على الأرقام) وrecommendation (دعم، تخفيف حمل، أو تقدير للمتميزين). أبرز المتعثّرين (at_risk) والمحمّلين فوق طاقتهم والمتميزين بوضوح.
- **stageBottlenecks**: مراحل تتراكم فيها المهام >3 أيام — narrative يشرح الأثر التشغيلي.
- **clientsAtRisk**: الاقتراح إجراء ملموس. راعِ التجديدات القادمة في moneyAndGrowth، **وأدرج العملاء ذوي الرضا المنخفض أو الانطباع السلبي من clientSatisfaction.lowest** مع ذكر درجة الرضا وسبب الخطر، واقترح خطوة لإنقاذ العلاقة.
- استخدم **clientSatisfaction** (متوسط الرضا، الالتزام بالبريف، عدد العملاء المعرضين للفقد) في **executiveSummary** و**topPriorities** عند وجوده — تراجع الرضا أو الالتزام بالبريف أو ارتفاع عدد العملاء المعرضين للفقد إشارة عالية الأولوية.
- **serviceHealth**: note قصيرة تشخّص الفجوة لكل خدمة.
- **teamHotspots**: اقترح إعادة توزيع أو دعمًا محددًا.
- **quickWins**: إجراءات قابلة للتنفيذ هذا الأسبوع، كل واحدة مربوطة بأكواد مهام.
- **executiveSummary**: 3-4 جمل تلخّص حالة الشركة وأبرز ما يحتاج قرارًا.`,
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
