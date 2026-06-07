import { requirePagePermission } from "@/lib/auth-server";
import { getTeamActivityOverview, getEmployeeEpisodes } from "@/lib/data/activity-scores";
import { PageHeader } from "@/components/page-header";
import { TeamActivityBoard } from "@/components/activity/team-activity-board";
import { EpisodeTimeline } from "@/components/activity/episode-timeline";

// CEO "نبض الفريق" — per-employee activity/audit board. Gated to executive
// roles (reports.view: owner/admin/manager/viewer); agents never reach it.
export default async function TeamActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string }>;
}) {
  const session = await requirePagePermission("reports.view");
  const { emp } = await searchParams;
  const data = await getTeamActivityOverview(session.orgId);

  const selected = emp ? data.rows.find((r) => r.employeeId === emp) : undefined;
  const episodes = selected ? await getEmployeeEpisodes(session.orgId, selected.employeeId) : [];

  return (
    <div>
      <PageHeader
        title="نبض الفريق"
        description="نشاط كل موظف مقابل واجباته في سير العمل — من نشِط ومن متوقف ولماذا"
      />
      {selected && <EpisodeTimeline employeeName={selected.fullName} episodes={episodes} />}
      <TeamActivityBoard data={data} />
    </div>
  );
}
