import { StatRowSkeleton, TableSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function ClientDetailLoading() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="mb-6">
        <StatRowSkeleton count={3} />
      </div>
      <Skeleton className="mb-3 h-5 w-32" />
      <TableSkeleton rows={5} cols={5} />
    </div>
  );
}
