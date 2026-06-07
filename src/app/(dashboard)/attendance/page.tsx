import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { AttendanceForm } from "./attendance-form";

const STATUS_LABELS: Record<string, string> = {
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  remote: "عن بُعد",
  half_day: "نصف يوم",
  leave: "إجازة",
};

export default async function AttendancePage() {
  const session = await requirePagePermission("attendance.view");
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: members }, { data: records }] = await Promise.all([
    supabaseAdmin
      .from("employee_profiles")
      .select("id, full_name")
      .eq("organization_id", session.orgId)
      .order("full_name", { ascending: true }),
    supabaseAdmin
      .from("attendance_records")
      .select("id, work_date, status, late_minutes, note, employee:employee_profiles!attendance_records_employee_profile_id_fkey(full_name)")
      .eq("organization_id", session.orgId)
      .order("work_date", { ascending: false })
      .limit(50),
  ]);

  return (
    <div>
      <PageHeader title="الحضور والانصراف" description="تسجيل ومتابعة حضور أعضاء الفرق" />

      <Card className="mb-6">
        <CardContent className="p-4">
          <AttendanceForm members={members ?? []} today={today} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {(records ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState variant="compact" title="لا توجد سجلات بعد" description="" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">الموظف</th>
                    <th className="px-3 py-2.5 font-medium">التاريخ</th>
                    <th className="px-3 py-2.5 font-medium">الحالة</th>
                    <th className="px-3 py-2.5 font-medium">تأخير (د)</th>
                    <th className="px-3 py-2.5 font-medium">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {(records ?? []).map((r) => {
                    const emp = Array.isArray(r.employee) ? r.employee[0] : r.employee;
                    return (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-soft-1">
                        <td className="px-3 py-2.5 font-medium">{emp?.full_name ?? "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums">{r.work_date}</td>
                        <td className="px-3 py-2.5">{STATUS_LABELS[r.status] ?? r.status}</td>
                        <td className="px-3 py-2.5 tabular-nums">{r.late_minutes ?? 0}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{r.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
