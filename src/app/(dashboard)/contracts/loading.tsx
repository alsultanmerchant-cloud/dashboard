import { StatRowSkeleton, TableSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function ContractsLoading() {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
