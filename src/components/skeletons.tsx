import { Skeleton } from "@/components/ui/skeleton";

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}

export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-cyan/15 bg-card p-4">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-soft bg-card p-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-soft bg-card">
      <div className="grid border-b border-soft bg-soft-1 p-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-3/4" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid border-b border-soft p-3 last:border-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5 w-[80%]" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ToolbarSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: items }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-28" />
      ))}
    </div>
  );
}

export function DashboardOverviewSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <div className="mb-6 rounded-2xl border border-cyan/15 bg-card p-4">
        <Skeleton className="mb-3 h-4 w-48" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <CardListSkeleton rows={3} />
        <CardListSkeleton rows={3} />
        <CardListSkeleton rows={3} />
      </div>
      <CardListSkeleton rows={5} />
    </div>
  );
}

export function ExecutiveDashboardSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />

      <Skeleton className="mb-8 h-[360px] rounded-2xl" />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[150px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-3 h-[132px] rounded-2xl" />
      </div>

      <div className="mb-8 space-y-3">
        <div className="grid gap-3 lg:grid-cols-[1.15fr_2fr]">
          <Skeleton className="h-[220px] rounded-2xl" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-[220px] rounded-2xl" />
            <Skeleton className="h-[220px] rounded-2xl" />
            <Skeleton className="h-[220px] rounded-2xl" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[120px] rounded-2xl" />
          ))}
        </div>
      </div>

      <Skeleton className="mb-8 h-[88px] rounded-2xl" />

      <div className="space-y-8">
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
        <div>
          <Skeleton className="mb-3 h-5 w-48" />
          <Skeleton className="h-[260px] rounded-2xl" />
        </div>
        <div>
          <Skeleton className="mb-3 h-5 w-48" />
          <Skeleton className="h-[320px] rounded-2xl" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[180px] rounded-2xl" />
          <Skeleton className="h-[180px] rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function CollectionPageSkeleton({
  filterCount = 3,
  statCount = 4,
  rows = 6,
}: {
  filterCount?: number;
  statCount?: number;
  rows?: number;
}) {
  return (
    <div>
      <PageHeaderSkeleton />
      <ToolbarSkeleton items={filterCount} />
      <div className="mb-6">
        <StatRowSkeleton count={statCount} />
      </div>
      <CardListSkeleton rows={rows} />
    </div>
  );
}

export function TablePageSkeleton({
  filterCount = 2,
  statCount = 4,
  rows = 8,
  cols = 5,
}: {
  filterCount?: number;
  statCount?: number;
  rows?: number;
  cols?: number;
}) {
  return (
    <div>
      <PageHeaderSkeleton />
      <ToolbarSkeleton items={filterCount} />
      <div className="mb-6">
        <StatRowSkeleton count={statCount} />
      </div>
      <TableSkeleton rows={rows} cols={cols} />
    </div>
  );
}

export function FeedPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <PageHeaderSkeleton />
      <CardListSkeleton rows={rows} />
    </div>
  );
}

export function MessagesInboxSkeleton() {
  return (
    <div className="min-h-[calc(100dvh-8.5rem)]">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[28px] border border-soft bg-card/70 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)]">
        <div className="grid h-full min-h-[640px] flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-e border-soft bg-muted/35 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-32" />
              </div>
              <Skeleton className="h-12 w-16 rounded-2xl" />
            </div>
            <Skeleton className="mb-4 h-12 w-full rounded-2xl" />
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-soft bg-card/70 p-3">
                  <div className="flex items-start gap-3">
                    <Skeleton className="size-12 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-11/12" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-background/55">
            <div className="border-b border-soft bg-card/60 px-5 py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Skeleton className="h-8 w-32 rounded-full" />
                <Skeleton className="h-8 w-28 rounded-full" />
              </div>
            </div>

            <div className="flex-1 space-y-4 px-5 py-5">
              <div className="mx-auto w-full max-w-3xl space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={i % 2 === 0 ? "flex justify-start" : "flex justify-end"}>
                    <Skeleton className={i % 2 === 0 ? "h-20 w-64 rounded-[22px]" : "h-20 w-72 rounded-[22px]"} />
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-soft bg-card/70 p-4">
              <div className="rounded-[26px] border border-soft bg-background/70 p-3">
                <div className="flex items-end gap-3">
                  <Skeleton className="size-11 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-11 w-24 rounded-full" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function FormPageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        <div className="rounded-2xl border border-soft bg-card p-5">
          <Skeleton className="mb-5 h-5 w-40" />
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            ))}
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-soft bg-card p-5">
            <Skeleton className="mb-3 h-5 w-32" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
          <div className="rounded-2xl border border-soft bg-card p-5">
            <Skeleton className="mb-3 h-5 w-36" />
            <CardListSkeleton rows={3} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectBoardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-80" />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-full border border-cyan/15 bg-card/70 px-4 py-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-7 w-12" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-full border border-soft bg-card/70 px-4 py-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-7 w-10" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-soft bg-card/60 p-3">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-80 rounded-xl" />
          <Skeleton className="ms-auto h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-soft bg-card">
              <div className="h-1.5 w-full bg-cyan/25" />
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-14 rounded-full" />
                    <Skeleton className="h-5 w-5 rounded-full" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Skeleton className="h-2.5 w-full rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>

                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <Skeleton key={j} className="h-8 w-40 rounded-lg" />
                  ))}
                </div>

                <div className="grid gap-2 pt-2">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <div key={j} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-soft pt-3">
                  <Skeleton className="h-4 w-16" />
                  <div className="flex items-center gap-1">
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="size-7 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProjectsOverviewBadgesSkeleton() {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="h-3 w-44" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-full border border-cyan/15 bg-card/70 px-4 py-4"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-full border border-soft bg-card/70 px-4 py-4"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-7 w-10" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TasksWorkspaceSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-soft bg-card/60 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-44 rounded-full" />
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-soft bg-card p-3">
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="h-28 rounded-2xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-64 rounded-xl" />
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="ms-auto h-9 w-28 rounded-xl" />
      </div>

      <Skeleton className="h-12 w-full rounded-2xl" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-20 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-9 w-[22rem] max-w-full" />
            <Skeleton className="size-6 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>

      <Skeleton className="h-80 w-full rounded-2xl" />

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-28 rounded-full" />
        ))}
      </div>

      <Skeleton className="h-24 w-full rounded-2xl" />

      <Skeleton className="h-28 w-full rounded-2xl" />

      <div>
        <div className="mb-3 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-52 w-full rounded-2xl" />
      </div>

      <div>
        <div className="mb-3 space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-[32rem] w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function AnalyticsPageSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6 rounded-2xl border border-cyan/15 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
      </div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div className="mb-3 space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3 w-80" />
            </div>
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrgChartSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-5 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-36 rounded-xl" />
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-soft bg-card p-5">
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <CardListSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-9 w-72 rounded-xl" />
        <Skeleton className="ms-auto h-9 w-32 rounded-xl" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
          <CardListSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}

export function ProjectGanttSkeleton() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="rounded-2xl border border-soft bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-40 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
          <Skeleton className="ms-auto h-9 w-32 rounded-xl" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="h-[560px] rounded-2xl" />
          <Skeleton className="h-[560px] rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
