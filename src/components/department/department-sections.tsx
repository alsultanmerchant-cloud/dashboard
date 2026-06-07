import Link from "next/link";
import {
  Users,
  AlertTriangle,
  ShieldAlert,
  CalendarClock,
  Layers,
  Gauge,
  Clock,
  Siren,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { TASK_STAGE_LABELS, type TaskStage } from "@/lib/labels";
import type {
  DeptTaskCounts,
  DeptTeamSummary,
  CapacityRow,
  StuckStageInfo,
  SubtaskUploadStats,
  DeptEscalationRow,
  DeptScores,
} from "@/lib/data/department";

const NA = "—";

function stageLabel(stage: string): string {
  return TASK_STAGE_LABELS[stage as TaskStage] ?? stage;
}

// ---- Overview header (team + delays/warnings/leave) ----------------------

export function DepartmentOverviewHeader({
  departmentName,
  summary,
}: {
  departmentName: string;
  summary: DeptTeamSummary;
}) {
  const stats: { icon: typeof Users; label: string; value: number; tone: string }[] = [
    { icon: Users, label: "أعضاء الفريق", value: summary.memberCount, tone: "text-cyan" },
    { icon: AlertTriangle, label: "مهام متأخرة", value: summary.totalOverdue, tone: "text-cc-red" },
    { icon: ShieldAlert, label: "إنذارات مفتوحة", value: summary.openWarnings, tone: "text-amber" },
    { icon: CalendarClock, label: "طلبات إجازة معلّقة", value: summary.pendingLeaves, tone: "text-violet-400" },
  ];
  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-cyan" />
          نظرة عامة على {departmentName}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-3">
              <s.icon className={cn("size-4", s.tone)} />
              <p className="mt-2 text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Task counts ----------------------------------------------------------

export function DepartmentTaskCounts({ counts }: { counts: DeptTaskCounts }) {
  const cells: { label: string; value: number; tone: string }[] = [
    { label: "مشاريع نشطة", value: counts.activeProjects, tone: "text-cyan" },
    { label: "مهام مفتوحة", value: counts.open, tone: "text-foreground" },
    { label: "مكتملة", value: counts.completed, tone: "text-cc-green" },
    { label: "متأخرة", value: counts.overdue, tone: "text-cc-red" },
    { label: "معرّضة للتأخير", value: counts.atRisk, tone: "text-amber" },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-3">
            <p className={cn("text-2xl font-bold tabular-nums", c.tone)}>{c.value}</p>
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- KPI band (scores) ----------------------------------------------------

function pctTone(v: number | null, good = 85, mid = 70): string {
  if (v == null) return "text-muted-foreground";
  if (v >= good) return "text-cc-green";
  if (v >= mid) return "text-amber";
  return "text-cc-red";
}

export function DepartmentKpiBand({ scores }: { scores: DeptScores }) {
  const items: { icon: typeof Gauge; label: string; value: string; tone: string }[] = [
    {
      icon: Gauge,
      label: "الالتزام بالمواعيد",
      value: scores.onTimePct == null ? NA : `${scores.onTimePct}%`,
      tone: pctTone(scores.onTimePct),
    },
    {
      icon: Layers,
      label: "متوسط التعديلات",
      value: scores.avgRevisions == null ? NA : String(scores.avgRevisions),
      tone: scores.avgRevisions == null ? "text-muted-foreground" : scores.avgRevisions <= 1 ? "text-cc-green" : scores.avgRevisions <= 3 ? "text-amber" : "text-cc-red",
    },
    { icon: Sparkles, label: "أُنجزت آخر ٣٠ يوم", value: String(scores.completed30d), tone: "text-cyan" },
    {
      icon: AlertTriangle,
      label: "نسبة التأخر",
      value: scores.overdueRate == null ? NA : `${scores.overdueRate}%`,
      tone: scores.overdueRate == null ? "text-muted-foreground" : scores.overdueRate <= 10 ? "text-cc-green" : scores.overdueRate <= 25 ? "text-amber" : "text-cc-red",
    },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-4">
            <it.icon className={cn("size-4", it.tone)} />
            <p className={cn("mt-2 text-2xl font-bold tabular-nums", it.tone)}>{it.value}</p>
            <p className="text-[11px] text-muted-foreground">{it.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- Capacity -------------------------------------------------------------

const BAND_META: Record<CapacityRow["band"], { label: string; tone: string; bar: string }> = {
  overloaded: { label: "مضغوط", tone: "text-cc-red", bar: "bg-cc-red/55" },
  balanced: { label: "متوازن", tone: "text-cyan", bar: "bg-cyan/45" },
  free: { label: "متاح لعمل إضافي", tone: "text-cc-green", bar: "bg-cc-green/45" },
};

export function DepartmentCapacity({ rows }: { rows: CapacityRow[] }) {
  const max = Math.max(...rows.map((r) => r.openCount), 1);
  return (
    <Card className="h-full">
      <CardContent className="p-3">
        <div className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          الطاقة الاستيعابية للفريق
        </div>
        {rows.length === 0 ? (
          <EmptyState variant="compact" title="لا يوجد أعضاء بعد" description="" />
        ) : (
          <div className="space-y-0.5">
            {rows.map((r) => {
              const meta = BAND_META[r.band];
              const pct = Math.max(2, (r.openCount / max) * 100);
              return (
                <div key={r.employeeId} className="px-3 py-2">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium">{r.fullName}</span>
                    <span className={cn("text-[10px] font-semibold", meta.tone)}>{meta.label}</span>
                  </div>
                  <div className="relative h-5 overflow-hidden rounded-md bg-soft-2">
                    <div className={cn("absolute inset-y-0 right-0 transition-all", meta.bar)} style={{ width: `${pct}%` }} />
                    <div className="relative flex h-full items-center justify-end px-2 text-[11px] font-bold tabular-nums">
                      {r.openCount}
                      {r.overdueCount > 0 && (
                        <span className="mr-1 text-[9px] font-medium text-cc-red">({r.overdueCount} متأخر)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Stuck stages + idle tasks -------------------------------------------

export function DepartmentStuckStages({ info }: { info: StuckStageInfo }) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold">
          <Clock className="size-3.5 text-amber" />
          المراحل المتعثّرة
        </p>
        {info.mostStuckStage ? (
          <div className="mb-3 rounded-xl border border-amber/25 bg-amber/5 p-3">
            <p className="text-[11px] text-muted-foreground">أكثر مرحلة يتوقف عندها العمل</p>
            <p className="mt-1 text-sm font-bold">{stageLabel(info.mostStuckStage.stage)}</p>
            <p className="text-[11px] text-muted-foreground">
              {info.mostStuckStage.count} مهمة · متوسط {info.mostStuckStage.avgDays} يوم
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">لا توجد مهام مفتوحة.</p>
        )}
        {info.idleTasks.length > 0 && (
          <>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">مهام بدون حركة</p>
            <ul className="space-y-1">
              {info.idleTasks.map((t) => (
                <li key={t.taskId} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-soft-1">
                  <Link href={`/tasks/${t.taskId}`} className="truncate text-cyan hover:underline">
                    {stageLabel(t.stage)}
                  </Link>
                  <span className="shrink-0 tabular-nums text-cc-red">{t.idleDays} يوم</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Escalations + Smart Tasks placeholder -------------------------------

export function DepartmentEscalations({ rows }: { rows: DeptEscalationRow[] }) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold">
          <Siren className="size-3.5 text-cc-red" />
          التصعيدات والمشاكل
        </p>
        {rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">لا توجد تصعيدات نشطة لمهام الفريق.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-soft-1">
                <Link href={e.taskId ? `/tasks/${e.taskId}` : "/escalations"} className="truncate text-cyan hover:underline">
                  تصعيد مستوى {e.level}
                </Link>
                <span className={cn("shrink-0 text-[10px] font-semibold", e.status === "open" ? "text-cc-red" : "text-muted-foreground")}>
                  {e.status === "open" ? "مفتوح" : e.status === "acknowledged" ? "مستلَم" : "مغلق"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 rounded-xl border border-dashed border-violet-400/30 bg-violet-400/5 p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-300">
            <Sparkles className="size-3.5" />
            المهام الذكية واقتراحات الحلول — قريبًا
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            سيقوم وكيل الذكاء الاصطناعي بتحليل أسباب التعطّل واقتراح حلول وإنشاء مهام ذكية تلقائيًا.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Subtask upload-delay rate -------------------------------------------

export function DepartmentSubtaskUpload({ stats }: { stats: SubtaskUploadStats }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold">
          <UploadCloud className="size-3.5 text-cyan" />
          معدل تأخّر رفع المهام الفرعية
        </p>
        {stats.rate == null ? (
          <p className="text-sm text-muted-foreground">{NA} (لا توجد مهام فرعية بمواعيد محددة)</p>
        ) : (
          <p className="text-3xl font-bold tabular-nums">
            <span className={stats.rate <= 15 ? "text-cc-green" : stats.rate <= 35 ? "text-amber" : "text-cc-red"}>
              {stats.rate}%
            </span>
            <span className="mr-2 text-xs font-normal text-muted-foreground">
              {stats.late} من {stats.total} متأخرة
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
