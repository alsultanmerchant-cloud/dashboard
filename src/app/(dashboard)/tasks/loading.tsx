import { PageHeaderSkeleton, StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function TasksLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <CardListSkeleton rows={8} />
    </div>
  );
}
