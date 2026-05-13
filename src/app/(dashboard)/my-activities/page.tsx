import { CalendarCheck, ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { listMyActivities } from "@/lib/data/my-activities";
import { MyActivitiesCalendar } from "./my-activities-calendar";

export const dynamic = "force-dynamic";

export default async function MyActivitiesPage() {
  // Same permission as /tasks — the surface is the same task_activities rows,
  // just filtered to the caller. No new permission key needed.
  const session = await requirePagePermission("tasks.view");
  const t = await getTranslations("MyActivitiesPage");

  if (!session.employeeId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("title")}
          description={t("missingEmployeePageDescription")}
        />
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title={t("missingEmployeeTitle")}
          description={t("missingEmployeeDescription")}
        />
      </div>
    );
  }

  const rows = await listMyActivities(session.orgId, session.employeeId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <MyActivitiesCalendar rows={rows} />
      )}
    </div>
  );
}
