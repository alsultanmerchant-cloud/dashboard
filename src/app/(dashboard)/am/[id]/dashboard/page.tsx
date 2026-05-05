import Link from "next/link";
import { notFound } from "next/navigation";
import { Target, Users, AlertTriangle, CalendarClock } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAmDashboard } from "@/lib/data/contracts";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicShortDate } from "@/lib/utils-format";

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(value);
}

export default async function AmDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePagePermission("contract.view");
  const { id } = await params;
  const sp = await searchParams;
  const monthIso = typeof sp.month === "string" ? sp.month : undefined;

  // Resolve the AM employee + org-scope check.
  const { data: emp } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!emp || emp.organization_id !== session.orgId) notFound();

  const data = await getAmDashboard(emp.id, monthIso);
  const expected = Number(data.target?.expected_total ?? 0);
  const achieved = Number(data.target?.achieved_total ?? 0);
  const pct = Number(data.target?.achievement_pct ?? 0);

  return (
    <div>
      <PageHeader
        title={`لوحة ${emp.full_name}`}
        description={`المسوّق المسؤول — ملخص شهري لشهر ${formatArabicShortDate(data.month)}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard
          label="الهدف الشهري"
          value={formatCurrency(expected)}
          icon={<Target className="size-5" />}
          tone="default"
        />
        <MetricCard
          label="المُحقَّق"
          value={formatCurrency(achieved)}
          tone="success"
        />
        <MetricCard
          label="نسبة الإنجاز"
          value={`${pct.toFixed(0)}%`}
          tone={pct >= 100 ? "success" : pct >= 60 ? "info" : "warning"}
        />
        <MetricCard
          label="عقود الشهر"
          value={data.contracts.length}
          icon={<Users className="size-5" />}
          tone="default"
        />
      </div>

      <SectionTitle title="عقود الشهر حسب النوع" />
      <div className="mb-8">
        {Object.keys(data.contractsByType).length === 0 ? (
          <EmptyState
            variant="compact"
            title="لا توجد عقود في هذا الشهر"
            description="بمجرد بدء عقود جديدة ستظهر هنا."
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(data.contractsByType).map(([key, agg]) => (
              <Card key={key}>
                <CardContent className="p-3">
                  <p className="text-[11px] text-muted-foreground">{key}</p>
                  <p className="text-lg font-semibold tabular-nums">{agg.count}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(agg.value)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SectionTitle
        title="دفعات متأخرة"
        description="دفعات قيد الانتظار تجاوز موعدها المتوقَّع"
      />
      <div className="mb-8">
        {data.overdueInstallments.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<AlertTriangle className="size-6" />}
            title="لا توجد دفعات متأخرة"
            description="كل الدفعات في وقتها."
          />
        ) : (
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>العميل</DataTableHeaderCell>
                  <DataTableHeaderCell>تاريخ الاستحقاق</DataTableHeaderCell>
                  <DataTableHeaderCell>المبلغ</DataTableHeaderCell>
                  <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {data.overdueInstallments.map((i) => {
                  const cArr = i.contract as unknown as Record<string, unknown> | Record<string, unknown>[] | null;
                  const c = Array.isArray(cArr) ? cArr[0] ?? null : cArr;
                  const clRaw = c?.client as { id?: string; name?: string } | { id?: string; name?: string }[] | null | undefined;
                  const cl = Array.isArray(clRaw) ? clRaw[0] ?? null : clRaw;
                  return (
                    <DataTableRow key={i.id}>
                      <DataTableCell>
                        <Link
                          href={`/contracts/${(c?.id as string) ?? ""}`}
                          className="hover:underline"
                        >
                          {cl?.name ?? "—"}
                        </Link>
                      </DataTableCell>
                      <DataTableCell className="text-xs">
                        {formatArabicShortDate(i.expected_date)}
                      </DataTableCell>
                      <DataTableCell className="tabular-nums">
                        {formatCurrency(Number(i.expected_amount || 0))}
                      </DataTableCell>
                      <DataTableCell>{i.status}</DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataTableShell>
        )}
      </div>

      <SectionTitle
        title="اجتماعات هذا الأسبوع"
        description="دورات تحتاج اجتماع متابعة خلال الأيام السبعة القادمة"
      />
      {data.cyclesNeedingMeetingThisWeek.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={<CalendarClock className="size-6" />}
          title="لا توجد اجتماعات مطلوبة"
          description="لا توجد دورات تحتاج اجتماعًا هذا الأسبوع."
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>الدورة</DataTableHeaderCell>
                <DataTableHeaderCell>المتوقَّع</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {data.cyclesNeedingMeetingThisWeek.map((c) => {
                const ctRaw = c.contract as unknown as Record<string, unknown> | Record<string, unknown>[] | null;
                const ct = Array.isArray(ctRaw) ? ctRaw[0] ?? null : ctRaw;
                const clRaw = ct?.client as { id?: string; name?: string } | { id?: string; name?: string }[] | null | undefined;
                const cl = Array.isArray(clRaw) ? clRaw[0] ?? null : clRaw;
                return (
                  <DataTableRow key={c.id}>
                    <DataTableCell>
                      <Link
                        href={`/contracts/${(ct?.id as string) ?? ""}`}
                        className="hover:underline"
                      >
                        {cl?.name ?? "—"}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="tabular-nums">{c.cycle_no}</DataTableCell>
                    <DataTableCell className="text-xs">
                      {formatArabicShortDate(c.expected_meeting_date)}
                    </DataTableCell>
                    <DataTableCell>{c.state}</DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}
    </div>
  );
}
