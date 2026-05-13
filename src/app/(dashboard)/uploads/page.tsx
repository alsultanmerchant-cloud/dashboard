import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  CalendarClock,
  AlertTriangle,
  Clock,
  CalendarRange,
  CalendarDays,
  Inbox,
  ChevronLeft,
  ArrowRight,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listMyUploadQueue, type UploadQueueRow, type UploadBucket } from "@/lib/data/uploads";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard, type MetricTone } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { PriorityBadge, ServiceBadge, TaskStageBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";

const COLLAPSED_PER_BUCKET = 8;
const EXPANDED_PAGE_SIZE = 25;
const VALID_BUCKETS: UploadBucket[] = ["overdue", "today", "this_week", "later"];

type BucketDef = {
  key: UploadBucket;
  label: string;
  description: string;
  tone: MetricTone;
  icon: React.ReactNode;
  rowAccent: string;
  emptyText: string;
};

function buildBuckets(t: Awaited<ReturnType<typeof getTranslations<"UploadsPage">>>): BucketDef[] {
  return [
    {
      key: "overdue",
      label: t("buckets.overdue.label"),
      description: t("buckets.overdue.description"),
      tone: "destructive",
      icon: <AlertTriangle className="size-5" />,
      rowAccent: "border-r-2 border-cc-red/60",
      emptyText: t("buckets.overdue.empty"),
    },
    {
      key: "today",
      label: t("buckets.today.label"),
      description: t("buckets.today.description"),
      tone: "warning",
      icon: <Clock className="size-5" />,
      rowAccent: "border-r-2 border-amber/60",
      emptyText: t("buckets.today.empty"),
    },
    {
      key: "this_week",
      label: t("buckets.this_week.label"),
      description: t("buckets.this_week.description"),
      tone: "info",
      icon: <CalendarRange className="size-5" />,
      rowAccent: "border-r-2 border-cc-blue/60",
      emptyText: t("buckets.this_week.empty"),
    },
    {
      key: "later",
      label: t("buckets.later.label"),
      description: t("buckets.later.description"),
      tone: "default",
      icon: <CalendarDays className="size-5" />,
      rowAccent: "border-r-2 border-soft-2",
      emptyText: t("buckets.later.empty"),
    },
  ];
}

function formatDelta(daysDelta: number, t: Awaited<ReturnType<typeof getTranslations<"UploadsPage">>>): string {
  if (daysDelta === 0) return t("delta.today");
  if (daysDelta === -1) return t("delta.overdueOne");
  if (daysDelta === -2) return t("delta.overdueTwo");
  if (daysDelta < 0) return t("delta.overdueMany", { count: Math.abs(daysDelta) });
  if (daysDelta === 1) return t("delta.inOne");
  if (daysDelta === 2) return t("delta.inTwo");
  return t("delta.inMany", { count: daysDelta });
}

function formatShortDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function UploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; page?: string }>;
}) {
  const session = await requirePagePermission("tasks.view");
  const t = await getTranslations("UploadsPage");
  const locale = await getLocale();
  const buckets = buildBuckets(t);
  const sp = await searchParams;

  if (!session.employeeId) {
    return (
      <div>
        <PageHeader
          title={t("title")}
          description={t("description")}
        />
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title={t("specialistsOnly.title")}
          description={t("specialistsOnly.description")}
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

  const bucketParam = sp.bucket as UploadBucket | undefined;
  const expanded = bucketParam && VALID_BUCKETS.includes(bucketParam) ? bucketParam : null;
  const page = Math.max(1, Number(sp.page) || 1);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("descriptionFull")}
      />

      {/* Metric cards (also act as quick links to expanded views) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {buckets.map((b) => (
          <Link
            key={b.key}
            href={groups[b.key].length > 0 ? `/uploads?bucket=${b.key}` : "/uploads"}
            className={cn(
              "rounded-2xl transition-colors",
              expanded === b.key && "ring-1 ring-cyan/40",
              groups[b.key].length === 0 && "pointer-events-none opacity-70",
            )}
          >
            <MetricCard
              label={b.label}
              value={groups[b.key].length}
              hint={b.description}
              tone={b.tone}
              icon={b.icon}
            />
          </Link>
        ))}
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : expanded ? (
        <ExpandedBucket
          def={buckets.find((b) => b.key === expanded)!}
          rows={groups[expanded]}
          page={page}
          locale={locale}
          t={t}
        />
      ) : (
        <div className="space-y-6">
          {buckets.map((b) => (
            <BucketSection key={b.key} def={b} rows={groups[b.key]} locale={locale} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function BucketSection({
  def,
  rows,
  locale,
  t,
}: {
  def: BucketDef;
  rows: UploadQueueRow[];
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<"UploadsPage">>>;
}) {
  const visible = rows.slice(0, COLLAPSED_PER_BUCKET);
  const hidden = rows.length - visible.length;
  return (
    <section>
      <SectionTitle
        title={def.label}
        description={def.description}
        actions={
          <span className="inline-flex h-6 items-center rounded-full border border-soft-2 bg-soft-2 px-2.5 text-[11px] font-medium tabular-nums text-muted-foreground">
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
            <>
              <ul className="divide-y divide-white/[0.05]">
                {visible.map((r) => (
                  <UploadRow key={r.id} row={r} accent={def.rowAccent} locale={locale} t={t} />
                ))}
              </ul>
              {hidden > 0 && (
                <Link
                  href={`/uploads?bucket=${def.key}`}
                  className="flex items-center justify-center gap-1.5 border-t border-soft px-4 py-3 text-xs font-medium text-cyan transition-colors hover:bg-cyan-dim/30"
                >
                  {t("showAll", { count: rows.length })}
                  <ArrowRight className="size-3.5 icon-flip-rtl" />
                </Link>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ExpandedBucket({
  def,
  rows,
  page,
  locale,
  t,
}: {
  def: BucketDef;
  rows: UploadQueueRow[];
  page: number;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<"UploadsPage">>>;
}) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / EXPANDED_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * EXPANDED_PAGE_SIZE;
  const slice = rows.slice(from, from + EXPANDED_PAGE_SIZE);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title={def.label} description={def.description} />
        <Link
          href="/uploads"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className="size-3.5" />
          {t("backToAll")}
        </Link>
      </div>
      <Card>
        <CardContent className="p-0">
          {slice.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {def.emptyText}
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {slice.map((r) => (
                <UploadRow key={r.id} row={r} accent={def.rowAccent} locale={locale} t={t} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pagination total={total} pageSize={EXPANDED_PAGE_SIZE} currentPage={safePage} />
    </section>
  );
}

function UploadRow({
  row,
  accent,
  locale,
  t,
}: {
  row: UploadQueueRow;
  accent: string;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<"UploadsPage">>>;
}) {
  const isOverdue = row.days_delta < 0;
  const isToday = row.days_delta === 0;

  return (
    <li className={cn("group/row flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-soft-1 sm:flex-row sm:items-center sm:gap-4", accent)}>
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
            {t("uploadDue")}
          </div>
          <div className="text-xs font-medium tabular-nums text-foreground">
            {formatShortDate(row.upload_due_date, locale)}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium",
            isOverdue && "border-cc-red/30 bg-red-dim text-cc-red",
            isToday && "border-amber/30 bg-amber-dim text-amber",
            !isOverdue && !isToday && "border-soft-2 bg-soft-2 text-muted-foreground",
          )}
        >
          {formatDelta(row.days_delta, t)}
        </span>
      </div>

      <Link
        href={`/tasks/${row.id}`}
        aria-label={t("openTask")}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-soft-2 hover:text-foreground"
      >
        <ChevronLeft className="size-3.5 icon-flip-rtl" />
      </Link>
    </li>
  );
}
