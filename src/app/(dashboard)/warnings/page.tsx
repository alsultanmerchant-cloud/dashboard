import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { WarningForm } from "./warning-form";

const SEVERITY_LABELS: Record<string, string> = {
  verbal: "شفهي",
  written: "كتابي",
  final: "نهائي",
  suspension: "إيقاف",
};

export default async function WarningsPage() {
  const session = await requirePagePermission("warning.view");

  const [{ data: members }, { data: warnings }] = await Promise.all([
    supabaseAdmin
      .from("employee_profiles")
      .select("id, full_name")
      .eq("organization_id", session.orgId)
      .order("full_name", { ascending: true }),
    supabaseAdmin
      .from("employee_warnings")
      .select("id, severity, reason, issued_at, acknowledged_at, employee:employee_profiles!employee_warnings_employee_profile_id_fkey(full_name)")
      .eq("organization_id", session.orgId)
      .order("issued_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div>
      <PageHeader title="الإنذارات" description="إصدار ومتابعة الإنذارات للموظفين" />

      <Card className="mb-6">
        <CardContent className="p-4">
          <WarningForm members={members ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {(warnings ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState variant="compact" title="لا توجد إنذارات" description="" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">الموظف</th>
                    <th className="px-3 py-2.5 font-medium">الدرجة</th>
                    <th className="px-3 py-2.5 font-medium">السبب</th>
                    <th className="px-3 py-2.5 font-medium">التاريخ</th>
                    <th className="px-3 py-2.5 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {(warnings ?? []).map((w) => {
                    const emp = Array.isArray(w.employee) ? w.employee[0] : w.employee;
                    return (
                      <tr key={w.id} className="border-b border-border/50 hover:bg-soft-1">
                        <td className="px-3 py-2.5 font-medium">{emp?.full_name ?? "—"}</td>
                        <td className="px-3 py-2.5">{SEVERITY_LABELS[w.severity] ?? w.severity}</td>
                        <td className="px-3 py-2.5">{w.reason}</td>
                        <td className="px-3 py-2.5 tabular-nums">{w.issued_at?.slice(0, 10)}</td>
                        <td className="px-3 py-2.5">
                          {w.acknowledged_at ? (
                            <span className="text-cc-green">مستلَم</span>
                          ) : (
                            <span className="text-amber">معلّق</span>
                          )}
                        </td>
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
