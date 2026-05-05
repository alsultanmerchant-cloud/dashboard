import { PageHeaderSkeleton, StatRowSkeleton, TableSkeleton } from "@/components/skeletons";

export default function FinanceLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
