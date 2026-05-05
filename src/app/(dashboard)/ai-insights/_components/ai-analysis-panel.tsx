"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Sparkles, RefreshCw, AlertTriangle, Lightbulb,
  TrendingUp, TrendingDown, Minus, ShieldAlert, Clock,
  CheckCircle2, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InsightsResult } from "@/app/api/insights/route";

// ── tone maps ────────────────────────────────────────────────────────────────

const ALERT_STYLE = {
  critical: {
    border: "border-cc-red/30",
    icon: "bg-red-dim text-cc-red",
    badge: "bg-cc-red/15 text-cc-red border-0",
    label: "حرج",
    Icon: ShieldAlert,
  },
  warning: {
    border: "border-amber/30",
    icon: "bg-amber-dim text-amber",
    badge: "bg-amber/15 text-amber border-0",
    label: "تحذير",
    Icon: AlertTriangle,
  },
  info: {
    border: "border-cc-blue/30",
    icon: "bg-blue-dim text-cc-blue",
    badge: "bg-cc-blue/15 text-cc-blue border-0",
    label: "معلومة",
    Icon: Sparkles,
  },
} as const;

const PRIORITY_STYLE = {
  urgent: {
    dot: "bg-cc-red",
    label: "عاجل",
    text: "text-cc-red",
  },
  important: {
    dot: "bg-amber",
    label: "مهم",
    text: "text-amber",
  },
  suggestion: {
    dot: "bg-cc-blue",
    label: "اقتراح",
    text: "text-cc-blue",
  },
} as const;

const PATTERN_ICON = {
  positive: { Icon: TrendingUp, cls: "text-cc-green bg-green-dim" },
  negative: { Icon: TrendingDown, cls: "text-cc-red bg-red-dim" },
  neutral: { Icon: Minus, cls: "text-muted-foreground bg-white/[0.06]" },
} as const;

const HEALTH_CONFIG = {
  excellent: { label: "ممتاز", cls: "bg-green-dim text-cc-green border-cc-green/20" },
  good: { label: "جيد", cls: "bg-blue-dim text-cc-blue border-cc-blue/20" },
  concerning: { label: "يحتاج انتباهًا", cls: "bg-amber-dim text-amber border-amber/20" },
  critical: { label: "حرج", cls: "bg-red-dim text-cc-red border-cc-red/20" },
} as const;

// ── skeleton ─────────────────────────────────────────────────────────────────

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
          <Skeleton className="h-3 w-4/6" />
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

// ── main component ────────────────────────────────────────────────────────────

export function AiAnalysisPanel() {
  const [data, setData] = useState<InsightsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `خطأ ${res.status}`);
      }
      const json: InsightsResult = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل تحميل الرؤى");
    } finally {
      setLoading(false);
    }
  }, []);

  // auto-fetch on mount
  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const health = data ? HEALTH_CONFIG[data.overallHealth] : null;

  return (
    <div className="space-y-6">
      {/* header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-dim text-cyan">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">تحليل Gemini</p>
            <p className="text-[11px] text-muted-foreground">
              {loading
                ? "يحلل البيانات…"
                : lastUpdated
                  ? `آخر تحديث: ${lastUpdated.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}`
                  : "لم يتم التحليل بعد"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {health && !loading && (
            <span className={cn("text-[11px] font-medium px-2.5 py-1 rounded-full border", health.cls)}>
              {health.label}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchInsights}
            disabled={loading}
            className="gap-2 h-8 text-xs"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {loading ? "جارٍ التحليل…" : "تحديث التحليل"}
          </Button>
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
            <Button variant="ghost" size="sm" onClick={fetchInsights} className="mr-auto text-xs h-7">
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      )}

      {/* skeleton */}
      {loading && <AnalysisSkeleton />}

      {/* results */}
      {data && !loading && (
        <div className="space-y-8">

          {/* executive summary */}
          <Card className="border-cyan/20 bg-cyan/[0.03]">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="size-3.5 text-cyan" />
                <span className="text-xs font-semibold text-cyan uppercase tracking-wider">الملخص التنفيذي</span>
              </div>
              <p className="text-sm leading-7 text-foreground/90">{data.executiveSummary}</p>
            </CardContent>
          </Card>

          {/* alerts */}
          {data.alerts.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                التنبيهات والمخاطر
              </p>
              <div className="space-y-2">
                {data.alerts.map((alert, i) => {
                  const s = ALERT_STYLE[alert.level];
                  return (
                    <Card key={i} className={cn("border", s.border)}>
                      <CardContent className="p-4 flex gap-3 items-start">
                        <div className={cn("flex size-8 items-center justify-center rounded-lg shrink-0 mt-0.5", s.icon)}>
                          <s.Icon className="size-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-semibold">{alert.title}</p>
                            <Badge className={cn("text-[10px] h-4 px-1.5", s.badge)}>
                              {s.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{alert.body}</p>
                          {alert.action && (
                            <div className="flex items-center gap-1 mt-2">
                              <ChevronRight className="size-3 text-muted-foreground" />
                              <p className="text-xs text-foreground/70">{alert.action}</p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* recommendations */}
          {data.recommendations.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                التوصيات
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.recommendations.map((rec, i) => {
                  const s = PRIORITY_STYLE[rec.priority];
                  return (
                    <Card key={i}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className={cn("size-2 rounded-full shrink-0", s.dot)} />
                          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", s.text)}>
                            {s.label}
                          </span>
                        </div>
                        <p className="text-sm font-semibold">{rec.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{rec.body}</p>
                        {rec.estimatedImpact && (
                          <p className="text-[11px] text-cc-green flex items-center gap-1 mt-1">
                            <TrendingUp className="size-3" />
                            {rec.estimatedImpact}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* patterns + team insights side by side */}
          <div className="grid gap-4 lg:grid-cols-2">

            {data.patterns.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  الأنماط المكتشفة
                </p>
                <div className="space-y-2">
                  {data.patterns.map((p, i) => {
                    const s = PATTERN_ICON[p.type];
                    return (
                      <Card key={i}>
                        <CardContent className="p-4 flex gap-3 items-start">
                          <div className={cn("flex size-7 items-center justify-center rounded-lg shrink-0 mt-0.5", s.cls)}>
                            <s.Icon className="size-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{p.title}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{p.body}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {data.teamInsights.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  رؤى الفريق
                </p>
                <div className="space-y-2">
                  {data.teamInsights.map((t, i) => (
                    <Card key={i}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex gap-2 items-start">
                          <div className="flex size-7 items-center justify-center rounded-lg bg-purple-dim text-cc-purple shrink-0 mt-0.5">
                            <Lightbulb className="size-3.5" />
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{t.observation}</p>
                        </div>
                        {t.recommendation && (
                          <div className="flex items-start gap-1.5 pr-9">
                            <CheckCircle2 className="size-3 text-cc-green shrink-0 mt-0.5" />
                            <p className="text-xs text-foreground/80">{t.recommendation}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* empty — never fetched */}
      {!data && !loading && !error && (
        <Card className="border-dashed border-white/10">
          <CardContent className="py-10 text-center">
            <Clock className="size-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">اضغط "تحديث التحليل" لبدء التحليل الذكي</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
