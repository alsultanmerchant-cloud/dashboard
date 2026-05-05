import { StatRowSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function AiInsightsLoading() {
  return (
    <div>
      <div className="mb-6">
        <StatRowSkeleton count={4} />
      </div>
      <CardListSkeleton rows={8} />
    </div>
  );
}
