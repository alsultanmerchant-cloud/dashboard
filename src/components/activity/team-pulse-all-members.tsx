"use client";

import { useMemo, useState } from "react";
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Users,
  GitBranch,
  MessageSquare,
  Search,
  Gauge,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { riyadhDateOf, riyadhTodayIso, riyadhDaysAgoIso } from "@/lib/tz";
import { CompareTrendModal } from "@/components/activity/compare-trend-modal";
import { ActionBreakdownButton } from "@/components/activity/action-breakdown-sheet";
import { TeamPulsePendingCell } from "@/components/activity/team-pulse-pending-cell";
import { TeamPulseActiveProjectsModal } from "@/components/activity/team-pulse-active-projects-modal";
import type { AllMemberRow, ActivityStatus, LoadFlag } from "@/lib/data/team-pulse";

const NA = "—";

const STATUS_META: Record<ActivityStatus, { label: string; tone: string; dot: string }> = {
  active: { label: "نشط", tone: "text-cc-green", dot: "bg-cc-green" },
  slow: { label: "خامل", tone: "text-amber", dot: "bg-amber" },
  stalled: { label: "غير نشط", tone: "text-cc-red", dot: "bg-cc-red" },
};

const LOAD_META: Record<LoadFlag, { label: string; cls: string } | null> = {
  overloaded: { label: "محمّل زائد", cls: "bg-cc-red/10 text-cc-red" },
  light: { label: "سعة متاحة", cls: "bg-soft-2 text-muted-foreground" },
  balanced: null,
};

export type TeamMemberFilter = "all" | "overloaded" | "available";

const FILTER_LINKS: Array<{ value: TeamMemberFilter; label: string; href: string }> = [
  { value: "all", label: "كل الموظفين", href: "/team-activity#team-pulse-results" },
  {
    value: "overloaded",
    label: "محمّل زائد",
    href: "/team-activity?filter=overloaded#team-pulse-results",
  },
  {
    value: "available",
    label: "سعة متاحة",
    href: "/team-activity?filter=available#team-pulse-results",
  },
];

function ActionsSplit({ moves, notes }: { moves: number; notes: number }) {
  const total = moves + notes;
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2.5 tabular-nums",
        total > 0 ? "text-cc-green" : "text-muted-foreground",
      )}
    >
      <span className="inline-flex items-center gap-0.5" title="نقل مراحل">
        <GitBranch className="size-3" />
        {moves}
      </span>
      <span
        className="inline-flex items-center gap-0.5"
        title="سجل العمل: ملاحظات (كومنت) + إنشاء مهام + إسناد وتعديلات"
      >
        <MessageSquare className="size-3" />
        {notes}
      </span>
    </div>
  );
}

function CompletedSplit({ today, week }: { today: number; week: number }) {
  return (
    <div className="flex flex-col items-center leading-tight tabular-nums">
      <span className="font-semibold text-cc-green">
        {today}
        <span className="text-[9px] font-normal text-muted-foreground"> اليوم</span>
      </span>
      <span className="text-[10px] text-muted-foreground">{week} الأسبوع</span>
    </div>
  );
}

// Loose Arabic-friendly normalize so "أيمن" matches "ايمن", "علية" ~ "عليه", etc.
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْٰ]/g, "") // strip tashkeel
    .trim();
}

// Riyadh CALENDAR-day relative label — consistent with the status column, so a
// yesterday-evening action reads "أمس" (not "اليوم" from a rolling-24h floor).
function relativeDays(iso: string | null): string {
  if (!iso) return NA;
  const d = riyadhDateOf(iso);
  const today = riyadhTodayIso();
  if (d >= today) return "اليوم";
  if (d === riyadhDaysAgoIso(1)) return "أمس";
  const days = Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
  return `منذ ${days} يوم`;
}

function Momentum({ value }: { value: number }) {
  if (value === 0) return <span className="text-[10px] text-muted-foreground">ثابت</span>;
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px]", up ? "text-cc-green" : "text-cc-red")}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "+" : ""}
      {value}
    </span>
  );
}

