import { PageHeaderSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function FeatureFlagsLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <CardListSkeleton rows={3} />
    </div>
  );
}
