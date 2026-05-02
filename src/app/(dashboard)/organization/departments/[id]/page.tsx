import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Crown, Shield, Users, Building } from "lucide-react";
import {
  requirePagePermission,
  hasPermission,
} from "@/lib/auth-server";
import { loadOrgChart } from "@/lib/data/org-chart";
import { copy } from "@/lib/copy";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DepartmentAdminPanel } from "./admin-panel";

export const dynamic = "force-dynamic";

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("employees.view");
  const { id } = await params;
  const chart = await loadOrgChart(session.orgId);
  const dept = chart.byId.get(id);
  if (!dept) notFound();

  const canEdit = hasPermission(session, "org.manage_structure");

  // Build user list for the picker (org-scoped, has user_id, employed).
  const candidates = chart.employees
    .filter((e) => e.user_id && e.employment_status === "active")
    .map((e) => ({
      user_id: e.user_id!,
      employee_id: e.id,
      full_name: e.full_name,
      job_title: e.job_title,
      department_id: e.department_id,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));

  return (
    <div className="space-y-6">
      <PageHeader
        title={dept.name}
        description={dept.description ?? undefined}
        breadcrumbs={[
          { label: "المنظمة" },
          { label: copy.organization.chartTitle, href: "/organization/chart" },
          { label: dept.name },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Crown className="size-3.5" />
              {copy.organization.head}
            </div>
            {dept.head ? (
              <div>
                <p className="font-semibold text-foreground">{dept.head.full_name}</p>
                {dept.head.job_title && (
                  <p className="text-xs text-muted-foreground">{dept.head.job_title}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">{copy.organization.noHead}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="size-3.5" />
              {copy.organization.teamLeads}
            </div>
            {dept.teamLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                {copy.organization.noTeamLeads}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {dept.teamLeads.map((l) => (
                  <Badge key={l.id} variant="secondary">
                    {l.full_name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="size-3.5" />
              {copy.organization.members}
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {dept.members.length + dept.teamLeads.length + (dept.head ? 1 : 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="size-4 text-cyan" />
            {copy.organization.members}
          </div>
          {dept.members.length === 0 ? (
            <EmptyState
              icon={<Building className="size-6" />}
              title={copy.organization.noMembers}
              description={dept.description ?? undefined}
              variant="compact"
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {dept.members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-foreground truncate">
                      {m.full_name}
                    </p>
                    {m.job_title && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {m.job_title}
                      </p>
                    )}
                  </div>
                  {m.position && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {copy.organization.positions[
                        m.position as keyof typeof copy.organization.positions
                      ] ?? m.position}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canEdit ? (
        <DepartmentAdminPanel
          departmentId={dept.id}
          departmentName={dept.name}
          currentHeadUserId={dept.head?.user_id ?? null}
          currentTeamLeadUserIds={dept.teamLeads
            .map((l) => l.user_id)
            .filter((u): u is string => !!u)}
          candidates={candidates}
        />
      ) : (
        <Card className="bg-card/40 border-dashed">
          <CardContent className="p-4 text-xs text-muted-foreground">
            {copy.organization.departmentDetail.mustHavePerm}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Link
          href="/organization/chart"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan transition-colors"
        >
          <ChevronRight className="size-3 icon-flip-rtl" />
          {copy.organization.departmentDetail.backToChart}
        </Link>
      </div>
    </div>
  );
}
