"use client";

import { useState, useCallback } from "react";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Zap,
  Users,
  Layers,
  Activity,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  UserCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InsightsResult, StoredInsightRun } from "@/lib/ai-insights-schema";

const HEALTH_CONFIG = {
  excellent: { label: "ممتاز", cls: "bg-green-dim text-cc-green border-cc-green/20" },
  good: { label: "جيد", cls: "bg-blue-dim text-cc-blue border-cc-blue/20" },
  concerning: { label: "يحتاج انتباهًا", cls: "bg-amber-dim text-amber border-amber/20" },
  critical: { label: "حرج", cls: "bg-red-dim text-cc-red border-cc-red/20" },
} as const;

const STAGE_LABELS: Record<string, string> = {
  new: "جديدة",
  in_progress: "قيد التنفيذ",
  manager_review: "مراجعة المدير",
  specialist_review: "مراجعة المتخصص",
  ready_to_send: "جاهزة للإرسال",
  sent_to_client: "أُرسلت للعميل",
  client_changes: "تعديلات العميل",
  done: "مكتملة",
};

const ROLE_LABELS: Record<string, string> = {
  specialist: "متخصص",
  manager: "مدير",
  agent: "منفذ",
  account_manager: "مدير حساب",
  supporting_lead: "مساند رئيسي",
  supporting_agent: "مساند",
};

const SERVICE_LABELS: Record<string, string> = {
  social_media: "السوشيال ميديا",
  seo: "SEO",
  media_buying: "ميديا باينج",
  other: "أخرى",
};

const CATEGORY_LABELS: Record<string, string> = {
  money_clients: "المال والعملاء",
  delivery: "التسليم",
  people: "الأفراد",
  growth: "النمو",
};

const SEVERITY_CONFIG = {
  critical: { label: "حرج", cls: "border-cc-red/40 bg-cc-red/[0.04]", dot: "bg-cc-red" },
  high: { label: "عالٍ", cls: "border-amber/40 bg-amber/[0.04]", dot: "bg-amber" },
  medium: { label: "متوسط", cls: "border-soft", dot: "bg-cc-blue" },
} as const;

const TIER_CONFIG = {
  top: { label: "متميز", cls: "bg-green-dim text-cc-green border-cc-green/20" },
  solid: { label: "مستقر", cls: "bg-blue-dim text-cc-blue border-cc-blue/20" },
  at_risk: { label: "متعثّر", cls: "bg-red-dim text-cc-red border-cc-red/20" },
} as const;

const TREND_CONFIG = {
  improving: { label: "يتحسّن", icon: TrendingUp, cls: "text-cc-green" },
  stable: { label: "مستقر", icon: Minus, cls: "text-muted-foreground" },
  declining: { label: "يتراجع", icon: TrendingDown, cls: "text-cc-red" },
} as const;

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-white/[0.06]", className)} />;
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      </div>
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function CodePill({ code }: { code: string }) {
  return (
    <span className="inline-block rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground/80 ltr">
      {code}
    </span>
  );
}

