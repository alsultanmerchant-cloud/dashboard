import { CardListSkeleton } from "@/components/skeletons";

export default function HandoverLoading() {
  return (
    <div>
      <CardListSkeleton rows={8} />
    </div>
  );
}
