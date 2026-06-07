import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Skeleton } from "@/components/ui/skeleton";
import type { ServerSession, DashboardScope } from "@/lib/auth-server";
import {
  getDepartmentTeamSummary,
  getDepartmentTaskCounts,
  getDepartmentScores,
  getDepartmentCapacity,
  getDepartmentStuckStages,
  getDepartmentEscalations,
  getDepartmentSubtaskUploadDelay,
  getEmployeePerformance,
  getMonthlyClosing,
  getMonthlyClosingMonths,
  type DeptScope,
} from "@/lib/data/department";
import {
  DepartmentOverviewHeader,
  DepartmentTaskCounts,
  DepartmentKpiBand,
  DepartmentCapacity,
  DepartmentStuckStages,
  DepartmentEscalations,
  DepartmentSubtaskUpload,
} from "@/components/department/department-sections";
import { EmployeePerformanceTable } from "@/components/department/employee-performance-table";
import { MonthlyClosing } from "@/components/department/monthly-closing";

type HeadOrLead = Extract<DashboardScope, { kind: "head" | "team_lead" }>;

function toDeptScope(scope: HeadOrLead): DeptScope {
  return {
    orgId: "", // filled by caller via session
    departmentId: scope.departmentId,
    memberEmployeeIds: scope.memberEmployeeIds,
  };
}

function firstOfThisMonth(): string {
  const now = new Date();
  const m = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${m}-01`;
}

// ---- Section wrappers ----------------------------------------------------

async function OverviewHeader({ scope, departmentName }: { scope: DeptScope; departmentName: string }) {
  const summary = await getDepartmentTeamSummary(scope);
  return <DepartmentOverviewHeader departmentName={departmentName} summary={summary} />;
}

async function TaskCounts({ scope }: { scope: DeptScope }) {
  const counts = await getDepartmentTaskCounts(scope);
  return <DepartmentTaskCounts counts={counts} />;
}

async function KpiBand({ scope }: { scope: DeptScope }) {
  const scores = await getDepartmentScores(scope);
  return <DepartmentKpiBand scores={scores} />;
}

async function Capacity({ scope }: { scope: DeptScope }) {
  const rows = await getDepartmentCapacity(scope);
  return <DepartmentCapacity rows={rows} />;
}

async function StuckStages({ scope }: { scope: DeptScope }) {
  const info = await getDepartmentStuckStages(scope);
  return <DepartmentStuckStages info={info} />;
}

async function Escalations({ scope }: { scope: DeptScope }) {
  const rows = await getDepartmentEscalations(scope);
  return <DepartmentEscalations rows={rows} />;
}

async function SubtaskUpload({ scope }: { scope: DeptScope }) {
  const stats = await getDepartmentSubtaskUploadDelay(scope);
  return <DepartmentSubtaskUpload stats={stats} />;
}

async function EmployeePerformance({ scope }: { scope: DeptScope }) {
  const rows = await getEmployeePerformance(scope);
  return <EmployeePerformanceTable rows={rows} />;
}

async function MonthlyClosingSection({
  scope,
  month,
}: {
  scope: DeptScope;
  month: string;
}) {
  const [data, months] = await Promise.all([
    getMonthlyClosing(scope.orgId, scope.departmentId, month),
    getMonthlyClosingMonths(scope.orgId, scope.departmentId),
  ]);
  return <MonthlyClosing data={data} months={months} selectedMonth={month} />;
}

// ---- Composition root ----------------------------------------------------

export function DepartmentDashboard({
  session,
  scope,
  canMonthlyClosing,
  month,
}: {
  session: ServerSession;
  scope: HeadOrLead;
  canMonthlyClosing: boolean;
  month?: string;
}) {
  const deptScope: DeptScope = { ...toDeptScope(scope), orgId: session.orgId };
  const departmentName =
    scope.kind === "head" ? scope.departmentName : session.jobTitle ?? "فريقي";
  const selectedMonth = month ?? firstOfThisMonth();

  const title = scope.kind === "head" ? "لوحة رئيس القسم" : "لوحة قائد الفريق";
  const description =
    scope.kind === "head"
      ? `نظرة شاملة على أداء ${departmentName} وأعضائه`
      : "نظرة على أداء فريقك المباشر";

  return (
    <div>
      <PageHeader title={`${title} · مرحبًا ${session.fullName}`} description={description} />

      {/* Section A — Department Overview */}
      <Suspense fallback={<Skeleton className="mb-6 h-[150px] rounded-2xl" />}>
        <OverviewHeader scope={deptScope} departmentName={departmentName} />
      </Suspense>

      <Suspense fallback={<Skeleton className="mb-6 h-[88px] rounded-2xl" />}>
        <TaskCounts scope={deptScope} />
      </Suspense>

      <Suspense fallback={<Skeleton className="mb-6 h-[110px] rounded-2xl" />}>
        <KpiBand scope={deptScope} />
      </Suspense>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<Skeleton className="h-[300px] rounded-2xl" />}>
          <Capacity scope={deptScope} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-[300px] rounded-2xl" />}>
          <StuckStages scope={deptScope} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-[300px] rounded-2xl" />}>
          <Escalations scope={deptScope} />
        </Suspense>
      </div>

      <div className="mb-8">
        <Suspense fallback={<Skeleton className="h-[100px] rounded-2xl" />}>
          <SubtaskUpload scope={deptScope} />
        </Suspense>
      </div>

      {/* Section B — Employee Performance */}
      <section className="mb-10">
        <SectionTitle title="أداء الموظفين" description="مؤشرات تفصيلية لكل عضو في الفريق" />
        <Suspense fallback={<Skeleton className="h-[220px] rounded-2xl" />}>
          <EmployeePerformance scope={deptScope} />
        </Suspense>
      </section>

      {/* Section C — Monthly Closing (Head only) */}
      {canMonthlyClosing && (
        <section className="mb-10">
          <SectionTitle title="الإقفال الشهري" description="ملخص شهري لكل موظف مع المقارنة بالأهداف" />
          <Suspense fallback={<Skeleton className="h-[260px] rounded-2xl" />}>
            <MonthlyClosingSection scope={deptScope} month={selectedMonth} />
          </Suspense>
        </section>
      )}
    </div>
  );
}
