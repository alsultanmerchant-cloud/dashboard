"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, PencilRuler, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { FilterChip } from "@/components/filter-chip";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";
import type { DashboardRange } from "@/lib/dashboard-range";
import type { ClientEditsRow, DrillTask } from "@/lib/data/accountability";
import { AccountabilityRangePicker } from "./accountability-range-picker";
import { getClientEditsDetailAction } from "./_actions";
import { DrillNumber, TaskDrillSheet, type DrillView } from "./task-drill-modal";

type EditsMetric = "edits" | "slaBreach" | "editRate" | "pending";

interface EditsDrill {
  employeeId: string;
  employeeName: string;
  metric: EditsMetric;
  editsCompleted?: number;
  pendingEdits?: number;
  deliveredCount?: number;
}

function editsDrillView(drill: EditsDrill, all: DrillTask[]): Omit<DrillView, "loading" | "error"> {
  const edits = all.filter((t) => t.kind === "edit");
  const pending = all.filter((t) => t.kind === "pending");
  switch (drill.metric) {
    case "edits":
      return {
        title: `تعديلات العميل — ${drill.employeeName}`,
        subtitle: `${drill.editsCompleted ?? edits.length} خرج من التعديل ووصل Done/Cancelled خلال الفترة + ${drill.pendingEdits ?? pending.length} لايف الآن`,
        valueKind: "minutes",
        tasks: [...edits, ...pending],
      };
    case "slaBreach":
      return { title: `تجاوزت مهلة SLA — ${drill.employeeName}`, subtitle: "تعديلات تجاوز زمنها الحدّ المسموح", valueKind: "minutes", tasks: edits.filter((t) => t.flag) };
    case "editRate":
      return {
        title: `نسبة تعديلات العميل — ${drill.employeeName}`,
        subtitle: `${drill.editsCompleted ?? 0} تعديل اكتمل ÷ ${drill.deliveredCount ?? 0} تاسك اتسلّم في الفترة`,
        valueKind: "minutes",
        tasks: edits,
      };
    case "pending":
      return {
        title: `قيد التعديل الآن — ${drill.employeeName}`,
        subtitle: "جالسة في مرحلة تعديلات العميل حتى الآن",
        valueKind: "minutes",
        durationStyle: "odoo",
        tasks: all.filter((t) => t.kind === "pending"),
      };
  }
}

// تعديلات العميل — the sibling of صرامة المراجعة, pointed at client_changes.
// Same table shape on purpose: reviewer rigor asks "is the review real?", this
// asks "when work comes back, do we turn it around inside the SLA?".
// Attribution and the SLA both come from configuration, never from a constant
// invented here — see getClientEditsRigor.

const NA = "—";

function formatMinutes(min: number | null, t: ReturnType<typeof useTranslations>): string {
  if (min == null) return NA;
  const m = Math.round(min);
  if (m < 60) return t("fmt.minutes", { n: m });
  const h = m / 60;
  if (h < 8) return t("fmt.hours", { n: Math.round(h * 10) / 10 });
  return t("fmt.workdays", { n: Math.round((h / 8) * 10) / 10 });
}

// Rwasem/Odoo renders accumulated working hours in 24-hour `d` chunks. Thus
// 83h 29m appears there as 3d 11h 29m, while the SLA view calls the same amount
// 10.4 eight-hour workdays. Use the Odoo notation for the live pending clock so
// the two screens can be compared without looking like contradictory data.
// Wrap an LTR token (e.g. "3d 17h 9m") in Unicode isolate marks so it renders
// intact inside an RTL label — LRI (U+2066) … PDI (U+2069). Without it, the
// bidi algorithm splits the leading digit off the Arabic «الأقدم:» prefix.
function ltrIsolate(s: string): string {
  return `⁦${s}⁩`;
}

function formatOdooDuration(min: number): string {
  const total = Math.max(0, Math.round(min));
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const minutes = total % 60;
  return [days > 0 ? `${days}d` : null, hours > 0 || days > 0 ? `${hours}h` : null, `${minutes}m`]
    .filter(Boolean)
    .join(" ");
}