// كل الموظفين عبر الأقسام، مرتّبين من الأقل نشاطًا إلى الأكثر — مكان واحد لرصد من
// توقّف في الشركة كلها بدل التنقّل بين الأقسام.
export function TeamPulseAllMembers({
  members,
  filter = "all",
  overloadProjectsThreshold,
}: {
  members: AllMemberRow[];
  filter?: TeamMemberFilter;
  overloadProjectsThreshold: number;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = norm(query);
    const byLoad = members.filter((member) => {
      if (filter === "overloaded") return !member.isLeadership && member.loadFlag === "overloaded";
      if (filter === "available") return !member.isLeadership && member.loadFlag === "light";
      return true;
    });
    const byQuery = !q
      ? byLoad
      : byLoad.filter(
      (m) =>
        norm(m.fullName).includes(q) ||
        norm(m.departmentName).includes(q) ||
        norm(m.positionLabel).includes(q),
      );
    if (filter === "overloaded") {
      return [...byQuery].sort((a, b) => b.activeProjects - a.activeProjects);
    }
    return byQuery;
  }, [filter, members, query]);

  const sectionTitle =
    filter === "overloaded"
      ? "الموظفون المحمّلون زائدًا"
      : filter === "available"
        ? "الموظفون ذوو السعة المتاحة"
        : "كل الموظفين — مرتّبون من الأقل نشاطًا";

  return (
    <Card id="team-pulse-results" className="mt-6 scroll-mt-6">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              {filter === "overloaded" ? (
                <Gauge className="size-4 text-cc-red" aria-hidden="true" />
              ) : (
                <Users className="size-4 text-cyan" aria-hidden="true" />
              )}
              {sectionTitle}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {filter === "overloaded"
                ? `أكثر من ${overloadProjectsThreshold} مشاريع نشطة — مرتّبون من الأعلى حملًا`
                : "نظرة واحدة على نشاط الفريق بالكامل عبر الأقسام"}
              {" · "}{filtered.length} موظف
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex items-center rounded-lg border border-border bg-soft-1 p-0.5" aria-label="فلترة حمل الموظفين">
              {FILTER_LINKS.map((item) => (
                <Link
                  key={item.value}
                  href={item.href}
                  aria-current={filter === item.value ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] transition-colors hover:bg-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                    filter === item.value && "bg-card font-semibold text-foreground shadow-sm",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                name="team-member-search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث عن موظف أو قسم…"
                aria-label="ابحث عن موظف أو قسم"
                className="w-56 rounded-lg border border-border bg-card py-1.5 pe-8 ps-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/30"
              />
            </div>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">لا توجد بيانات نشاط بعد.</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            لا يوجد موظف مطابق لـ «{query}».
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">الموظف</th>
                  <th className="px-3 py-2.5 font-medium">القسم</th>
                  <th
                    className="px-3 py-2.5 text-center font-medium"
                    title="عدد المشاريع النشطة التي لدى الموظف مهام مفتوحة فيها"
                  >
                    المشاريع النشطة
                  </th>
                  <th className="px-3 py-2.5 font-medium">الحالة</th>
                  <th className="px-3 py-2.5 font-medium">آخر إجراء</th>
                  <th
                    className="px-3 py-2.5 font-medium text-center"
                    title="كل الإجراءات التي قام بها الموظف نفسه اليوم في رواسم — نقل المراحل + سجل العمل (ملاحظات + إنشاء مهام + إسناد وتعديلات). منسوبة لفاعلها الحقيقي، لا لكل المكلّفين بالمهمة"
                  >
                    إجراءات اليوم
                  </th>
                  <th className="px-3 py-2.5 font-medium">إجراءات الأسبوع</th>
                  <th
                    className="px-3 py-2.5 font-medium text-center"
                    title="المهام التي أنهاها اليوم / خلال هذا الأسبوع"
                  >
                    أُنجزت
                  </th>
                  <th className="px-3 py-2.5 font-medium text-center">مفتوحة</th>
                  <th
                    className="px-3 py-2.5 font-medium text-center"
                    title="المهام التي يملك مرحلتها الحالية (على مكتبه الآن) — كم منها متأخرة: تخطّت معيار الوقت المسموح لمرحلتها (SLA) من إجمالي ما على مكتبه. المراحل بلا SLA في القوالب (جديد / قيد التنفيذ) لا تُحتسب متأخرة. مقياس الالتزام بالمواعيد."
                  >
                    مُعلقة
                  </th>
                  <th className="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const meta = STATUS_META[m.status];
                  return (
                    <tr key={m.employeeId} className="border-b border-border/50 hover:bg-soft-1">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium" data-private="person">{m.fullName}</span>
                          {m.isLeadership && (
                            <span className="rounded bg-cyan/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan">
                              قيادة
                            </span>
                          )}
                          {LOAD_META[m.loadFlag] && (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-medium",
                                LOAD_META[m.loadFlag]!.cls,
                              )}
                            >
                              {LOAD_META[m.loadFlag]!.label}
                            </span>
                          )}
                        </div>
                        {m.positionLabel && (
                          <div className="text-[10px] text-muted-foreground">{m.positionLabel}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                        {m.departmentName ?? NA}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <TeamPulseActiveProjectsModal
                          employeeId={m.employeeId}
                          fullName={m.fullName}
                          activeProjects={m.activeProjects}
                          overloaded={m.loadFlag === "overloaded"}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("inline-flex items-center gap-1.5 text-xs", meta.tone)}>
                          <span className={cn("size-2 rounded-full", meta.dot)} />
                          {meta.label}
                        </span>
                      </td>
                      <td className={cn("px-3 py-2.5", meta.tone)}>{relativeDays(m.lastActionAt)}</td>
                      <td className="px-3 py-2.5">
                        <ActionsSplit moves={m.movesToday} notes={m.notesToday} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums">{m.actionsThisWeek}</span>
                          <Momentum value={m.momentum} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <CompletedSplit today={m.completedToday} week={m.completedThisWeek} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-center">{m.openWip}</td>
                      <td className="px-3 py-2.5 text-center">
                        <TeamPulsePendingCell
                          employeeId={m.employeeId}
                          fullName={m.fullName}
                          late={m.pendingLate}
                          owned={m.ownedOpen}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <ActionBreakdownButton
                            employeeId={m.employeeId}
                            fullName={m.fullName}
                            className="px-2 py-1 text-[11px]"
                          />
                          <CompareTrendModal employeeId={m.employeeId} fullName={m.fullName} />
                          <Link
                            href={`/accountability?emp=${m.employeeId}`}
                            className="flex items-center gap-1 text-cyan hover:underline"
                            title="جودة الالتزام (المساءلة)"
                          >
                            <ExternalLink className="size-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
