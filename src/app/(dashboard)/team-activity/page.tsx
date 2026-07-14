import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getTeamPulseOverview,
  getTeamMembers,
  getAllMembersByActivity,
  getPendingLateTasks,
} from "@/lib/data/team-pulse";
import { PageHeader } from "@/components/page-header";
import { TeamPulseBoard } from "@/components/activity/team-pulse-board";
import { TeamPulseMembers } from "@/components/activity/team-pulse-members";
import { TeamPulseAllMembers } from "@/components/activity/team-pulse-all-members";
import type { TeamMemberFilter } from "@/components/activity/team-pulse-all-members";
import { TeamPulseLateTasks } from "@/components/activity/team-pulse-late-tasks";
import { Card, CardContent } from "@/components/ui/card";

async function AllMembersSection({
  orgId,
  filter,
  overloadProjectsThreshold,
}: {
  orgId: string;
  filter: TeamMemberFilter;
  overloadProjectsThreshold: number;
}) {
  const allMembers = await getAllMembersByActivity(orgId);
  return (
    <TeamPulseAllMembers
      members={allMembers}
      filter={filter}
      overloadProjectsThreshold={overloadProjectsThreshold}
    />
  );
}

function AllMembersSkeleton() {
  return (
    <Card className="mt-6">
      <CardContent className="p-4">
        <div className="h-4 w-48 animate-pulse rounded bg-soft-2" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-soft-1" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// CEO "نبض الفريق" — team-performance board. Two axes grounded in the data
// the org actually produces: operational delivery (accountability engine on
// the Odoo stage-history mirror) + commercial attainment (contract income
// targets). Org → department rollup with per-department drill-down. Gated to
// executive roles (reports.view). Replaces the dead employee_activity_daily
// instrumentation feed; see src/lib/data/team-pulse.ts.
export default async function TeamActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; filter?: string }>;
}) {
  const session = await requirePagePermission("reports.view");
  const { dept, filter: rawFilter } = await searchParams;
  const filter: TeamMemberFilter =
    rawFilter === "overloaded" ? "overloaded" : rawFilter === "available" ? "available" : "all";
  const showLatePending = rawFilter === "late-pending";
  const data = await getTeamPulseOverview(session.orgId);

  const selected = !showLatePending && dept ? data.rows.find((r) => r.departmentId === dept) : undefined;
  const members = selected ? await getTeamMembers(session.orgId, selected.departmentId) : [];
  const lateTasks = showLatePending ? await getPendingLateTasks(session.orgId) : [];

  return (
    <div>
      <PageHeader
        title="نبض الفريق"
        description="حركة العمل ونشاط الفِرق — من يحرّك مهامه الآن ومن توقّف، وأين تتكدّس المهام المتوقّفة. (جودة الالتزام بالمواعيد في صفحة المساءلة)"
      />
      {selected ? (
        <TeamPulseMembers
          departmentName={selected.departmentName}
          headName={selected.headName}
          members={members}
        />
      ) : null}
      <TeamPulseBoard data={data} />
      {showLatePending ? (
        <TeamPulseLateTasks tasks={lateTasks} />
      ) : (
        <Suspense fallback={<AllMembersSkeleton />}>
          <AllMembersSection
            orgId={session.orgId}
            filter={filter}
            overloadProjectsThreshold={data.overloadProjectsThreshold}
          />
        </Suspense>
      )}
    </div>
  );
}
