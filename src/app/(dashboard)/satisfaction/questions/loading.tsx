import { CardListSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function SatisfactionQuestionsLoading() {
  return (
    <div>
      <div className="mb-4 space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CardListSkeleton rows={6} />
    </div>
  );
}
