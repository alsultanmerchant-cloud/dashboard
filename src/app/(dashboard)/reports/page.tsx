import Link from "next/link";
import {
  Activity, AlertTriangle, BarChart3, ListChecks, Sparkles,
  Timer, TrendingUp, Users,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getDepartmentSlaCompliance,
  getReworkHeatmapByService,
  getAgentLeaderboard,
  getRenewalForecast90d,
  getOnTimePct,
  getReviewBacklog,
  getLatestStoredDigest,
} from "@/lib/data/reports";
import { SummarizeWeekButton } from "./summarize-week-button";

export const dynamic = "force-dynamic";

function pctTone(pct: number | null): "success" | "warning" | "destructive" | "default" {
  if (pct === null) return "default";
  if (pct >= 85) return "success";
  if (pct >= 70) return "warning";
  return "destructive";
}

export default async function ReportsPage() {
  const session = await requirePagePermission("reports.view");
  const [
    sla, heatmap, leaderboard, renewals, onTime, backlog, latestDigest,
  ] = await Promise.all([
    getDepartmentSlaCompliance(session.orgId),
    getReworkHeatmapByService(session.orgId),
    getAgentLeaderboard(session.orgId, 4),
    getRenewalForecast90d(session.orgId),
    getOnTimePct(session.orgId, 30),
    getReviewBacklog(session.orgId),
    getLatestStoredDigest(session.orgId),
  ]);

  const maxRework = Math.max(1, ...heatmap.map((h) => h.rework_count));
  const maxLb = Math.max(1, ...leaderboard.map((l) => l.closed_count));

  return (
    <div>
      <PageHeader
        title="التقارير"
        description="مؤشّرات أداء الوكالة لهذا الأسبوع، موزّعة على الأقسام والخدمات والأفراد."
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            مرحلة 9 — موجز ذكي
          </Badge>
        }
      />

      {/* AI summary affordance + headline KPIs */}
      <Card className="mb-6 border-cyan/20">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Sparkles className="size-4 text-cyan" />
              موجز الأسبوع التنفيذي
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              نموذج Gemini مُغذَّى بالتقارير الأربعة فقط — لا يخمّن خارجها.
            </p>
          </div>
          <SummarizeWeekButton />
        </CardContent>
      </Card>

      <SectionTitle title="مؤشرات الأسبوع" description="نسبة التسليم في الموعد، المتراكم في المراجعة، والإجمالي" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <MetricCard
          label="التسليم في الموعد"
          value={onTime.pct === null ? "—" : `${onTime.pct}%`}
          hint={onTime.sample === 0 ? "لا عيّنة بعد" : `عيّنة ${onTime.sample}`}
          icon={<Timer className="size-5" />}
          tone={pctTone(onTime.pct)}
        />
        <MetricCard
          label="عُلوق المراجعة"
          value={backlog.length}
          hint={backlog.length === 0 ? "لا تأخّر" : "أكثر من يومَي عمل"}
          icon={<AlertTriangle className="size-5" />}
          tone={backlog.length > 0 ? "destructive" : "default"}
        />
        <MetricCard
          label="إعادة العمل (إجمالي تعليقات)"
          value={heatmap.reduce((s, h) => s + h.rework_count, 0)}
          hint={`${heatmap.length} خدمة`}
          icon={<Activity className="size-5" />}
          tone={heatmap.length > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="تجديدات قادمة (90 يومًا)"
          value={renewals.length}
          hint={renewals[0]?.client_name ? `أقرب: ${renewals[0].client_name}` : "لا تجديدات"}
          icon={<TrendingUp className="size-5" />}
          tone={renewals.length > 0 ? "info" : "default"}
        />
      </div>

      {/* Per-department SLA compliance */}
      <SectionTitle
        title="التزام SLA حسب القسم"
        description="نسبة المهام المفتوحة التي ما زالت داخل حدود الزمن المسموح لمرحلتها"
      />
      {sla.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center mb-8">
          لا توجد مهام نشطة بقواعد SLA مطبَّقة.
        </p>
      ) : (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3">
            {sla.map((d) => (
              <div key={d.department_id ?? "_none"}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium">{d.department_name}</span>
                  <span className="text-sm font-bold tabular-nums">
                    {d.pct === null ? "—" : `${d.pct}%`}
                    <span className="text-xs text-muted-foreground mr-1.5"> / {d.total} مهمة</span>
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-l from-cc-green to-cyan"
                    style={{ width: `${d.pct ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rework heat-map by service */}
      <SectionTitle
        title="إعادة العمل حسب الخدمة"
        description="حرارة التعليقات أثناء مرحلة Client Changes — يكشف الخدمات الأكثر إرهاقًا"
      />
      {heatmap.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center mb-8">
          لا تعليقات إعادة عمل مسجَّلة بعد.
        </p>
      ) : (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3">
            {heatmap.map((h) => {
              const pct = (h.rework_count / maxRework) * 100;
              return (
                <div key={h.service_id ?? "_none"}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{h.service_name}</span>
                    <span className="text-sm font-bold tabular-nums">{h.rework_count}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-amber to-cc-red"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Agent leaderboard */}
      <SectionTitle
        title="لوحة الأفراد — آخر 4 أسابيع"
        description="عدد المهام المُغلقة + استخدام نسبيّ (من الأعلى إنتاجًا = 100%)"
        actions={<Users className="size-4 text-muted-foreground" />}
      />
      {leaderboard.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center mb-8">
          لا بيانات إنتاج بعد.
        </p>
      ) : (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3">
            {leaderboard.slice(0, 10).map((row) => {
              const pct = (row.closed_count / maxLb) * 100;
              return (
                <div key={row.user_id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{row.full_name}</span>
                    <span className="text-sm tabular-nums">
                      <span className="font-bold">{row.closed_count}</span>
                      <span className="text-xs text-muted-foreground mr-1.5"> · {row.utilization_pct}%</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-cyan to-cc-purple"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Renewal forecast */}
      <SectionTitle
        title="توقّع التجديدات — التسعون يومًا القادمة"
        description="مرتَّبة بحسب الأقرب موعدًا"
        actions={
          <Link href="/projects?filter=renewals_this_month" className="text-xs text-cyan hover:underline">
            فتح المشاريع
          </Link>
        }
      />
      {renewals.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center mb-8">
          لا تجديدات في الأفق.
        </p>
      ) : (
        <Card className="mb-8">
          <CardContent className="p-0">
            <ul className="divide-y divide-white/[0.04]">
              {renewals.slice(0, 12).map((r) => (
                <li key={r.project_id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${r.project_id}`}
                      className="text-sm font-medium hover:text-cyan transition-colors truncate"
                    >
                      {r.project_name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      {r.client_name}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs tabular-nums" dir="ltr">
                      {r.next_renewal_date}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      بعد {r.days_until} يومًا
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Weekly digest */}
      <SectionTitle
        title="موجز الأسبوع المخزَّن"
        description={
          latestDigest
            ? `أُنشئ في ${new Date(latestDigest.generated_at).toLocaleString("ar-SA")}`
            : "لم يُنشأ موجز أسبوعي بعد — يصدر تلقائيًا صباح الأحد"
        }
        actions={<ListChecks className="size-4 text-muted-foreground" />}
      />
      {latestDigest ? (
        <Card className="mb-8">
          <CardContent className="p-5 space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground">تسليم في الموعد</p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.on_time.pct === null ? "—" : `${latestDigest.payload.on_time.pct}%`}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground">إغلاقات الأسبوع</p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.productivity.closed_this_week}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground">عُلوق المراجعة</p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.review_backlog.count}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-muted-foreground">تجديدات 90 يومًا</p>
                <p className="text-base font-semibold tabular-nums">
                  {latestDigest.payload.renewals_next_90d.count}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              يصل هذا الموجز إلى صندوق التنبيهات داخل التطبيق فقط — البريد و WhatsApp مؤجَّلان للمرحلة T8.
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center mb-8">
          سيظهر هنا فور تشغيل أوّل دورة من weekly-digest.
        </p>
      )}

      <div className="mt-4 rounded-2xl border border-cyan/20 bg-cyan-dim/20 p-5 flex items-start gap-3">
        <BarChart3 className="size-5 text-cyan shrink-0 mt-0.5" />
        <div className="text-sm text-foreground/90 leading-relaxed">
          هذه التقارير تُحسب من قواعد بيانات حيّة (4 Postgres views) عند كل فتح للصفحة. لإصدار الموجز الأسبوعي يدويًا، شغِّل دالة weekly-digest من لوحة Supabase.
        </div>
      </div>
    </div>
  );
}
