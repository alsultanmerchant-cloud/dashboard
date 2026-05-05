import { PageHeaderSkeleton, StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <Skeleton className="h-64 w-full mb-6 rounded-2xl" />
      <CardListSkeleton rows={5} />
    </div>
  );
}
