import { StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function SalesLoading() {
  return (
    <div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <CardListSkeleton rows={6} />
    </div>
  );
}
