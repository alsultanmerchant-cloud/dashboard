import { PageHeaderSkeleton, StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function EscalationsLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-6">
        <StatRowSkeleton count={3} />
      </div>
      <CardListSkeleton rows={6} />
    </div>
  );
}
