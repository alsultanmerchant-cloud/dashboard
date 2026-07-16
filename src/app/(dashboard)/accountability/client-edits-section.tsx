"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, PencilRuler, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { FilterChip } from "@/components/filter-chip";
import { MetricInfo } from "@/components/metric-info";
import { cn } from "@/lib/utils";
import type { DashboardRange } from "@/lib/dashboard-range";
import type { ClientEditsRow } from "@/lib/data/accountability";
import { AccountabilityRangePicker } from "./accountability-range-picker";

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
      cur.edits += r.editsCompleted;
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
                      <th className="p-2 text-center font-medium">{t("clientEdits.col.edits")}</th>
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
                          <td className="p-2 text-center tabular-nums">{row.editsCompleted}</td>
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
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 tabular-nums",
                                row.slaBreachCount > 0 ? "font-semibold text-amber" : "text-muted-foreground",
                              )}
                            >
                              {row.slaBreachCount > 0 && <Timer className="size-3" />}
                              <span dir="ltr">{row.slaBreachCount}</span>
                            </span>
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
                                <span
                                  className={cn(
                                    "tabular-nums",
                                    row.editRate >= 30 ? "font-semibold text-amber" : "text-muted-foreground",
                                  )}
                                  dir="ltr"
                                >
                                  {row.editRate}%
                                </span>
                                <div className="text-[10px] tabular-nums text-muted-foreground">
                                  {t("clientEdits.editRateDetail", {
                                    k: row.deliveredEditedCount,
                                    n: row.deliveredCount,
                                  })}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <span className="tabular-nums">{row.pendingEdits}</span>
                            {row.oldestPendingBusinessMinutes !== null && row.pendingEdits > 0 && (
                              <div className="text-[10px] tabular-nums text-muted-foreground">
                                {t("clientEdits.oldestPending", {
                                  v: formatMinutes(row.oldestPendingBusinessMinutes, t),
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
    </Card>
  );
}
