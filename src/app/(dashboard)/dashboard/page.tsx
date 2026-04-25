import Link from "next/link";
import {
  Briefcase, CheckCircle2, AlertTriangle, Bell, Users, Target, Sparkles,
  Inbox, ArrowUpLeft, Clock,
} from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import {
  getDashboardStats, getRecentHandovers, getOverdueTasks, getActivityFeed,
} from "@/lib/data/dashboard";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  HandoverStatusBadge, UrgencyBadge, PriorityBadge, TaskStatusBadge,
} from "@/components/status-badges";
import { formatArabicShortDate, relativeTimeAr } from "@/lib/utils-format";
import { AI_EVENT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await requireSession();
  const [stats, handovers, overdue, activity] = await Promise.all([
    getDashboardStats(session.orgId, session.userId),
    getRecentHandovers(session.orgId, 5),
    getOverdueTasks(session.orgId, 6),
    getActivityFeed(session.orgId, 12),
  ]);

  return (
    <div>
      <PageHeader
        title={`مرحبًا، ${session.fullName}`}
        description="ملخص حي للأنشطة في الوكالة. الأرقام محدّثة وفقًا لقاعدة البيانات الآن."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        <MetricCard
          label="عملاء نشطون"
          value={stats.activeClients}
          icon={<Users className="size-5" />}
          tone="default"
          href="/clients"
        />
        <MetricCard
          label="مشاريع جارية"
          value={stats.activeProjects}
          icon={<Briefcase className="size-5" />}
          tone="info"
          href="/projects"
        />
        <MetricCard
          label="مهام مفتوحة"
          value={stats.openTasks}
          icon={<CheckCircle2 className="size-5" />}
          tone="success"
          href="/tasks?filter=open"
        />
        <MetricCard
          label="مهام متأخرة"
          value={stats.overdueTasks}
          hint={stats.overdueTasks > 0 ? "تحتاج متابعة عاجلة" : undefined}
          icon={<AlertTriangle className="size-5" />}
          tone={stats.overdueTasks > 0 ? "destructive" : "default"}
          href="/tasks?filter=overdue"
        />
        <MetricCard
          label="تسليمات جديدة"
          value={stats.newHandovers}
          icon={<Inbox className="size-5" />}
          tone="warning"
          href="/handover"
        />
        <MetricCard
          label="مهام مكتملة هذا الأسبوع"
          value={stats.completedThisWeek}
          icon={<Target className="size-5" />}
          tone="success"
        />
        <MetricCard
          label="تنبيهات لم تُقرأ"
          value={stats.unreadNotifications}
          icon={<Bell className="size-5" />}
          tone="purple"
          href="/notifications"
        />
        <MetricCard
          label="أحداث ذكية اليوم"
          value={stats.aiEventsToday}
          icon={<Sparkles className="size-5" />}
          tone="default"
          href="/ai-insights"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <div>
          <SectionTitle
            title="آخر التسليمات"
            description="نماذج التسليم الواردة مؤخرًا من فريق المبيعات"
            actions={
              <Link href="/handover" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
                <ArrowUpLeft className="size-3 icon-flip-rtl" />
                عرض الكل
              </Link>
            }
          />
          {handovers.length === 0 ? (
            <EmptyState
              variant="compact"
              title="لا توجد تسليمات"
              description="أرسل أول تسليم من صفحة المبيعات."
            />
          ) : (
            <div className="space-y-2">
              {handovers.map((h) => {
                const project = Array.isArray(h.project) ? h.project[0] : h.project;
                return (
                  <Card key={h.id}>
                    <CardContent className="p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold truncate">{h.client_name}</span>
                            <HandoverStatusBadge status={h.status} />
                            <UrgencyBadge level={h.urgency_level} />
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {relativeTimeAr(h.created_at)}
                            {project?.id && (
                              <>
                                {" · "}
                                <Link href={`/projects/${project.id}`} className="text-cyan hover:underline">
                                  المشروع
                                </Link>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <SectionTitle
            title="مهام متأخرة"
            description="تجاوزت تاريخ التسليم وهي مفتوحة"
            actions={
              <Link href="/tasks?filter=overdue" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
                <ArrowUpLeft className="size-3 icon-flip-rtl" />
                عرض الكل
              </Link>
            }
          />
          {overdue.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<CheckCircle2 className="size-6" />}
              title="لا توجد مهام متأخرة"
              description="كل المهام في وقتها — استمر في الزخم!"
            />
          ) : (
            <div className="space-y-2">
              {overdue.map((t) => {
                const project = Array.isArray(t.project) ? t.project[0] : t.project;
                return (
                  <Card key={t.id} className="border-cc-red/20">
                    <CardContent className="p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/tasks/${t.id}`} className="text-sm font-medium hover:text-cyan transition-colors">
                            {t.title}
                          </Link>
                          <p className="mt-1 text-[11px] text-muted-foreground truncate">
                            {project?.name ?? "—"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <PriorityBadge priority={t.priority} />
                          <span className="text-[10px] text-cc-red tabular-nums" dir="ltr">
                            {formatArabicShortDate(t.due_date)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <SectionTitle
        title="نشاط الفريق"
        description="مجمَّع من الأحداث الذكية المسجَّلة في النظام"
        actions={
          <Link href="/ai-insights" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            الرؤى الذكية
          </Link>
        }
      />
      {activity.length === 0 ? (
        <EmptyState
          variant="compact"
          title="لا يوجد نشاط بعد"
          description="مع بدء استخدام النظام ستتراكم الأحداث هنا."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-white/[0.04]">
              {activity.map((a) => {
                const label = AI_EVENT_LABELS[a.event_type] ?? a.event_type;
                const isHigh = a.importance === "high" || a.importance === "critical";
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        "flex size-8 items-center justify-center rounded-lg shrink-0",
                        isHigh ? "bg-cc-red/15 text-cc-red" : "bg-cyan-dim text-cyan",
                      )}>
                        <Sparkles className="size-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.entity_type ?? "—"}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {relativeTimeAr(a.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
