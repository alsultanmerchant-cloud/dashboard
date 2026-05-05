import { PageHeaderSkeleton, StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <div className="mb-6 rounded-2xl border border-cyan/15 bg-card p-4">
        <Skeleton className="h-4 w-48 mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        <CardListSkeleton rows={3} />
        <CardListSkeleton rows={3} />
        <CardListSkeleton rows={3} />
      </div>
      <CardListSkeleton rows={5} />
    </div>
  );
}
