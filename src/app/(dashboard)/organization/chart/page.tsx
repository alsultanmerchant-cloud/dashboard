import Link from "next/link";
import { Network, Users, Crown, Shield } from "lucide-react";
import { requirePagePermission, getServerSession } from "@/lib/auth-server";
import { isFlagOn } from "@/lib/feature-flags";
import {
  loadOrgChart,
  filterSalesSubtree,
  type OrgChart,
  type OrgDepartment,
} from "@/lib/data/org-chart";
import { copy } from "@/lib/copy";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartViews } from "./chart-views";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  account_management: "إدارة الحسابات",
  group: "مجموعة",
  main_section: "قسم أساسي",
  supporting_section: "قسم مساند",
  quality_control: "الجودة",
  other: "إداري / مساند",
};

const POSITION_LABEL = copy.organization.positions;

function PersonChip({
  name,
  position,
  jobTitle,
  variant = "member",
}: {
  name: string;
  position: string | null;
  jobTitle: string | null;
  variant?: "head" | "lead" | "member";
}) {
  const styles = {
    head: "bg-amber-500/10 text-amber-100 ring-amber-500/30",
    lead: "bg-cyan/10 text-cyan ring-cyan/30",
    member: "bg-card/60 text-foreground ring-border/50",
  } as const;
  const positionLabel =
    position && position in POSITION_LABEL
      ? POSITION_LABEL[position as keyof typeof POSITION_LABEL]
      : null;
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ${styles[variant]}`}
    >
      {variant === "head" && <Crown className="size-3" />}
      {variant === "lead" && <Shield className="size-3" />}
      <span className="font-medium">{name}</span>
      {(jobTitle || positionLabel) && (
        <span className="text-[11px] opacity-75">
          · {jobTitle ?? positionLabel}
        </span>
      )}
    </div>
  );
}

function DepartmentNode({ dept, depth }: { dept: OrgDepartment; depth: number }) {
  const memberCount = dept.members.length + dept.teamLeads.length + (dept.head ? 1 : 0);
  const isGroup = dept.kind === "group";
  return (
    <div
      className={`relative ${depth > 0 ? "ms-4 sm:ms-8 border-s border-cyan/[0.18] ps-4 sm:ps-6" : ""}`}
    >
      <Card
        className={`${
          isGroup
            ? "bg-card/40 border-cyan/[0.18]"
            : "bg-card border-border/60"
        } transition-colors hover:border-cyan/40`}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/organization/departments/${dept.id}`}
                  className="text-base font-semibold text-foreground hover:text-cyan transition-colors"
                >
                  {dept.name}
                </Link>
                <Badge variant="outline" className="text-[10px]">
                  {KIND_LABEL[dept.kind] ?? dept.kind}
                </Badge>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Users className="size-3" />
                  {memberCount}
                </span>
              </div>
              {dept.description && (
                <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
                  {dept.description}
                </p>
              )}
            </div>
          </div>

          {!isGroup && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground min-w-20">
                  {copy.organization.head}:
                </span>
                {dept.head ? (
                  <PersonChip
                    name={dept.head.full_name}
                    position={dept.head.position}
                    jobTitle={dept.head.job_title}
                    variant="head"
                  />
                ) : (
                  <span className="text-[11px] text-muted-foreground italic">
                    {copy.organization.noHead}
                  </span>
                )}
              </div>

              {dept.teamLeads.length > 0 && (
                <div className="flex flex-wrap items-start gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground min-w-20 mt-1">
                    {copy.organization.teamLeads}:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {dept.teamLeads.map((l) => (
                      <PersonChip
                        key={l.id}
                        name={l.full_name}
                        position={l.position}
                        jobTitle={l.job_title}
                        variant="lead"
                      />
                    ))}
                  </div>
                </div>
              )}

              {dept.members.length > 0 && (
                <div className="flex flex-wrap items-start gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground min-w-20 mt-1">
                    {copy.organization.members}:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {dept.members.slice(0, 8).map((m) => (
                      <PersonChip
                        key={m.id}
                        name={m.full_name}
                        position={m.position}
                        jobTitle={m.job_title}
                      />
                    ))}
                    {dept.members.length > 8 && (
                      <span className="text-[11px] text-muted-foreground self-center">
                        +{dept.members.length - 8}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {dept.children.length > 0 && (
        <div className="mt-3 space-y-3">
          {dept.children.map((child) => (
            <DepartmentNode key={child.id} dept={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default async function OrgChartPage() {
  const session = await requirePagePermission("employees.view");
  let chart = await loadOrgChart(session.orgId);

  // Hide Sales / Telesales subtree behind the feature flag.
  const userCtx = await getServerSession();
  const showSales = await isFlagOn("sales_track_enabled", userCtx);
  if (!showSales) chart = filterSalesSubtree(chart);

  const totalDepts = chart.byId.size;

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy.organization.chartTitle}
        description={copy.organization.chartDescription}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-dim px-3 py-1 text-xs text-cyan ring-1 ring-cyan/20">
            <Network className="size-3.5" />
            <span className="tabular-nums">{totalDepts}</span>
            <span>قسم</span>
          </span>
        }
      />

      {chart.roots.length === 0 ? (
        <EmptyState
          icon={<Network className="size-6" />}
          title={copy.organization.chartEmpty.title}
          description={copy.organization.chartEmpty.description}
        />
      ) : (
        <ChartViews chart={chart} />
      )}

      {!showSales && (
        <Card className="bg-card/40 border-dashed">
          <CardContent className="p-4 text-xs text-muted-foreground">
            <strong className="font-medium text-foreground/80">
              {copy.organization.salesGated.title}
            </strong>
            <span className="ms-2">{copy.organization.salesGated.description}</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