export function AiAnalysisPanel({
  initialInsight = null,
}: {
  initialInsight?: StoredInsightRun | null;
}) {
  const [data, setData] = useState<InsightsResult | null>(initialInsight?.result ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    initialInsight?.completedAt ? new Date(initialInsight.completedAt) : null,
  );
  const [model, setModel] = useState<string | null>(initialInsight?.model ?? null);
  const [wasCached, setWasCached] = useState<boolean>(false);

  const fetchInsights = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = force ? "/api/insights?force=1" : "/api/insights";
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `خطأ ${res.status}`);
      }
      const json: { current: StoredInsightRun | null; cached?: boolean } =
        await res.json();
      setData(json.current?.result ?? null);
      setLastUpdated(
        json.current?.completedAt ? new Date(json.current.completedAt) : new Date(),
      );
      setModel(json.current?.model ?? null);
      setWasCached(!!json.cached);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل تحميل الرؤى");
    } finally {
      setLoading(false);
    }
  }, []);

  const health = data ? HEALTH_CONFIG[data.overallHealth] : null;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-dim text-cyan">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">تحليل العمليات</p>
            <p className="text-[11px] text-muted-foreground">
              {loading
                ? "يحلل البيانات…"
                : lastUpdated
                  ? `آخر تحديث: ${lastUpdated.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}`
                  : "لا يوجد تحليل محفوظ بعد"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {model && !loading && (
            <Badge variant="secondary" className="hidden sm:inline-flex text-[10px]">
              {model}
            </Badge>
          )}
          {health && !loading && (
            <span
              className={cn(
                "text-[11px] font-medium px-2.5 py-1 rounded-full border",
                health.cls,
              )}
            >
              {health.label}
            </span>
          )}
          {wasCached && !loading && data && (
            <span className="text-[10px] text-muted-foreground">من الذاكرة المؤقتة</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchInsights(false)}
            disabled={loading}
            className="gap-2 h-8 text-xs"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {loading ? "جارٍ التحليل…" : data ? "تحديث التحليل" : "تشغيل أول تحليل"}
          </Button>
          {data && !loading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchInsights(true)}
              disabled={loading}
              className="h-8 text-[11px] text-muted-foreground"
              title="تجاهل الذاكرة المؤقتة وتشغيل تحليل جديد"
            >
              تحديث إجباري
            </Button>
          )}
        </div>
      </div>

      {/* error */}
      {error && !loading && (
        <Card className="border-cc-red/30">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="size-4 text-cc-red shrink-0" />
            <div>
              <p className="text-sm font-medium text-cc-red">فشل التحليل</p>
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchInsights(false)}
              className="mr-auto text-xs h-7"
            >
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      )}

      {!data && !loading && !error && (
        <Card className="border-dashed border-soft">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-cyan-dim text-cyan">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">لا يوجد تحليل محفوظ بعد</p>
              <p className="text-xs text-muted-foreground">
                التحليل يستخدم البيانات الفعلية من رواسم — مراحل، خدمات، أكواد المهام.
              </p>
            </div>
            <Button
              onClick={() => fetchInsights(false)}
              disabled={loading}
              size="sm"
              className="gap-2"
            >
              <Sparkles className="size-4" />
              تشغيل أول تحليل
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && <AnalysisSkeleton />}

      {data && !loading && (
        <div className="space-y-8">
          {/* executive summary */}
          <Card className="border-cyan/20 bg-cyan/[0.03]">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="size-3.5 text-cyan" />
                <span className="text-xs font-semibold text-cyan uppercase tracking-wider">
                  الملخص التنفيذي
                </span>
              </div>
              <p className="text-sm leading-7 text-foreground/90">
                {data.executiveSummary}
              </p>
            </CardContent>
          </Card>

          {/* CEO agenda — the executive briefing, highest priority */}
          {data.topPriorities && data.topPriorities.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                icon={Target}
                title="أجندة الرئيس التنفيذي"
                hint={`${data.topPriorities.length} أولوية`}
              />
              <div className="space-y-2">
                {data.topPriorities.map((p, i) => {
                  const sev = SEVERITY_CONFIG[p.severity] ?? SEVERITY_CONFIG.medium;
                  return (
                    <Card key={i} className={cn("border", sev.cls)}>
                      <CardContent className="p-4 space-y-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("size-2 rounded-full shrink-0", sev.dot)} />
                          <p className="text-sm font-semibold flex-1">{p.title}</p>
                          <Badge variant="secondary" className="text-[10px]">
                            {CATEGORY_LABELS[p.category] ?? p.category}
                          </Badge>
                        </div>
                        <p className="text-xs text-foreground/85 leading-relaxed">
                          {p.finding}
                        </p>
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="size-3 text-amber shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {p.businessImpact}
                          </p>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <Zap className="size-3 text-cc-green shrink-0 mt-0.5" />
                          <p className="text-xs text-foreground/85 leading-relaxed">
                            {p.recommendedAction}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* delivery reliability trend */}
          {data.deliveryTrend && (
            <div className="space-y-3">
              <SectionHeader icon={Activity} title="موثوقية التسليم" hint="هذا الشهر مقابل السابق" />
              {(() => {
                const t = data.deliveryTrend!;
                const tr = TREND_CONFIG[t.direction];
                const TrendIcon = tr.icon;
                return (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <TrendIcon className={cn("size-4", tr.cls)} />
                          <span className={cn("text-sm font-semibold", tr.cls)}>
                            {tr.label}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-lg font-bold tabular-nums">
                            {t.onTimePctThisMonth}%
                          </span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            التزام بالموعد (السابق {t.onTimePctLastMonth}%)
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          أُنجز {t.completedThisMonth} مهمة (السابق {t.completedLastMonth})
                        </span>
                      </div>
                      <p className="text-xs text-foreground/85 leading-relaxed">
                        {t.narrative}
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
          )}

          {/* clients at risk — most urgent so it comes first */}
          {data.clientsAtRisk.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                icon={ShieldAlert}
                title="عملاء في منطقة الخطر"
                hint={`${data.clientsAtRisk.length} عميل`}
              />
              <div className="space-y-2">
                {data.clientsAtRisk.map((c, i) => (
                  <Card key={i} className="border-cc-red/25">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{c.clientName}</p>
                        {c.projectCode ? <CodePill code={c.projectCode} /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {c.reason}
                      </p>
                      <div className="flex items-start gap-1.5 pt-1">
                        <Zap className="size-3 text-amber shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground/85">{c.suggestedAction}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* stage bottlenecks */}
          {data.stageBottlenecks.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                icon={Layers}
                title="اختناقات المراحل"
                hint="مهام عالقة في مرحلة واحدة"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {data.stageBottlenecks.map((b, i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">
                          {STAGE_LABELS[b.stage] ?? b.stage}
                        </p>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {b.count} مهمة · أقدمها {b.oldestDays} يوم
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {b.narrative}
                      </p>
                      {b.sampleTaskCodes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {b.sampleTaskCodes.map((code) => (
                            <CodePill key={code} code={code} />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* service health */}
          {data.serviceHealth.length > 0 && (
            <div className="space-y-3">
              <SectionHeader icon={Activity} title="صحة الخدمات" />
              <div className="grid gap-3 sm:grid-cols-3">
                {data.serviceHealth.map((s, i) => {
                  const tone =
                    s.onTimePct >= 80
                      ? "border-cc-green/25"
                      : s.onTimePct >= 60
                        ? "border-amber/25"
                        : "border-cc-red/25";
                  const pctTone =
                    s.onTimePct >= 80
                      ? "text-cc-green"
                      : s.onTimePct >= 60
                        ? "text-amber"
                        : "text-cc-red";
                  return (
                    <Card key={i} className={cn("border", tone)}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            {SERVICE_LABELS[s.service] ?? s.service}
                          </p>
                          <span className={cn("text-sm font-bold tabular-nums", pctTone)}>
                            {s.onTimePct}%
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {s.openCount} مفتوحة · {s.overdueCount} متأخرة
                        </p>
                        <p className="text-xs text-foreground/85 leading-relaxed">
                          {s.note}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* team hotspots */}
          {data.teamHotspots.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                icon={Users}
                title="نقاط ضغط الفريق"
                hint="الصمت = صحي"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {data.teamHotspots.map((t, i) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{t.employeeName}</p>
                        <Badge variant="secondary" className="text-[10px]">
                          {ROLE_LABELS[t.role] ?? t.role}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {t.openCount} مفتوحة · {t.overdueCount} متأخرة
                      </p>
                      <p className="text-xs text-foreground/85 leading-relaxed">
                        {t.recommendation}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* people performance */}
          {data.peoplePerformance && data.peoplePerformance.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                icon={UserCheck}
                title="أداء الفريق"
                hint={`${data.peoplePerformance.length} موظف`}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {data.peoplePerformance.map((p, i) => {
                  const tier = TIER_CONFIG[p.tier] ?? TIER_CONFIG.solid;
                  const tr = TREND_CONFIG[p.trend];
                  const TrendIcon = tr.icon;
                  return (
                    <Card
                      key={i}
                      className={cn(
                        "border",
                        p.tier === "at_risk"
                          ? "border-cc-red/25"
                          : p.tier === "top"
                            ? "border-cc-green/25"
                            : "border-soft",
                      )}
                    >
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{p.employeeName}</p>
                          <div className="flex items-center gap-1.5">
                            {p.role ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {ROLE_LABELS[p.role] ?? p.role}
                              </Badge>
                            ) : null}
                            <span
                              className={cn(
                                "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                                tier.cls,
                              )}
                            >
                              {tier.label}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground tabular-nums">
                          <span>أنجز {p.completedLast30} (30 يوم)</span>
                          {p.onTimePct != null && <span>· التزام {p.onTimePct}%</span>}
                          {p.avgDelayDays != null && (
                            <span>· متوسط تأخير {p.avgDelayDays} يوم</span>
                          )}
                          <span>· {p.openLoad} مفتوحة</span>
                          {p.overdueLoad > 0 && (
                            <span className="text-cc-red">· {p.overdueLoad} متأخرة</span>
                          )}
                          <span className={cn("flex items-center gap-0.5", tr.cls)}>
                            <TrendIcon className="size-3" />
                            {tr.label}
                          </span>
                        </div>
                        <p className="text-xs text-foreground/85 leading-relaxed">
                          {p.assessment}
                        </p>
                        <div className="flex items-start gap-1.5 pt-0.5">
                          <Zap className="size-3 text-amber shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {p.recommendation}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* quick wins */}
          {data.quickWins.length > 0 && (
            <div className="space-y-3">
              <SectionHeader
                icon={Zap}
                title="مكاسب سريعة"
                hint="قابلة للتنفيذ هذا الأسبوع"
              />
              <div className="space-y-2">
                {data.quickWins.map((q, i) => (
                  <Card key={i} className="border-cc-green/25">
                    <CardContent className="p-4 space-y-2">
                      <p className="text-sm font-semibold">{q.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {q.description}
                      </p>
                      {q.taskCodes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {q.taskCodes.map((code) => (
                            <CodePill key={code} code={code} />
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] text-cc-green flex items-center gap-1 pt-1">
                        <Zap className="size-3" />
                        {q.expectedImpact}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* fully-quiet state — schema ran but found nothing actionable */}
          {(data.topPriorities?.length ?? 0) === 0 &&
            !data.deliveryTrend &&
            (data.peoplePerformance?.length ?? 0) === 0 &&
            data.clientsAtRisk.length === 0 &&
            data.stageBottlenecks.length === 0 &&
            data.serviceHealth.length === 0 &&
            data.teamHotspots.length === 0 &&
            data.quickWins.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <Clock className="size-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">لا توجد إشارات تستدعي تدخلًا الآن</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    التشغيل يبدو ضمن النطاق الطبيعي. أعد التحليل لاحقًا.
                  </p>
                </CardContent>
              </Card>
            )}
        </div>
      )}
    </div>
  );
}
