import { requirePagePermission } from "@/lib/auth-server";
import { getTeamPulseOverview, getTeamMembers } from "@/lib/data/team-pulse";
import { PageHeader } from "@/components/page-header";
import { TeamPulseBoard } from "@/components/activity/team-pulse-board";
import { TeamPulseMembers } from "@/components/activity/team-pulse-members";

// CEO "نبض الفريق" — team-performance board. Two axes grounded in the data
// the org actually produces: operational delivery (accountability engine on
// the Odoo stage-history mirror) + commercial attainment (contract income
// targets). Org → department rollup with per-department drill-down. Gated to
// executive roles (reports.view). Replaces the dead employee_activity_daily
// instrumentation feed; see src/lib/data/team-pulse.ts.
export default async function TeamActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const session = await requirePagePermission("reports.view");
  const { dept } = await searchParams;
  const data = await getTeamPulseOverview(session.orgId);

  const selected = dept ? data.rows.find((r) => r.departmentId === dept) : undefined;
  const members = selected ? await getTeamMembers(session.orgId, selected.departmentId) : [];

  return (
    <div>
      <PageHeader
        title="نبض الفريق"
        description="أداء كل قسم وكل موظف مقابل المعيار التشغيلي وأهداف العقود — من يسير على المسار ومن يتعثّر ولماذا"
      />
      {selected && (
        <TeamPulseMembers
          departmentName={selected.departmentName}
          headName={selected.headName}
          members={members}
        />
      )}
      <TeamPulseBoard data={data} />
    </div>
  );
}
