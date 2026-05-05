import {
  Sparkles, AlertTriangle, Clock, Activity,
  ShieldAlert, CheckCircle2, Inbox, CircleDot, ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth-server";
import { getActivityFeed } from "@/lib/data/dashboard";
import {
  getInsightSummary,
  getProjectHealth,
  getTeamLoad,
  getOverdueTasksList,
  getBlockedTasksList,
  getPendingHandovers,
} from "@/lib/data/ai-insights";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AI_EVENT_LABELS, PRIORITY_LABELS, URGENCY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { AiAnalysisPanel } from "./_components/ai-analysis-panel";

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(date: string) {
  return new Date(date).toLocaleDateString("ar-SA-u-nu-latn", { month: "short", day: "numeric" });
}

const HEALTH_TONE = {
  healthy: "bg-green-dim text-cc-green border-cc-green/20",
  at_risk: "bg-amber-dim text-amber border-amber/20",
  critical: "bg-red-dim text-cc-red border-cc-red/20",
} as const;
const HEALTH_LABEL = { healthy: "سليم", at_risk: "في خطر", critical: "حرج" } as const;

const LOAD_DOT = {
  low: "bg-cc-green",
  normal: "bg-cc-blue",
  high: "bg-amber",
  overloaded: "bg-cc-red",
} as const;
const LOAD_LABEL = { low: "خفيف", normal: "طبيعي", high: "مرتفع", overloaded: "مثقل" } as const;

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  HANDOVER_SUBMITTED: Inbox,
  PROJECT_CREATED: Sparkles,
  TASK_CREATED: CircleDot,
  TASK_STATUS_CHANGED: Activity,
  TASK_OVERDUE_DETECTED: AlertTriangle,
  EXCEPTION_OPENED: ShieldAlert,
};

// ── page ─────────────────────────────────────────────────────────────────────

