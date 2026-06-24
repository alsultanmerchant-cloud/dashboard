import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { FailuresList } from "@/components/performance/failures-list";
import { getMyFailures } from "@/lib/data/my-performance";

// "Learn from your delays" — interactive list; each row opens an AI post-mortem
// lesson modal. AI-token heavy per employee, so it's reserved for heads (people
// overseeing many tasks who can't drill task-by-task), not every agent.
export async function FailuresSection({
  orgId,
  employeeId,
}: {
  orgId: string;
  employeeId: string;
}) {
  const [items, t] = await Promise.all([
    getMyFailures(orgId, employeeId),
    getTranslations("MyPerformance"),
  ]);
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState variant="compact" title={t("failures.empty")} description="" />
        </CardContent>
      </Card>
    );
  }
  return <FailuresList items={items} />;
}
