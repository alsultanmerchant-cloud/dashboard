import { StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function HRLoading() {
  return (
    <div>
      <div className="mb-6">
        <StatRowSkeleton count={3} />
      </div>
      <CardListSkeleton rows={6} />
    </div>
  );
}