export default async function AiInsightsPage() {
  const session = await requireSession();
  const orgId = session.orgId;

  const [summary, projects, team, overdue, blocked, handovers, feed] = await Promise.all([
    getInsightSummary(orgId),
    getProjectHealth(orgId),
    getTeamLoad(orgId),
    getOverdueTasksList(orgId, 8),
    getBlockedTasksList(orgId, 6),
    getPendingHandovers(orgId, 5),
    getActivityFeed(orgId, 15),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="الرؤى الذكية"
        description="تحليل Gemini المباشر لواقع المشاريع والفريق — يُحدَّث بطلب منك."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            مدعوم بـ Gemini
          </Badge>
        }
      />

      {/* ── summary metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="مشاريع نشطة"
          value={summary.activeProjects}
          icon={<Activity className="size-5" />}
          tone="default"
          href="/projects"
        />
        <MetricCard
          label="مهام مفتوحة"
          value={summary.openTasks}
          icon={<CircleDot className="size-5" />}
          tone="info"
          href="/tasks"
        />
        <MetricCard
          label="مهام متأخرة"
          value={summary.overdueTasks}
          icon={<Clock className="size-5" />}
          tone={summary.overdueTasks > 0 ? "destructive" : "success"}
          href="/tasks"
        />
        <MetricCard
          label="مهام متوقفة"
          value={summary.blockedTasks}
          icon={<ShieldAlert className="size-5" />}
          tone={summary.blockedTasks > 0 ? "warning" : "success"}
          href="/tasks"
        />
        <MetricCard
          label="منجزة هذا الأسبوع"
          value={summary.completedThisWeek}
          icon={<CheckCircle2 className="size-5" />}
          tone="success"
        />
        <MetricCard
          label="تسليمات معلقة"
          value={summary.pendingHandovers}
          icon={<Inbox className="size-5" />}
          tone={summary.pendingHandovers > 0 ? "warning" : "default"}
          href="/handover"
        />
      </div>

      {/* ── AI analysis — the main event ── */}
      <div>
        <SectionTitle
          title="التحليل الذكي"
          description="Gemini يقرأ بيانات الوكالة ويقدم رؤى وتوصيات حقيقية"
        />
        <AiAnalysisPanel />
      </div>

      {/* ── alerts row: overdue + blocked + handovers ── */}
      <div>
        <SectionTitle
          title="البيانات الحية — التنبيهات"
          description="قوائم تفصيلية مباشرة من قاعدة البيانات"
        />
        <div className="grid gap-4 lg:grid-cols-3">

          {/* overdue tasks */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <div className="flex size-7 items-center justify-center rounded-lg bg-red-dim text-cc-red">
                  <Clock className="size-3.5" />
                </div>
                المهام المتأخرة
                {overdue.length > 0 && (
                  <Badge className="mr-auto bg-cc-red/15 text-cc-red border-0 text-[10px]">
                    {summary.overdueTasks}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {overdue.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">لا توجد مهام متأخرة</p>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {overdue.map((t) => (
                    <li key={t.id} className="px-4 py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {t.projectName ?? "—"}{t.clientName ? ` · ${t.clientName}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-left" dir="ltr">
                        <span className="text-[10px] font-semibold text-cc-red tabular-nums">
                          -{t.daysOverdue}d
                        </span>
                        <p className="text-[9px] text-muted-foreground">{fmt(t.due_date)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="px-4 pb-3 pt-2">
                <Link href="/tasks" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  عرض كل المهام <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* blocked tasks */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <div className="flex size-7 items-center justify-center rounded-lg bg-amber-dim text-amber">
                  <ShieldAlert className="size-3.5" />
                </div>
                المهام المتوقفة
                {blocked.length > 0 && (
                  <Badge className="mr-auto bg-amber/15 text-amber border-0 text-[10px]">
                    {summary.blockedTasks}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {blocked.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">لا توجد مهام متوقفة</p>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {blocked.map((t) => (
                    <li key={t.id} className="px-4 py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{t.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {t.projectName ?? "—"}{t.clientName ? ` · ${t.clientName}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[9px] h-5 px-1.5">
                        {PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS] ?? t.priority}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div className="px-4 pb-3 pt-2">
                <Link href="/tasks" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  إدارة المهام <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* pending handovers */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <div className="flex size-7 items-center justify-center rounded-lg bg-blue-dim text-cc-blue">
                  <Inbox className="size-3.5" />
                </div>
                تسليمات المبيعات
                {handovers.length > 0 && (
                  <Badge className="mr-auto bg-cc-blue/15 text-cc-blue border-0 text-[10px]">
                    {summary.pendingHandovers}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {handovers.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">لا يوجد تسليمات معلقة</p>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {handovers.map((h) => (
                    <li key={h.id} className="px-4 py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{h.clientName}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{fmt(h.createdAt)}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[9px] h-5 px-1.5",
                          h.urgencyLevel === "critical" && "text-cc-red border-cc-red/30",
                          h.urgencyLevel === "high" && "text-amber border-amber/30",
                        )}
                      >
                        {URGENCY_LABELS[h.urgencyLevel as keyof typeof URGENCY_LABELS] ?? h.urgencyLevel}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div className="px-4 pb-3 pt-2">
                <Link href="/handover" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  مراجعة التسليمات <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ── project health ── */}
      <div>
        <SectionTitle
          title="صحة المشاريع"
          description="حالة كل مشروع نشط بناءً على نسبة الإنجاز والمهام المتأخرة"
        />
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-8 text-center text-sm text-muted-foreground">
            لا توجد مشاريع نشطة حاليًا
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="block group">
                <Card className="transition-all duration-200 group-hover:border-white/20">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {p.clientName ?? "بدون عميل"}
                        </p>
                      </div>
                      <span className={cn("shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border", HEALTH_TONE[p.healthScore])}>
                        {HEALTH_LABEL[p.healthScore]}
                      </span>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                        <span>الإنجاز</span>
                        <span className="tabular-nums">{p.completionPct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            p.healthScore === "healthy" && "bg-cc-green",
                            p.healthScore === "at_risk" && "bg-amber",
                            p.healthScore === "critical" && "bg-cc-red",
                          )}
                          style={{ width: `${p.completionPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CircleDot className="size-3" />
                        {p.totalTasks} مهمة
                      </span>
                      {p.overdueTasks > 0 && (
                        <span className="flex items-center gap-1 text-cc-red">
                          <Clock className="size-3" />
                          {p.overdueTasks} متأخرة
                        </span>
                      )}
                      {p.blockedTasks > 0 && (
                        <span className="flex items-center gap-1 text-amber">
                          <ShieldAlert className="size-3" />
                          {p.blockedTasks} متوقفة
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── team load ── */}
      <div>
        <SectionTitle title="حمل الفريق" description="توزيع المهام المفتوحة على أعضاء الفريق" />
        <Card>
          <CardContent className="p-0">
            {team.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">لا يوجد بيانات تعيين بعد</p>
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {team.slice(0, 10).map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={cn("size-2 rounded-full shrink-0", LOAD_DOT[m.loadLevel])} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {m.openTasks} مفتوحة · {m.doneTasks} منجزة
                        {m.overdueTasks > 0 && <span className="text-cc-red"> · {m.overdueTasks} متأخرة</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-20 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", LOAD_DOT[m.loadLevel])}
                          style={{ width: `${Math.min(100, (m.openTasks / 12) * 100)}%` }}
                        />
                      </div>
                      <span className={cn("text-[10px] font-medium", {
                        "text-cc-green": m.loadLevel === "low",
                        "text-cc-blue": m.loadLevel === "normal",
                        "text-amber": m.loadLevel === "high",
                        "text-cc-red": m.loadLevel === "overloaded",
                      })}>
                        {LOAD_LABEL[m.loadLevel]}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── activity feed ── */}
      <div>
        <SectionTitle title="آخر الأحداث" description="تيار الأحداث الذكية المسجَّلة" />
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-white/[0.04]">
              {feed.length === 0 ? (
                <li className="py-8 text-center text-sm text-muted-foreground">لا يوجد نشاط بعد</li>
              ) : (
                feed.map((a) => {
                  const Icon = EVENT_ICONS[a.event_type] ?? Sparkles;
                  const label = AI_EVENT_LABELS[a.event_type] ?? a.event_type;
                  const isHigh = a.importance === "high" || a.importance === "critical";
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={cn(
                        "flex size-8 items-center justify-center rounded-lg shrink-0",
                        isHigh ? "bg-cc-red/15 text-cc-red" : "bg-cyan-dim text-cyan",
                      )}>
                        <Icon className="size-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.entity_type ?? "—"} · {a.importance}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0" dir="ltr">
                        {new Date(a.created_at).toLocaleString("ar-SA-u-nu-latn", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
