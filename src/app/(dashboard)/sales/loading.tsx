import { PageHeaderSkeleton, StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function SalesLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <CardListSkeleton rows={6} />
    </div>
  );
}
