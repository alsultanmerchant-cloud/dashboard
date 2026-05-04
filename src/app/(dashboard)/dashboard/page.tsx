import Link from "next/link";
import {
  CheckCircle2, AlertTriangle, Sparkles,
  ArrowUpLeft, Clock, RefreshCw, ShieldAlert, FileSignature, Wallet,
  Activity, Timer, ListChecks, TrendingUp,
} from "lucide-react";
import { countRenewalsThisMonth } from "@/lib/data/renewals";
import { getCeoCommercialTiles } from "@/lib/data/contracts";
import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  getRecentHandovers, getActivityFeed,
} from "@/lib/data/dashboard";
import {
  getDashboardOdooMetrics, getOdooGovernanceViolations,
} from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  HandoverStatusBadge, UrgencyBadge, PriorityBadge,
} from "@/components/status-badges";
import { formatArabicShortDate, relativeTimeAr } from "@/lib/utils-format";
import { AI_EVENT_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(n);

// Sky Light executive view: 4 hero KPIs answer "what matters today"
// (revenue, operational risk, control health, churn signal). Below are
// commercial mix + 3 watch-lists for the CEO/admin/head to act on.
export default async function DashboardPage() {
  const session = await requireSession();
  const [
    odooMetrics, governance, handovers, activity, renewalsThisMonth,
    openExceptionsRaw, commercialTiles,
  ] = await Promise.all([
    getDashboardOdooMetrics().catch(() => ({
      overdueCount: 0, reworkCount: 0, reviewBacklog: 0, closedThisWeek: 0,
      onTimePct: null, onTimeSample: 0, onTimeHits: 0,
      overdueTasks: [], totalProjects: 0, totalActiveProjects: 0, totalClients: 0,
    })),
    getOdooGovernanceViolations().catch(() => ({
      violations: [],
      countsByKind: {
        unowned_task: 0, missing_deadline: 0,
        stuck_in_review: 0, overdue_no_progress: 0,
      },
      total: 0,
    })),
    getRecentHandovers(session.orgId, 4),
    getActivityFeed(session.orgId, 8),
    countRenewalsThisMonth(session.orgId),
    supabaseAdmin
      .from("exceptions")
      .select("kind")
      .eq("organization_id", session.orgId)
      .is("resolved_at", null),
    getCeoCommercialTiles(session.orgId).catch(() => ({
      month: "", byType: {} as Record<string, { count: number; value: number }>,
      totalCount: 0, totalValue: 0,
    })),
  ]);
  const openGovernanceCount = governance.total;

  const openExceptions = openExceptionsRaw.data ?? [];
  const exceptionsByKind: Record<string, number> = {
    client: 0, deadline: 0, quality: 0, resource: 0,
  };
  for (const r of openExceptions) {
    exceptionsByKind[r.kind as string] = (exceptionsByKind[r.kind as string] ?? 0) + 1;
  }
  const totalOpenExceptions = openExceptions.length;

  return (
    <div>
      <PageHeader
        title={`مرحبًا، ${session.fullName}`}
        description="ملخص تنفيذي للوكالة. أربع مؤشرات رئيسية ثم ما يحتاج تدخّلًا الآن."
      />

      {/* Hero KPIs — the four that drive action */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard
          label="إيرادات هذا الشهر"
          value={sar(commercialTiles.totalValue)}
          hint={`${commercialTiles.totalCount} عقد`}
          icon={<Wallet className="size-5" />}
          tone="success"
          href="/contracts"
        />
        <MetricCard
          label="مهام متأخرة"
          value={odooMetrics.overdueCount}
          hint={odooMetrics.overdueCount > 0 ? "تحتاج متابعة عاجلة" : "لا تأخيرات"}
          icon={<AlertTriangle className="size-5" />}
          tone={odooMetrics.overdueCount > 0 ? "destructive" : "default"}
          href="/tasks?filter=overdue"
        />
        <MetricCard
          label="مخالفات حوكمة"
          value={openGovernanceCount}
          hint={openGovernanceCount > 0 ? "افتح اللوحة" : "كل القواعد تُحترَم"}
          icon={<ShieldAlert className="size-5" />}
          tone={openGovernanceCount > 0 ? "destructive" : "default"}
          href="/governance"
        />
        <MetricCard
          label="تجديدات هذا الشهر"
          value={renewalsThisMonth}
          hint={renewalsThisMonth > 0 ? "تجديد قريب" : "لا تجديدات"}
          icon={<RefreshCw className="size-5" />}
          tone={renewalsThisMonth > 0 ? "warning" : "default"}
          href="/projects?filter=renewals_this_month"
        />
      </div>

      {/* T9 KPI tiles — operational pulse (rework / on-time / productivity / review backlog) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <MetricCard
          label="إعادة عمل (Client Changes)"
          value={odooMetrics.reworkCount}
          hint={odooMetrics.reworkCount > 0 ? "في مرحلة تعديلات العميل" : "لا إعادة عمل"}
          icon={<Activity className="size-5" />}
          tone={odooMetrics.reworkCount > 0 ? "warning" : "default"}
          href="/tasks"
        />
        <MetricCard
          label="التسليم في الموعد"
          value={odooMetrics.onTimePct === null ? "—" : `${odooMetrics.onTimePct}%`}
          hint={odooMetrics.onTimeSample === 0 ? "لا عيّنة بعد" : `آخر 30 يومًا · ${odooMetrics.onTimeSample}`}
          icon={<Timer className="size-5" />}
          tone={odooMetrics.onTimePct === null
            ? "default"
            : odooMetrics.onTimePct >= 85
              ? "success"
              : odooMetrics.onTimePct >= 70
                ? "warning"
                : "destructive"}
          href="/tasks"
        />
        <MetricCard
          label="إنتاجية الأسبوع"
          value={odooMetrics.closedThisWeek}
          hint="مهام أُغلقت هذا الأسبوع"
          icon={<TrendingUp className="size-5" />}
          tone={odooMetrics.closedThisWeek > 0 ? "info" : "default"}
          href="/tasks"
        />
        <MetricCard
          label="عُلوق المراجعة"
          value={odooMetrics.reviewBacklog}
          hint={odooMetrics.reviewBacklog > 0 ? "في انتظار مراجعة المدير/المتخصص" : "لا تأخّر"}
          icon={<ListChecks className="size-5" />}
          tone={odooMetrics.reviewBacklog > 0 ? "destructive" : "default"}
          href="/tasks"
        />
      </div>

      {/* Commercial mix — revenue breakdown by movement type */}
      <Card className="mb-6 border-cyan/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="text-sm font-semibold inline-flex items-center gap-2">
                <FileSignature className="size-4 text-cyan" />
                تركيبة الإيرادات هذا الشهر
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                توزيع العقود حسب نوع الحركة (جديد · تجديد · رفع باقة · استرجاع · تعليق).
              </p>
            </div>
            <Link href="/contracts" className="text-xs text-cyan hover:underline">
              فتح صفحة العقود
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
            {(["New","Renew","UPSELL","WinBack","Hold"] as const).map((k) => {
              const agg = commercialTiles.byType[k] ?? { count: 0, value: 0 };
              const labels: Record<string, string> = {
                New: "جديد", Renew: "تجديد", UPSELL: "رفع باقة",
                WinBack: "استرجاع", Hold: "تعليق",
              };
              return (
                <div key={k} className="rounded-lg border border-border p-2.5">
                  <p className="text-[11px] text-muted-foreground">{labels[k]}</p>
                  <p className="text-base font-semibold tabular-nums">{agg.count}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {sar(agg.value)}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Three watch-lists — what needs attention right now */}
      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        {/* 1. Open escalations + exceptions */}
        <div>
          <SectionTitle
            title="استثناءات وتصعيدات"
            description={totalOpenExceptions > 0
              ? `${totalOpenExceptions} مفتوحة الآن`
              : "لا استثناءات مفتوحة"}
            actions={
              <Link href="/escalations" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
                <ArrowUpLeft className="size-3 icon-flip-rtl" />
                صندوق الوارد
              </Link>
            }
          />
          {totalOpenExceptions === 0 ? (
            <EmptyState
              variant="compact"
              icon={<ShieldAlert className="size-6" />}
              title="لا تصعيدات الآن"
              description="السجل نظيف — حافظ على هذا الأداء."
            />
          ) : (
            <Card>
              <CardContent className="p-3.5 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">عميل · {exceptionsByKind.client}</Badge>
                  <Badge variant="outline">موعد · {exceptionsByKind.deadline}</Badge>
                  <Badge variant="outline">جودة · {exceptionsByKind.quality}</Badge>
                  <Badge variant="outline">موارد · {exceptionsByKind.resource}</Badge>
                </div>
                <Link
                  href="/escalations"
                  className="block text-xs text-cyan hover:underline pt-1"
                >
                  عرض القائمة الكاملة →
                </Link>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 2. Overdue tasks */}
        <div>
          <SectionTitle
            title="مهام متأخرة"
            description={odooMetrics.overdueCount > 0
              ? `${odooMetrics.overdueCount} تجاوزت موعد التسليم`
              : "كل المهام في وقتها"}
            actions={
              <Link href="/tasks?filter=overdue" className="text-xs text-cyan hover:underline inline-flex items-center gap-1">
                <ArrowUpLeft className="size-3 icon-flip-rtl" />
                عرض الكل
              </Link>
            }
          />
          {odooMetrics.overdueTasks.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<CheckCircle2 className="size-6" />}
              title="لا تأخيرات"
              description="كل المهام في وقتها."
            />
          ) : (
            <div className="space-y-2">
              {odooMetrics.overdueTasks.map((t) => (
                <Card key={t.odooId} className="border-cc-red/20">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/tasks/odoo/${t.odooId}`}
                          className="text-sm font-medium hover:text-cyan transition-colors line-clamp-1"
                        >
                          {t.name}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                          {t.projectName ?? "—"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <PriorityBadge priority={t.priority} />
                        <span className="text-[10px] text-cc-red tabular-nums" dir="ltr">
                          {formatArabicShortDate(t.deadline)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 3. Recent handovers */}
        <div>
          <SectionTitle
            title="آخر التسليمات"
            description={handovers.length > 0
              ? `${handovers.length} وردت مؤخرًا`
              : "لا تسليمات جديدة"}
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
              title="لا تسليمات"
              description="أرسل أول تسليم من صفحة المبيعات."
            />
          ) : (
            <div className="space-y-2">
              {handovers.map((h) => {
                const project = Array.isArray(h.project) ? h.project[0] : h.project;
                return (
                  <Card key={h.id}>
                    <CardContent className="p-3">
                      <div className="min-w-0">
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
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Activity feed — the chronological record of system events */}
      <SectionTitle
        title="نشاط الفريق"
        description="مجمَّع من الأحداث الذكية المسجَّلة"
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
