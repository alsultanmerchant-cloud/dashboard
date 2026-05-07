"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { recalculateProjectDatesAction } from "../_link_actions";
import {
  GanttSettings, withDefaults, type GanttPrefs,
} from "./gantt-settings";

const WEEKDAY_TO_JS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

type DepType = "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";

export type GanttTask = {
  id: string;
  title: string;
  task_code: string | null;
  stage: string;
  start_date: string | null;
  planned_date: string | null;
};

export type GanttLink = {
  id: string;
  source_task_id: string;
  target_task_id: string;
  dependency_type: DepType;
  lag_days: number;
};

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 44;
const LEFT_PANEL = 260;
const STAGE_COLORS: Record<string, string> = {
  new: "#94a3b8",
  in_progress: "#3b82f6",
  manager_review: "#f59e0b",
  specialist_review: "#a855f7",
  ready_to_send: "#10b981",
  sent_to_client: "#06b6d4",
  client_changes: "#ef4444",
  done: "#22c55e",
};

export function ProjectGantt({
  projectId,
  tasks,
  links,
  canManage,
  initialPrefs,
}: {
  projectId: string;
  tasks: GanttTask[];
  links: GanttLink[];
  canManage: boolean;
  initialPrefs: GanttPrefs;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pxPerDay, setPxPerDay] = useState(20);
  const prefs = withDefaults(initialPrefs);
  const weekendJsDays = useMemo(
    () =>
      new Set(
        prefs.weekend_days
          .map((d) => WEEKDAY_TO_JS[d])
          .filter((v) => v !== undefined),
      ),
    [prefs.weekend_days],
  );

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const av = a.start_date ?? a.planned_date;
      const bv = b.start_date ?? b.planned_date;
      if (av && bv) return av.localeCompare(bv);
      if (av) return -1;
      if (bv) return 1;
      return (a.task_code ?? "").localeCompare(b.task_code ?? "");
    });
  }, [tasks]);

  const range = useMemo(() => {
    const anchored = sorted
      .flatMap((t) => [t.start_date, t.planned_date])
      .filter((v): v is string => Boolean(v))
      .map((d) => new Date(d).getTime());
    if (anchored.length === 0) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const start = today.getTime() - 7 * 86400000;
      const end = today.getTime() + 30 * 86400000;
      return { start, end };
    }
    const min = Math.min(...anchored);
    const max = Math.max(...anchored);
    return { start: min - 3 * 86400000, end: Math.max(max, min + 14 * 86400000) + 3 * 86400000 };
  }, [sorted]);

  const totalDays = Math.max(1, Math.ceil((range.end - range.start) / 86400000));
  const chartWidth = totalDays * pxPerDay;
  const totalWidth = LEFT_PANEL + chartWidth;
  const totalHeight = HEADER_HEIGHT + sorted.length * ROW_HEIGHT;

  const dayToX = (iso: string) => {
    const t = new Date(iso).getTime();
    return ((t - range.start) / 86400000) * pxPerDay;
  };

  const rowIndex = new Map(sorted.map((t, i) => [t.id, i]));

  const ticks: { x: number; label: string }[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const t = new Date(range.start + i * 86400000);
    if (t.getUTCDay() === 0) {
      ticks.push({
        x: i * pxPerDay,
        label: `${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}`,
      });
    }
  }

  // Weekend stripes (one rect per matching weekday, full chart height).
  const weekendStripes: Array<{ x: number; w: number }> = [];
  if (prefs.show_weekend_shading && weekendJsDays.size > 0) {
    for (let i = 0; i < totalDays; i++) {
      const day = new Date(range.start + i * 86400000).getUTCDay();
      if (weekendJsDays.has(day)) {
        weekendStripes.push({ x: i * pxPerDay, w: pxPerDay });
      }
    }
  }

  const onRecalc = () =>
    start(async () => {
      const res = await recalculateProjectDatesAction({ projectId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`أُعيد الحساب — ${res.changes} تعديل`);
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="p-0">
        <Tabs defaultValue="chart">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <TabsList>
              <TabsTrigger value="chart">المخطط</TabsTrigger>
              <TabsTrigger value="settings">الإعدادات</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="ghost"
                onClick={() => setPxPerDay((v) => Math.max(8, v - 4))}
                title="تصغير"
              >
                <ZoomOut className="size-3.5" />
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => setPxPerDay((v) => Math.min(80, v + 4))}
                title="تكبير"
              >
                <ZoomIn className="size-3.5" />
              </Button>
              {canManage && (
                <Button size="sm" variant="outline" onClick={onRecalc} disabled={pending}>
                  {pending ? (
                    <Loader2 className="ml-1 size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="ml-1 size-3.5" />
                  )}
                  إعادة حساب التواريخ
                </Button>
              )}
            </div>
          </div>

          <TabsContent value="chart">
            <div className="overflow-auto" dir="ltr">
              <svg width={totalWidth} height={totalHeight} className="block bg-background">
                <rect x={0} y={0} width={totalWidth} height={HEADER_HEIGHT} fill="var(--muted, #f3f4f6)" />
                <line x1={LEFT_PANEL} y1={HEADER_HEIGHT} x2={totalWidth} y2={HEADER_HEIGHT} stroke="currentColor" strokeOpacity={0.15} />

                {/* Weekend column shading */}
                {weekendStripes.map((s, i) => (
                  <rect
                    key={`w-${i}`}
                    x={LEFT_PANEL + s.x}
                    y={HEADER_HEIGHT}
                    width={s.w}
                    height={totalHeight - HEADER_HEIGHT}
                    fill="#f59e0b"
                    fillOpacity={0.06}
                  />
                ))}

                {ticks.map((t, idx) => (
                  <g key={idx} transform={`translate(${LEFT_PANEL + t.x}, 0)`}>
                    <line y1={HEADER_HEIGHT - 8} y2={totalHeight} stroke="currentColor" strokeOpacity={0.07} />
                    <text x={2} y={HEADER_HEIGHT - 12} fontSize={10} fill="currentColor" fillOpacity={0.6}>
                      {t.label}
                    </text>
                  </g>
                ))}

                {prefs.show_today_line && (() => {
                  const todayX = dayToX(new Date().toISOString().slice(0, 10));
                  if (todayX < 0 || todayX > chartWidth) return null;
                  return (
                    <line
                      x1={LEFT_PANEL + todayX}
                      x2={LEFT_PANEL + todayX}
                      y1={HEADER_HEIGHT}
                      y2={totalHeight}
                      stroke="#ef4444"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  );
                })()}

                {sorted.map((t, i) => {
                  const y = HEADER_HEIGHT + i * ROW_HEIGHT;
                  const taskStart = t.start_date ?? t.planned_date;
                  const finish = t.planned_date ?? t.start_date;
                  const x1 = taskStart ? LEFT_PANEL + dayToX(taskStart) : null;
                  const x2 = finish ? LEFT_PANEL + dayToX(finish) + pxPerDay : null;
                  const barColor = STAGE_COLORS[t.stage] ?? "#64748b";
                  return (
                    <g key={t.id}>
                      {i % 2 === 1 && (
                        <rect x={0} y={y} width={totalWidth} height={ROW_HEIGHT} fill="currentColor" fillOpacity={0.025} />
                      )}
                      <foreignObject x={6} y={y + 3} width={LEFT_PANEL - 12} height={ROW_HEIGHT - 6}>
                        <div className="flex h-full items-center gap-1.5 truncate text-[12px]">
                          {t.task_code && (
                            <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {t.task_code}
                            </span>
                          )}
                          <Link
                            href={`/tasks/${t.id}`}
                            className="truncate hover:text-cyan transition-colors"
                          >
                            {t.title}
                          </Link>
                        </div>
                      </foreignObject>
                      {x1 !== null && x2 !== null && x2 > x1 ? (
                        <rect
                          x={x1}
                          y={y + 6}
                          width={Math.max(2, x2 - x1)}
                          height={ROW_HEIGHT - 12}
                          rx={3}
                          fill={barColor}
                          fillOpacity={0.85}
                        />
                      ) : x1 !== null ? (
                        <circle cx={x1} cy={y + ROW_HEIGHT / 2} r={4} fill={barColor} />
                      ) : null}
                    </g>
                  );
                })}

                {prefs.show_dependency_arrows && (
                  <>
                    <defs>
                      <marker
                        id="arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
                      </marker>
                    </defs>
                    {links.map((l) => {
                      const sIdx = rowIndex.get(l.source_task_id);
                      const tIdx = rowIndex.get(l.target_task_id);
                      if (sIdx === undefined || tIdx === undefined) return null;
                      const s = sorted[sIdx];
                      const t = sorted[tIdx];
                      const sStart = s.start_date ?? s.planned_date;
                      const sFinish = s.planned_date ?? s.start_date;
                      const tStart = t.start_date ?? t.planned_date;
                      const tFinish = t.planned_date ?? t.start_date;
                      if (!sStart || !sFinish || !tStart || !tFinish) return null;

                      const xSStart = LEFT_PANEL + dayToX(sStart);
                      const xSFinish = LEFT_PANEL + dayToX(sFinish) + pxPerDay;
                      const xTStart = LEFT_PANEL + dayToX(tStart);
                      const xTFinish = LEFT_PANEL + dayToX(tFinish) + pxPerDay;

                      const ySMid = HEADER_HEIGHT + sIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const yTMid = HEADER_HEIGHT + tIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

                      let x1 = 0, y1 = ySMid, x2 = 0, y2 = yTMid;
                      switch (l.dependency_type) {
                        case "finish_to_start":
                          x1 = xSFinish; x2 = xTStart; break;
                        case "start_to_start":
                          x1 = xSStart; x2 = xTStart; break;
                        case "finish_to_finish":
                          x1 = xSFinish; x2 = xTFinish; break;
                        case "start_to_finish":
                          x1 = xSStart; x2 = xTFinish; break;
                      }

                      const midX = x1 + Math.max(8, (x2 - x1) / 2);
                      const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
                      return (
                        <path
                          key={l.id}
                          d={path}
                          fill="none"
                          stroke="#64748b"
                          strokeWidth={1}
                          markerEnd="url(#arrow)"
                          opacity={0.7}
                        />
                      );
                    })}
                  </>
                )}
              </svg>
            </div>

            {sorted.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                لا توجد مهام في هذا المشروع.
              </div>
            )}

            <div className="border-t bg-muted/20 p-3 text-[11px] text-muted-foreground">
              <span className="me-3">تواريخ المهام مأخوذة من <strong>start_date</strong> و<strong>planned_date</strong>.</span>
              {prefs.show_dependency_arrows && (
                <span className="me-3">الأسهم: FS / SS / FF / SF.</span>
              )}
              {prefs.show_today_line && <span>الخط الأحمر = اليوم.</span>}
            </div>
          </TabsContent>

          <TabsContent value="settings">
            <GanttSettings
              projectId={projectId}
              initialPrefs={initialPrefs}
              canManage={canManage}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
