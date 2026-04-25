"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDeals, fetchTickets, fetchProjects, fetchKpiSnapshots } from "@/lib/supabase/db";
import { useAuth } from "@/lib/auth-context";
import type { Deal, Ticket, Project, KPISnapshot } from "@/types";
import { StatCard } from "@/components/ui/stat-card";
import { DonutChart } from "@/components/ui/donut-chart";
import { LineChart } from "@/components/ui/line-chart";
import { ColorBadge } from "@/components/ui/color-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useTopbarControls } from "@/components/layout/topbar-context";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { AlertCircle, ArrowUpLeft, Ticket as TicketIcon, TrendingUp, DollarSign, Users, Heart, FolderOpen } from "lucide-react";

const STAGE_COLORS: Record<string, string> = {
  "تواصل": "#10B981",
  "تفاوض": "#8B5CF6",
  "تجهيز": "#00D4FF",
  "انتظار الدفع": "#F59E0B",
  "مكتملة": "#10B981",
};

const STAGE_BADGE: Record<string, "cyan" | "green" | "amber" | "red" | "purple"> = {
  "تواصل": "green",
  "تفاوض": "purple",
  "تجهيز": "cyan",
  "انتظار الدفع": "amber",
  "مكتملة": "green",
};

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export default function DashboardPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kpiSnapshots, setKpiSnapshots] = useState<KPISnapshot[]>([]);
  const [errors, setErrors] = useState<Record<"deals" | "tickets" | "projects" | "kpis", string | null>>({
    deals: null,
    tickets: null,
    projects: null,
    kpis: null,
  });
  const { activeOrgId: orgId } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const { setControls } = useTopbarControls();

  const loadDashboardData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    const results = await Promise.allSettled([
      fetchDeals(),
      fetchTickets(),
      fetchProjects(),
      fetchKpiSnapshots(),
    ]);

    const [dealsResult, ticketsResult, projectsResult, kpisResult] = results;

    if (dealsResult.status === "fulfilled") {
      setDeals(dealsResult.value);
    }
    if (ticketsResult.status === "fulfilled") {
      setTickets(ticketsResult.value);
    }
    if (projectsResult.status === "fulfilled") {
      setProjects(projectsResult.value);
    }
    if (kpisResult.status === "fulfilled") {
      setKpiSnapshots(kpisResult.value);
    }

    setErrors({
      deals: dealsResult.status === "rejected" ? "تعذر تحميل الصفقات" : null,
      tickets: ticketsResult.status === "rejected" ? "تعذر تحميل بيانات التذاكر" : null,
      projects: projectsResult.status === "rejected" ? "تعذر تحميل المشاريع" : null,
      kpis: kpisResult.status === "rejected" ? "تعذر تحميل مؤشرات الإيرادات" : null,
    });

    if (results.some((result) => result.status === "fulfilled")) {
      setLastUpdatedAt(new Date().toISOString());
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, [orgId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadDashboardData();
    });
  }, [loadDashboardData]);

  useEffect(() => {
    setControls({
      onRefresh: () => loadDashboardData({ silent: true }),
      isRefreshing,
      lastUpdatedAt,
    });

    return () => {
      setControls({});
    };
  }, [isRefreshing, lastUpdatedAt, loadDashboardData, setControls]);

  const openTickets = tickets.filter((t) => t.status === "مفتوح").length;
  const periodDeals = deals.length;
  const periodRevenue = deals.reduce((s, d) => s + d.deal_value, 0);
  const activeProjects = projects.length;
  const conversionRate = periodDeals > 0 ? Math.round((deals.filter((d) => d.stage === "مكتملة").length / periodDeals) * 100) : 0;
  const urgentProjects = projects.filter((project) => project.status_tag === "متأخر").length;
  const latestDeal = deals[0] ?? null;

  // Stage distribution for donut
  const stageCounts = deals.reduce(
    (acc, d) => {
      acc[d.stage] = (acc[d.stage] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const donutSegments = Object.entries(stageCounts).map(([label, value]) => ({
    label,
    value,
    color: STAGE_COLORS[label] || "#64748b",
  }));

  const lineData = kpiSnapshots.map((k) => ({
    label: (MONTH_NAMES[k.month - 1] ?? String(k.month)).slice(0, 3),
    value: k.total_revenue,
    target: k.target_revenue || 0,
  }));

  const retryAll = () => void loadDashboardData({ silent: true });

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-4">
        <div className="glass-surface relative overflow-hidden rounded-[20px] sm:rounded-[30px] p-4 sm:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(106,226,255,0.16),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(159,140,255,0.14),transparent_26%)]" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan/15 bg-cyan-dim px-3 py-1 text-[11px] font-semibold text-cyan">
                Overview Signal
              </span>
              <span className="rounded-full border border-white/6 bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground">
                القرار السريع يبدأ من هنا
              </span>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
              <div>
                <p className="text-sm text-muted-foreground">صورة تنفيذية للفترة الحالية</p>
                {isLoading ? (
                  <div className="mt-4 space-y-3">
                    <Skeleton className="h-12 w-56" />
                    <Skeleton className="h-4 w-full max-w-md" />
                    <Skeleton className="h-4 w-72" />
                  </div>
                ) : (
                  <>
                    <h1 className="mt-3 text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground md:text-5xl">
                      {formatMoney(periodRevenue)}
                    </h1>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                      {latestDeal
                        ? `آخر صفقة مؤثرة جاءت من ${latestDeal.client_name} بقيمة ${formatMoney(latestDeal.deal_value)}. معدل الإغلاق الحالي ${conversionRate}% مع ${openTickets} تذكرة مفتوحة تحتاج متابعة.`
                        : "ابدأ من هذه اللوحة لبناء قراءة تشغيلية مركزة على الصفقات، الدعم، والمشاريع الجارية."}
                    </p>
                  </>
                )}
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button className="gap-1.5">
                    <ArrowUpLeft className="h-4 w-4" />
                    راقب الاتجاهات
                  </Button>
                  <Button variant="outline">مراجعة المشاريع</Button>
                </div>
              </div>

              <div className="grid gap-3">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <HeroMiniSkeleton key={index} />
                  ))
                ) : (
                  <>
                    <HeroMiniCard
                      label="صفقات نشطة"
                      value={String(periodDeals)}
                      helper={errors.deals ?? "إجمالي ما تم سحبه من النظام"}
                    />
                    <HeroMiniCard
                      label="مشاريع متأخرة"
                      value={String(urgentProjects)}
                      helper={errors.projects ?? "حالات تتطلب رفع أولوية التنفيذ"}
                    />
                    <HeroMiniCard
                      label="تذاكر مفتوحة"
                      value={String(openTickets)}
                      helper={errors.tickets ?? "المسار الأسرع لتحسين الاستجابة"}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
          ) : (
            <>
              <StatCard
                value={String(periodDeals)}
                label="صفقات الفترة"
                color="cyan"
                icon={<TrendingUp className="w-4 h-4 text-cyan" />}
                subtext={errors.deals ?? "نشاط البيع الجاري"}
              />
              <StatCard
                value={String(openTickets)}
                label="تذاكر مفتوحة"
                color="green"
                icon={<TicketIcon className="w-4 h-4 text-cc-green" />}
                subtext={errors.tickets ?? "حالة الدعم الحالية"}
              />
              <StatCard
                value="84%"
                label="رضا العملاء"
                color="green"
                progress={84}
                icon={<Heart className="w-4 h-4 text-cc-green" />}
                subtext="CSAT 4.2/5"
              />
              <StatCard
                value="72%"
                label="حمل الفريق"
                color="purple"
                progress={72}
                icon={<Users className="w-4 h-4 text-cc-purple" />}
                subtext="متوسط التحميل"
              />
            </>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              value={formatMoney(periodRevenue)}
              label="إيرادات الفترة"
              color="cyan"
              icon={<DollarSign className="w-4 h-4 text-cyan" />}
              subtext={errors.deals ?? "المحصلة الحالية للفترة"}
            />
            <StatCard
              value={`${conversionRate}%`}
              label="معدل الإغلاق"
              color="amber"
              progress={conversionRate}
              icon={<ArrowUpLeft className="w-4 h-4 text-amber" />}
              subtext="من إجمالي الصفقات"
            />
            <StatCard
              value={String(activeProjects)}
              label="مشاريع الفترة"
              color="purple"
              icon={<FolderOpen className="w-4 h-4 text-cc-purple" />}
              subtext={errors.projects ?? "الأعمال الجارية الآن"}
            />
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deal Stages Donut */}
        <div className="glass-surface rounded-[28px] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-foreground">مراحل الصفقات</h3>
              <p className="mt-1 text-xs text-muted-foreground">كيف يتوزع النشاط البيعي الآن</p>
            </div>
            {!isLoading && (
              <ColorBadge text={`${periodDeals} صفقة`} color="cyan" size="md" />
            )}
          </div>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="mx-auto h-40 w-40 rounded-full" />
              <div className="flex justify-center gap-2">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
          ) : errors.deals ? (
            <ErrorState message={errors.deals} onRetry={retryAll} />
          ) : donutSegments.length > 0 ? (
            <DonutChart
              segments={donutSegments}
              centerValue={String(periodDeals)}
              centerLabel="صفقة"
            />
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              لا توجد صفقات بعد
            </div>
          )}
        </div>

        {/* Revenue Growth Line */}
        <div className="glass-surface rounded-[28px] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-foreground">نمو الإيرادات</h3>
              <p className="mt-1 text-xs text-muted-foreground">المنحنى الشهري مقابل المستهدف</p>
            </div>
            {!isLoading && <ColorBadge text="Revenue Pulse" color="purple" size="md" />}
          </div>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-40 w-full rounded-xl" />
              <div className="grid grid-cols-4 gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ) : errors.kpis ? (
            <ErrorState message={errors.kpis} onRetry={retryAll} />
          ) : lineData.length > 0 ? (
            <LineChart data={lineData} showArea />
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              لا توجد بيانات شهرية بعد
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Active Projects */}
        <div className="glass-surface rounded-[28px] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-foreground">مشاريع قيد التنفيذ</h3>
              <p className="mt-1 text-xs text-muted-foreground">أكثر الأعمال التي تحتاج متابعة قريبة</p>
            </div>
            {!isLoading && <ColorBadge text={`${activeProjects} مشروع`} color="green" size="md" />}
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-1.5 flex-1 rounded-full" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                </div>
              ))}
            </div>
          ) : errors.projects ? (
            <ErrorState message={errors.projects} onRetry={retryAll} compact />
          ) : projects.length > 0 ? (
            <div className="space-y-3">
              {projects.map((project, index) => (
                <div
                  key={project.id}
                  className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-foreground truncate">{project.name}</p>
                      <ColorBadge
                        text={project.status_tag || ""}
                        color={
                          project.status_tag === "متأخر"
                            ? "red"
                            : project.status_tag === "يكتمل قريباً"
                            ? "amber"
                            : "green"
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-cyan transition-all"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{project.progress}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
              لا توجد مشاريع بعد
            </div>
          )}
        </div>

        {/* Recent Deals */}
        <div className="glass-surface rounded-[28px] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-foreground">أحدث الصفقات</h3>
              <p className="mt-1 text-xs text-muted-foreground">آخر حركة دخلت إلى خط المبيعات</p>
            </div>
            {!isLoading && latestDeal && <ColorBadge text={latestDeal.stage} color={STAGE_BADGE[latestDeal.stage] || "blue"} size="md" />}
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between py-1.5">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : errors.deals ? (
            <ErrorState message={errors.deals} onRetry={retryAll} compact />
          ) : deals.length > 0 ? (
            <div className="space-y-3">
              {deals.slice(0, 4).map((deal, index) => (
                <div
                  key={deal.id}
                  className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{deal.client_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {deal.assigned_rep_name} • {deal.deal_date ? formatDate(deal.deal_date) : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-cyan">{formatMoney(deal.deal_value)}</span>
                    <ColorBadge text={deal.stage} color={STAGE_BADGE[deal.stage] || "blue"} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
              لا توجد صفقات بعد
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroMiniCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/6 bg-white/[0.04] px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-foreground">{value}</p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">{helper}</p>
    </div>
  );
}

function HeroMiniSkeleton() {
  return (
    <div className="rounded-[22px] border border-white/6 bg-white/[0.04] px-4 py-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-8 w-14" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="glass-surface rounded-[24px] p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-10 w-10 rounded-2xl" />
      </div>
      <div className="mt-4">
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center ${
        compact ? "h-24" : "h-40"
      }`}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-cc-red" />
        <span>{message}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        إعادة المحاولة
      </Button>
    </div>
  );
}
