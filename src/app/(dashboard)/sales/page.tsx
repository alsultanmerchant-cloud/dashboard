import Link from "next/link";
import {
  UserSearch, TrendingUp, Target, CircleCheck, Clock, ChevronLeft,
} from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getPipelineSummary } from "@/lib/data/leads";
import {
  LEAD_STATUSES, LEAD_STATUS_LABEL,
} from "@/lib/data/lead-statuses";
import type { LeadStatus } from "@/lib/data/lead-statuses";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { formatArabicShortDate, relativeTimeAr } from "@/lib/utils-format";
import { NewLeadDialog } from "./new-lead-dialog";

const sar = (n: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(n);

const stageBarColor: Record<LeadStatus, string> = {
  new: "bg-cyan/60",
  contacted: "bg-cc-blue/60",
  qualified: "bg-cc-purple/60",
  proposal: "bg-amber/60",
  won: "bg-cc-green/60",
  lost: "bg-cc-red/60",
};

export default async function SalesPage() {
  const session = await requirePagePermission("sales.view");
  const canManage = hasPermission(session, "sales.manage");

  const summary = await getPipelineSummary(session.orgId);

  const maxStageCount = Math.max(
    ...LEAD_STATUSES.map((s) => summary.byStatus[s].count),
    1,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="مسار المبيعات"
        description="إدارة العملاء المحتملين عبر مراحل البيع: جديد · تواصل · مؤهَّل · عرض · إغلاق."
        actions={canManage ? <NewLeadDialog /> : undefined}
      />

      {/* Headline KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="عملاء محتملون مفتوحون"
          value={summary.totalOpenCount}
          hint={summary.totalOpenCount > 0 ? "في مسار البيع" : "لا أحد في المسار"}
          icon={<UserSearch className="size-5" />}
          tone="default"
        />
        <MetricCard
          label="قيمة المسار"
          value={sar(summary.totalOpenValue)}
          hint="القيمة التقديرية"
          icon={<Target className="size-5" />}
          tone="info"
        />
        <MetricCard
          label="إيرادات مكسوبة"
          value={sar(summary.wonValue)}
          hint={`${summary.byStatus.won.count} صفقة`}
          icon={<CircleCheck className="size-5" />}
          tone="success"
        />
        <MetricCard
          label="نسبة التحويل"
          value={summary.conversionRate === null ? "—" : `${summary.conversionRate}%`}
          hint={
            summary.conversionRate === null
              ? "لا صفقات مغلقة بعد"
              : `${summary.byStatus.won.count} ربح / ${summary.byStatus.lost.count} خسارة`
          }
          icon={<TrendingUp className="size-5" />}
          tone={
            summary.conversionRate === null
              ? "default"
              : summary.conversionRate >= 50
                ? "success"
                : summary.conversionRate >= 25
                  ? "warning"
                  : "destructive"
          }
        />
      </div>

      {/* Pipeline by stage */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-4 text-sm font-semibold">توزيع المسار حسب المرحلة</p>
          {summary.totalCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد عملاء محتملون بعد. أضف أول واحد من أعلى الصفحة.
            </p>
          ) : (
            <div className="space-y-2">
              {LEAD_STATUSES.map((s) => {
                const cell = summary.byStatus[s];
                const pct = (cell.count / maxStageCount) * 100;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-xs">
                      {LEAD_STATUS_LABEL[s]}
                    </div>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                      <div
                        className={`absolute inset-y-0 right-0 ${stageBarColor[s]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                      {cell.count}
                    </div>
                    <div className="w-24 shrink-0 text-end text-[11px] tabular-nums text-muted-foreground">
                      {sar(cell.value)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent leads */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">آخر العملاء المحتملين</h2>
          <Link
            href="/sales/leads"
            className="text-xs text-cyan hover:underline"
          >
            عرض الكل ←
          </Link>
        </div>
        {summary.recentLeads.length === 0 ? (
          <EmptyState
            icon={<UserSearch className="size-6" />}
            title="لا توجد عملاء محتملون"
            description="ابدأ بإضافة أول عميل محتمل إلى مسار البيع."
            action={canManage ? <NewLeadDialog /> : undefined}
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-white/[0.04]">
                {summary.recentLeads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/sales/leads`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5">
                            {LEAD_STATUS_LABEL[l.status]}
                          </span>
                          {l.source && <span>· {l.source}</span>}
                          {l.assigned_to?.full_name && (
                            <span>· {l.assigned_to.full_name}</span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" />
                            {relativeTimeAr(l.created_at)}
                          </span>
                          {l.next_step_at && (
                            <span dir="ltr" className="tabular-nums">
                              · {formatArabicShortDate(l.next_step_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {l.estimated_value > 0 && (
                          <span className="text-sm font-semibold tabular-nums">
                            {sar(l.estimated_value)}
                          </span>
                        )}
                        <ChevronLeft className="size-4 text-muted-foreground icon-flip-rtl" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
