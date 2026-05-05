import { PageHeaderSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function HandoverLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <CardListSkeleton rows={8} />
    </div>
  );
}
