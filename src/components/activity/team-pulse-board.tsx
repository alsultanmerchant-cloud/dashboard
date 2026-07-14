import Link from "next/link";
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  ChevronLeft,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { TeamPulseOverview, TeamPulseRow, PulseStatus } from "@/lib/data/team-pulse";

const STATUS_META: Record<
  PulseStatus,
  { label: string; text: string; border: string; chip: string; dot: string }
> = {
  good: {
    label: "يتحرّك جيدًا",
    text: "text-cc-green",
    border: "border-cc-green/30",
    chip: "bg-cc-green/10 text-cc-green",
    dot: "bg-cc-green",
  },
  watch: {
    label: "يحتاج متابعة",
    text: "text-amber",
    border: "border-amber/30",
    chip: "bg-amber/10 text-amber",
    dot: "bg-amber",
  },
  risk: {
    label: "متوقّف",
    text: "text-cc-red",
    border: "border-cc-red/30",
    chip: "bg-cc-red/10 text-cc-red",
    dot: "bg-cc-red",
  },
  na: {
    label: "لا نشاط",
    text: "text-muted-foreground",
    border: "border-border",
    chip: "bg-soft-2 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

function freshness(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  return `قبل ${Math.floor(hrs / 24)} يوم`;
}

function Momentum({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-cc-green">
        <TrendingUp className="size-3.5" /> النشاط متزايد
      </span>
    );
  if (value < 0)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-cc-red">
        <TrendingDown className="size-3.5" /> النشاط متراجع
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Minus className="size-3.5" /> مستقر
    </span>
  );
}

function DeptCard({ row }: { row: TeamPulseRow }) {
  const meta = STATUS_META[row.status];
  return (
    <Link href={`/team-activity?dept=${row.departmentId}`} className="group block">
      <Card className={cn("h-full transition-colors hover:bg-soft-1", meta.border)}>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                meta.chip,
              )}
            >
              <span className={cn("size-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </span>
            <Momentum value={row.momentum} />
          </div>

          <div className="mb-3">
            <p className="font-semibold group-hover:text-cyan">{row.departmentName}</p>
            <p className="text-[11px] text-muted-foreground">
              {row.headName ? `يقودها ${row.headName}` : "بدون مسؤول"}
            </p>
          </div>

          {/* Two plain lines: how many people are active, and what needs a push */}
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <span>
                <span className="font-semibold tabular-nums">
                  {row.activeCount} من {row.headcount}
                </span>{" "}
                موظف نشط
              </span>
            </div>
            {row.stuckTasks > 0 ? (
              <div className="flex items-center gap-2 text-cc-red">
                <AlertTriangle className="size-4" />
                <span>
                  <span className="font-semibold tabular-nums">{row.stuckTasks}</span> مهمة بحاجة
                  لمتابعة
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-cc-green">
                <CheckCircle2 className="size-4" />
                <span>العمل يسير بدون تعطّل</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-end text-[11px] text-cyan opacity-0 transition-opacity group-hover:opacity-100">
            عرض الفريق <ChevronLeft className="size-3.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function TeamPulseBoard({ data }: { data: TeamPulseOverview }) {
  const t = data.totals;
  const good = data.rows.filter((r) => r.status === "good").length;
  const watch = data.rows.filter((r) => r.status === "watch").length;
  const risk = data.rows.filter((r) => r.status === "risk").length;

  // One plain headline sentence.
  const parts: string[] = [];
  if (good) parts.push(`${good} ${good === 1 ? "قسم يتحرّك جيدًا" : "أقسام تتحرّك جيدًا"}`);
  if (watch) parts.push(`${watch} ${watch === 1 ? "قسم يحتاج متابعة" : "أقسام تحتاج متابعة"}`);
  if (risk) parts.push(`${risk} ${risk === 1 ? "قسم متوقّف" : "أقسام متوقّفة"}`);
  const headline = parts.join(" · ") || "لا توجد بيانات بعد";

  return (
    <div className="space-y-4">
      {/* Headline: the whole picture in one line + the single positive number */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold">{headline}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              من يحرّك مهامه ومن توقّف الآن — اضغط على أي قسم لرؤية الموظفين.
            </p>
          </div>
          <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4">
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums text-cc-green">{t.activeCount}</p>
              <p className="text-[10px] text-muted-foreground">موظف يعمل الآن</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums text-cyan">{t.actionsToday}</p>
              <p className="text-[10px] text-muted-foreground">إجراء في رواسم اليوم</p>
            </div>
            <Link
              href="/team-activity?filter=overloaded#team-pulse-results"
              className="rounded-lg border border-cc-red/20 bg-cc-red/5 px-3 py-1.5 text-center transition-colors hover:bg-cc-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-red"
              aria-label={`${t.overloadedCount} موظف محمّل زائد. عرض الموظفين`}
            >
              <p className="text-2xl font-bold tabular-nums text-cc-red">{t.overloadedCount}</p>
              <p className="text-[10px] text-muted-foreground">موظف محمّل زائد</p>
              <p className="text-[9px] text-cc-red">
                أكثر من {data.overloadProjectsThreshold} مشاريع نشطة
              </p>
            </Link>
            <Link
              href="/team-activity?filter=late-pending#team-pulse-results"
              className="rounded-lg border border-cc-red/20 bg-cc-red/5 px-3 py-1.5 text-center transition-colors hover:bg-cc-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-red"
              aria-label={`${t.pendingLate} مهمة معلّقة متأخرة. عرض المهام`}
            >
              <p className="text-2xl font-bold tabular-nums text-cc-red">{t.pendingLate}</p>
              <p className="text-[10px] text-muted-foreground">مهمة معلّقة متأخرة</p>
              <p className="text-[9px] text-cc-red">عرض التفاصيل</p>
            </Link>
          </div>
        </CardContent>
      </Card>

      <p className="-mt-1 px-1 text-[10px] text-muted-foreground">
        آخر إجراء وارد من رواسم: <span className="text-foreground">{freshness(data.lastActionAt)}</span>
      </p>

      {data.rows.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              variant="compact"
              title="لا توجد حركة عمل بعد"
              description="يظهر النشاط تلقائيًا مع تحرّك المهام بين المراحل."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.rows.map((r) => (
            <DeptCard key={r.departmentId} row={r} />
          ))}
        </div>
      )}

      <p className="flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0 text-cyan" />
        «نشط» = قام بإجراء اليوم · «خامل» = آخر إجراء كان أمس · «غير نشط» = آخر إجراء قبل ذلك ·
        «بحاجة لمتابعة» = مهمة مفتوحة لم تتحرّك منذ ٣ أيام. جودة الالتزام بالمواعيد في صفحة{" "}
        <Link href="/accountability" className="text-cyan hover:underline">المساءلة</Link>.
      </p>
    </div>
  );
}
