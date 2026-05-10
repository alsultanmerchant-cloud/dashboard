import { CalendarCheck, ClipboardList } from "lucide-react";
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

  if (!session.employeeId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="أنشطتي"
          description="تذكيرات ومواعيد جدولتها لنفسك من المهام (مكالمات، مراجعات، رفع تصاميم…)"
        />
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title="لا يوجد ملف موظف مرتبط"
          description="هذه الصفحة تعرض أنشطة الموظف المسجل دخوله. اربط ملف موظفك أولاً."
        />
      </div>
    );
  }

  const rows = await listMyActivities(session.orgId, session.employeeId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="أنشطتي"
        description="تذكيرات ومواعيد جدولتها لنفسك من المهام. تطابق نمط mail.activity في Odoo (Rwasem) ولكن خاصة بك."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-6" />}
          title="لا توجد أنشطة مجدولة لك"
          description="من صفحة أي مهمة، تبويب «أنشطة مجدولة»، يمكنك إضافة مكالمة، مراجعة، أو رفع — وستظهر هنا."
        />
      ) : (
        <MyActivitiesCalendar rows={rows} />
      )}
    </div>
  );
}