export function ClientEditsSection({
  rows,
  range,
  onSelect,
  showRangePicker = false,
}: {
  rows: ClientEditsRow[];
  range: DashboardRange;
  onSelect?: (id: string) => void;
  showRangePicker?: boolean;
}) {
  const t = useTranslations("AccountabilityPage");
  const [open, setOpen] = useState(true);
  const [dept, setDept] = useState<string | null>(null);

  // Drill-down: click any number → the exact tasks behind it (one owner's whole
  // detail set; the modal slices by metric so switching metric doesn't refetch).
  const [drill, setDrill] = useState<EditsDrill | null>(null);
  const [tasks, setTasks] = useState<DrillTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const drillEmployeeId = drill?.employeeId;

  useEffect(() => {
    if (!drillEmployeeId) return;
    let active = true;
    getClientEditsDetailAction(drillEmployeeId, range.from, range.to)
      .then((res) => {
        if (!active) return;
        if (res.ok) setTasks(res.tasks);
        else {
          setTasks([]);
          setError(res.error);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setTasks([]);
        setError("failed");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [drillEmployeeId, range.from, range.to, attempt]);

  const view: DrillView | null = drill ? { ...editsDrillView(drill, tasks), loading, error } : null;
  const openDrill = (
    employeeId: string,
    employeeName: string,
    metric: EditsMetric,
    counts?: Pick<EditsDrill, "editsCompleted" | "pendingEdits" | "deliveredCount">,
  ) => {
    setTasks([]);
    setLoading(true);
    setError(null);
    setDrill({ employeeId, employeeName, metric, ...counts });
  };
  const retryDrill = () => {
    setLoading(true);
    setError(null);
    setAttempt((a) => a + 1);
  };

  // Client edits span every department that owns the stage in a task template,
  // not just the supporting ones — so the department filter is the lens.
  // Chips count PEOPLE, matching what the filter actually narrows (rows) and
  // the "all" chip's unit. Counting edits here while "all" counted people put
  // two different units side by side.
  const departments = useMemo(() => {
    const counts = new Map<string, { people: number; edits: number }>();
    for (const r of rows) {
      const key = r.department ?? NA;
      const cur = counts.get(key) ?? { people: 0, edits: 0 };
      cur.people += 1;
      cur.edits += r.editsTotal;
      counts.set(key, cur);
    }
    return [...counts.entries()].sort((a, b) => b[1].edits - a[1].edits);
  }, [rows]);

  const shown = useMemo(
    () => (dept ? rows.filter((r) => (r.department ?? NA) === dept) : rows),
    [rows, dept],
  );

  const slaTarget = rows[0]?.slaTargetMinutes ?? null;

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-start"
        >
          <PencilRuler className="size-4 text-cyan" />
          <span className="text-sm font-semibold">{t("clientEdits.title")}</span>
          <span className="rounded-full border border-border bg-soft-1 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {rows.length}
          </span>
          <ChevronDown className={cn("ms-auto size-4 transition-transform", open && "rotate-180")} />
        </button>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("clientEdits.hint")}</p>

        {open && (
          <div className="mt-3 space-y-3">
            {showRangePicker && <AccountabilityRangePicker range={range} />}
            <p className="text-[11px] leading-snug text-muted-foreground">{t("clientEdits.subtitle")}</p>
            {slaTarget !== null && (
              <p className="rounded-[var(--radius-sm)] border border-cyan/20 bg-cyan/5 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
                {t("clientEdits.slaNote", { v: formatMinutes(slaTarget, t) })}
              </p>
            )}

            {departments.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip as="button" active={dept === null} count={rows.length} onClick={() => setDept(null)}>
                  {t("clientEdits.allDepts")}
                </FilterChip>
                {departments.map(([name, c]) => (
                  <span
                    key={name}
                    title={t("clientEdits.deptChipTitle", { edits: c.edits, people: c.people })}
                  >
                    <FilterChip
                      as="button"
                      active={dept === name}
                      count={c.people}
                      onClick={() => setDept(dept === name ? null : name)}
                    >
                      {name}
                    </FilterChip>
                  </span>
                ))}
              </div>
            )}

            {shown.length === 0 ? (
              <p className="rounded-[var(--radius-md)] bg-soft-1/60 px-3 py-4 text-center text-xs text-muted-foreground">
                {t("clientEdits.empty")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground">
                      <th className="p-2 text-start font-medium">{t("clientEdits.col.owner")}</th>
                      <th className="p-2 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("clientEdits.col.edits")}
                          <MetricInfo
                            text={t("clientEdits.tooltip.edits")}
                            label={t("clientEdits.col.edits")}
                          />
                        </span>
                      </th>
                      <th className="p-2 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("clientEdits.col.medianTime")}
                          <MetricInfo
                            text={t("clientEdits.tooltip.medianTime")}
                            label={t("clientEdits.col.medianTime")}
                          />
                        </span>
                      </th>
                      <th className="p-2 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("clientEdits.col.slaBreach")}
                          <MetricInfo
                            text={t("clientEdits.tooltip.slaBreach")}
                            label={t("clientEdits.col.slaBreach")}
                          />
                        </span>
                      </th>
                      <th className="p-2 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("clientEdits.col.editRate")}
                          <MetricInfo
                            text={t("clientEdits.tooltip.editRate")}
                            label={t("clientEdits.col.editRate")}
                          />
                        </span>
                      </th>
                      <th className="p-2 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t("clientEdits.col.pending")}
                          <MetricInfo
                            text={t("clientEdits.tooltip.pending")}
                            label={t("clientEdits.col.pending")}
                          />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => {
                      const low = row.confidence === "low";
                      const overSla =
                        row.medianEditBusinessMinutes !== null &&
                        row.medianEditBusinessMinutes > row.slaTargetMinutes;
                      return (
                        <tr
                          key={row.employeeId}
                          onClick={onSelect ? () => onSelect(row.employeeId) : undefined}
                          className={cn(
                            "border-b border-border/50 transition-colors",
                            onSelect && "cursor-pointer hover:bg-soft-1",
                          )}
                          title={onSelect ? t("evidenceRule") : undefined}
                        >
                          <td className="p-2">
                            <span className="font-medium">{row.fullName}</span>
                            {row.department && (
                              <span className="ms-1.5 text-[10px] text-muted-foreground">{row.department}</span>
                            )}
                            {low && (
                              <span className="ms-1.5 rounded border border-border bg-soft-1 px-1 py-0.5 text-[10px] text-muted-foreground">
                                {t("lowSample", { n: row.sampleSize })}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center tabular-nums">
                            <DrillNumber
                              value={row.editsTotal}
                              onClick={() =>
                                openDrill(row.employeeId, row.fullName, "edits", {
                                  editsCompleted: row.editsCompleted,
                                  pendingEdits: row.pendingEdits,
                                })
                              }
                            />
                            <div className="text-[10px] tabular-nums text-muted-foreground">
                              {t("clientEdits.editsBreakdown", {
                                done: row.editsCompleted,
                                live: row.pendingEdits,
                              })}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            {/* Beside a real SLA, a median is a verdict, not trivia. */}
                            <span
                              className={cn(
                                "tabular-nums",
                                overSla ? "font-semibold text-amber" : "text-muted-foreground",
                              )}
                            >
                              {formatMinutes(row.medianEditBusinessMinutes, t)}
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <DrillNumber
                              value={row.slaBreachCount}
                              onClick={() => openDrill(row.employeeId, row.fullName, "slaBreach")}
                              className={cn(
                                "inline-flex items-center gap-1 tabular-nums",
                                row.slaBreachCount > 0 ? "font-semibold text-amber" : "text-muted-foreground",
                              )}
                            >
                              {row.slaBreachCount > 0 && <Timer className="size-3" />}
                              <span dir="ltr">{row.slaBreachCount}</span>
                            </DrillNumber>
                            {row.editsCompleted > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                {t("clientEdits.slaBreachDetail", { n: row.editsCompleted })}
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {row.editRate === null ? (
                              <span className="text-muted-foreground">{NA}</span>
                            ) : (
                              <>
                                <DrillNumber
                                  value={row.editsCompleted}
                                  onClick={() =>
                                    openDrill(row.employeeId, row.fullName, "editRate", {
                                      editsCompleted: row.editsCompleted,
                                      deliveredCount: row.deliveredCount,
                                    })
                                  }
                                  className={cn(
                                    "tabular-nums",
                                    row.editRate >= 30 ? "font-semibold text-amber" : "text-muted-foreground",
                                  )}
                                >
                                  <span dir="ltr">{row.editRate}%</span>
                                </DrillNumber>
                                <div className="text-[10px] tabular-nums text-muted-foreground">
                                  {t("clientEdits.editRateDetail", {
                                    k: row.editsCompleted,
                                    n: row.deliveredCount,
                                  })}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <DrillNumber
                              value={row.pendingEdits}
                              onClick={() => openDrill(row.employeeId, row.fullName, "pending")}
                              className="tabular-nums"
                            />
                            {row.oldestPendingBusinessMinutes !== null && row.pendingEdits > 0 && (
                              <div
                                className="text-[10px] tabular-nums text-muted-foreground"
                                title={t("clientEdits.tooltip.pendingDuration", {
                                  v: formatMinutes(row.oldestPendingBusinessMinutes, t),
                                })}
                              >
                                {/* «الأقدم:» is RTL, the duration is an LTR token
                                    (3d 17h 9m). Wrapping the value in LRI…PDI
                                    isolate marks keeps it intact under RTL without
                                    forcing the whole line dir="ltr" (which split
                                    the leading digit off — see the bug). */}
                                {t("clientEdits.oldestPending", {
                                  v: ltrIsolate(formatOdooDuration(row.oldestPendingBusinessMinutes)),
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
      {view && <TaskDrillSheet view={view} onClose={() => setDrill(null)} onRetry={retryDrill} />}
    </Card>
  );
}
