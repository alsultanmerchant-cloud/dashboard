import {
  Heart, Clock, CalendarCheck, Plane, AlertTriangle, User,
} from "lucide-react";
import { requireSession, hasPermission } from "@/lib/auth-server";
import {
  listLeaves, getLeavesSummary,
} from "@/lib/data/leaves";
import {
  LEAVE_TYPES, LEAVE_TYPE_LABEL,
  LEAVE_STATUS_LABEL, LEAVE_STATUS_BADGE,
} from "@/lib/data/leave-types";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";
import { formatArabicShortDate, relativeTimeAr } from "@/lib/utils-format";
import { cn } from "@/lib/utils";
import { RequestLeaveDialog } from "./request-leave-dialog";
import { DecideLeaveButtons } from "./decide-leave-buttons";

export default async function HrPage() {
  const session = await requireSession();
  const canView = hasPermission(session, "hr.view");
  const canManage = hasPermission(session, "hr.manage");

  // Even employees without hr.view see their own requests via RLS
  const [summary, recent, mine] = await Promise.all([
    canView
      ? getLeavesSummary(session.orgId)
      : Promise.resolve(null),
    canView
      ? listLeaves(session.orgId, { limit: 20 })
      : Promise.resolve([]),
    listLeaves(session.orgId, { userId: session.userId, limit: 10 }),
  ]);

  const maxByType = summary
    ? Math.max(...LEAVE_TYPES.map((t) => summary.byType[t].days), 1)
    : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الموارد البشرية"
        description="إدارة طلبات الإجازات والموافقات. كل موظف يقدّم طلبه ويرى حالته هنا."
        actions={<RequestLeaveDialog />}
      />

      {canView && summary ? (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="طلبات قيد المراجعة"
              value={summary.pendingCount}
              hint={summary.pendingCount > 0 ? "تحتاج قراراً" : "لا طلبات معلّقة"}
              icon={<Clock className="size-5" />}
              tone={summary.pendingCount > 0 ? "warning" : "default"}
            />
            <MetricCard
              label="معتمدة هذا الشهر (أيام)"
              value={summary.daysOffThisMonth}
              icon={<CalendarCheck className="size-5" />}
              tone="info"
            />
            <MetricCard
              label="في إجازة اليوم"
              value={summary.onLeaveToday.length}
              hint={summary.onLeaveToday.length > 0 ? "عددهم خارج الدوام" : "كل الفريق حاضر"}
              icon={<Plane className="size-5" />}
              tone={summary.onLeaveToday.length > 0 ? "warning" : "success"}
            />
            <MetricCard
              label="إجمالي الطلبات"
              value={summary.totalCount}
              hint={`${summary.approvedCount} معتمدة`}
              icon={<Heart className="size-5" />}
              tone="default"
            />
          </div>

          {/* On leave today */}
          {summary.onLeaveToday.length > 0 && (
            <Card className="border-amber/30 bg-amber-dim/30">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber">
                  <Plane className="size-4" />
                  في إجازة اليوم ({summary.onLeaveToday.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.onLeaveToday.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center gap-2 rounded-full border border-amber/30 bg-card/80 px-3 py-1.5"
                    >
                      <Avatar size="sm">
                        <AvatarFallback>
                          {(l.employee_name ?? "?")[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="text-xs">
                        <p className="font-medium">{l.employee_name ?? "موظف"}</p>
                        <p className="text-muted-foreground">
                          {LEAVE_TYPE_LABEL[l.leave_type]} ·{" "}
                          <span dir="ltr" className="tabular-nums">
                            {l.start_date} → {l.end_date}
                          </span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Leaves by type */}
          <Card>
            <CardContent className="p-4">
              <p className="mb-4 text-sm font-semibold">توزيع الإجازات حسب النوع</p>
              {summary.totalCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  لا توجد طلبات إجازات بعد.
                </p>
              ) : (
                <div className="space-y-2">
                  {LEAVE_TYPES.map((t) => {
                    const cell = summary.byType[t];
                    if (cell.count === 0) return null;
                    const pct = (cell.days / maxByType) * 100;
                    return (
                      <div key={t} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 text-xs">
                          {LEAVE_TYPE_LABEL[t]}
                        </div>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                          <div
                            className="absolute inset-y-0 right-0 bg-cc-purple/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="w-16 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                          {cell.count} طلب
                        </div>
                        <div className="w-20 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                          {cell.days} يوم
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* All recent requests */}
          <div>
            <h2 className="mb-3 text-base font-semibold">آخر الطلبات</h2>
            {recent.length === 0 ? (
              <EmptyState
                icon={<Heart className="size-6" />}
                title="لا توجد طلبات"
                description="ستظهر الطلبات هنا فور تقديمها."
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y divide-white/[0.04]">
                    {recent.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Avatar size="sm">
                              <AvatarFallback>
                                {(l.employee_name ?? "?")[0]}
                              </AvatarFallback>
                            </Avatar>
                            <p className="text-sm font-medium truncate">
                              {l.employee_name ?? "موظف"}
                            </p>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                LEAVE_STATUS_BADGE[l.status],
                              )}
                            >
                              {LEAVE_STATUS_LABEL[l.status]}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{LEAVE_TYPE_LABEL[l.leave_type]}</span>
                            <span dir="ltr" className="tabular-nums">
                              · {l.start_date} → {l.end_date}
                            </span>
                            <span>· {l.days} يوم</span>
                            <span>· {relativeTimeAr(l.created_at)}</span>
                          </div>
                          {l.reason && (
                            <p className="mt-1 text-xs text-muted-foreground truncate">
                              {l.reason}
                            </p>
                          )}
                        </div>
                        {canManage && l.status === "pending" && (
                          <DecideLeaveButtons leaveId={l.id} />
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Non-manager view: own requests only */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <User className="size-4" />
              طلباتي
            </h2>
            {mine.length === 0 ? (
              <EmptyState
                icon={<Heart className="size-6" />}
                title="لا توجد طلبات سابقة"
                description="ابدأ بإرسال أول طلب إجازة."
                action={<RequestLeaveDialog />}
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y divide-white/[0.04]">
                    {mine.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">
                              {LEAVE_TYPE_LABEL[l.leave_type]}
                            </p>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                LEAVE_STATUS_BADGE[l.status],
                              )}
                            >
                              {LEAVE_STATUS_LABEL[l.status]}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span dir="ltr" className="tabular-nums">
                              {l.start_date} → {l.end_date}
                            </span>
                            <span>· {l.days} يوم</span>
                            <span>· {relativeTimeAr(l.created_at)}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
