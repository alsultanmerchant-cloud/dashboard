import { CardListSkeleton } from "@/components/skeletons";

export default function FeatureFlagsLoading() {
  return (
    <div>
      <CardListSkeleton rows={3} />
    </div>
  );
}
