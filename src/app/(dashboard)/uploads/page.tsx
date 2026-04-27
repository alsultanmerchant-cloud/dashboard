import Link from "next/link";
import {
  CalendarClock,
  AlertTriangle,
  Clock,
  CalendarRange,
  CalendarDays,
  Inbox,
  ChevronLeft,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listMyUploadQueue, type UploadQueueRow, type UploadBucket } from "@/lib/data/uploads";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard, type MetricTone } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge, ServiceBadge, TaskStageBadge } from "@/components/status-badges";
import { formatArabicShortDate } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

type BucketDef = {
  key: UploadBucket;
  label: string;
  description: string;
  tone: MetricTone;
  icon: React.ReactNode;
  rowAccent: string;
  emptyText: string;
};

const BUCKETS: BucketDef[] = [
  {
    key: "overdue",
    label: "متأخر",
    description: "مهام تجاوز موعد رفعها وما زالت غير مكتملة",
    tone: "destructive",
    icon: <AlertTriangle className="size-5" />,
    rowAccent: "border-r-2 border-cc-red/60",
    emptyText: "لا توجد مهام متأخرة عن موعد الرفع.",
  },
  {
    key: "today",
    label: "اليوم",
    description: "يجب رفعها قبل نهاية اليوم",
    tone: "warning",
    icon: <Clock className="size-5" />,
    rowAccent: "border-r-2 border-amber/60",
    emptyText: "لا توجد مهام يجب رفعها اليوم.",
  },
  {
    key: "this_week",
    label: "خلال أسبوع",
    description: "مهام يستحق رفعها خلال السبعة أيام القادمة",
    tone: "info",
    icon: <CalendarRange className="size-5" />,
    rowAccent: "border-r-2 border-cc-blue/60",
    emptyText: "لا شيء على جدول الأسبوع المقبل.",
  },
  {
    key: "later",
    label: "لاحقًا",
    description: "مهام موعد رفعها بعد أكثر من أسبوع",
    tone: "default",
    icon: <CalendarDays className="size-5" />,
    rowAccent: "border-r-2 border-white/10",
    emptyText: "لا توجد مهام مجدولة لاحقًا.",
  },
];

function formatDelta(daysDelta: number): string {
  if (daysDelta === 0) return "اليوم";
  if (daysDelta === -1) return "متأخر يوم واحد";
  if (daysDelta === -2) return "متأخر يومين";
  if (daysDelta < 0) return `متأخر ${Math.abs(daysDelta)} أيام`;
  if (daysDelta === 1) return "بعد يوم";
  if (daysDelta === 2) return "بعد يومين";
  return `بعد ${daysDelta} أيام`;
}

export default async function UploadsPage() {
  const session = await requirePagePermission("tasks.view");

  if (!session.employeeId) {
    return (
      <div>
        <PageHeader
          title="اليوم — رفع المهام"
          description="قائمة المهام التي يجب على المختص رفعها قبل الديدلاين."
        />
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="هذه الصفحة مخصصة للمختصين"
          description="تظهر هنا المهام المسندة إليك في خانة المختص. لا يبدو أن لديك ملف موظف مرتبط بحسابك حاليًا."
        />
      </div>
    );
  }

  const rows = await listMyUploadQueue(session.orgId, session.employeeId);

  const groups: Record<UploadBucket, UploadQueueRow[]> = {
    overdue: [],
    today: [],
    this_week: [],
    later: [],
  };
  for (const r of rows) groups[r.bucket].push(r);

  const total = rows.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="اليوم — رفع المهام"
        description="مهامك كمختص مرتبة بحسب موعد الرفع. يُحسب الموعد بطرح فترة الرفع المسبقة من الديدلاين كما في دليل عمليات Sky Light."
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {BUCKETS.map((b) => (
          <MetricCard
            key={b.key}
            label={b.label}
            value={groups[b.key].length}
            hint={b.description}
            tone={b.tone}
            icon={b.icon}
          />
        ))}
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="لا توجد مهام تنتظر الرفع"
          description="عندما تُسند إليك مهمة كمختص وتقترب من الديدلاين، ستظهر هنا تلقائيًا."
        />
      ) : (
        <div className="space-y-6">
          {BUCKETS.map((b) => (
            <BucketSection key={b.key} def={b} rows={groups[b.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

function BucketSection({ def, rows }: { def: BucketDef; rows: UploadQueueRow[] }) {
  return (
    <section>
      <SectionTitle
        title={def.label}
        description={def.description}
        actions={
          <span className="inline-flex h-6 items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        }
      />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {def.emptyText}
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {rows.map((r) => (
                <UploadRow key={r.id} row={r} accent={def.rowAccent} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function UploadRow({ row, accent }: { row: UploadQueueRow; accent: string }) {
  const isOverdue = row.days_delta < 0;
  const isToday = row.days_delta === 0;

  return (
    <li className={cn("group/row flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-4", accent)}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/tasks/${row.id}`}
            className="text-sm font-medium text-foreground transition-colors hover:text-cyan"
          >
            {row.title}
          </Link>
          <TaskStageBadge stage={row.stage} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {row.project ? (
            <Link
              href={`/projects/${row.project.id}`}
              className="hover:text-foreground transition-colors"
            >
              {row.project.name}
            </Link>
          ) : (
            <span>—</span>
          )}
          {row.project?.client_name && (
            <>
              <span className="opacity-40">·</span>
              <span>{row.project.client_name}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {row.service && <ServiceBadge slug={row.service.slug} name={row.service.name} />}
        <PriorityBadge priority={row.priority} />
      </div>

      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center sm:gap-1">
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            موعد الرفع
          </div>
          <div className="text-xs font-medium tabular-nums text-foreground">
            {formatArabicShortDate(row.upload_due_date)}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium",
            isOverdue && "border-cc-red/30 bg-red-dim text-cc-red",
            isToday && "border-amber/30 bg-amber-dim text-amber",
            !isOverdue && !isToday && "border-white/10 bg-white/[0.04] text-muted-foreground",
          )}
        >
          {formatDelta(row.days_delta)}
        </span>
      </div>

      <Link
        href={`/tasks/${row.id}`}
        aria-label="فتح المهمة"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <ChevronLeft className="size-3.5 icon-flip-rtl" />
      </Link>
    </li>
  );
}
