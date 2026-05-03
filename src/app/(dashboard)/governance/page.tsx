import Link from "next/link";
import { ShieldCheck, Briefcase, FileWarning, UserX, Workflow, Lock } from "lucide-react";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatArabicDateTime } from "@/lib/utils-format";
import {
  getOpenViolations,
  getOpenViolationCounts,
  GOVERNANCE_KIND_LABELS_AR,
  type GovernanceViolationKind,
  type GovernanceViolationRow,
} from "@/lib/data/governance";
import { ResolveViolationInline } from "./resolve-violation-inline";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<GovernanceViolationKind, React.ReactNode> = {
  missing_log_note: <FileWarning className="size-5" />,
  unowned_task: <UserX className="size-5" />,
  stage_jump: <Workflow className="size-5" />,
  permission_breach: <Lock className="size-5" />,
};

export default async function GovernancePage() {
  const session = await requirePagePermission("governance.view");
  const [violations, counts] = await Promise.all([
    getOpenViolations(session.orgId),
    getOpenViolationCounts(session.orgId),
  ]);
  const canResolve = hasPermission(session, "governance.resolve");

  const total =
    counts.missing_log_note +
    counts.unowned_task +
    counts.stage_jump +
    counts.permission_breach;

  return (
    <div>
      <PageHeader
        title="مخالفات الحوكمة"
        description="قواعد الحوكمة الخمس (مواصفات المالك §10): مهام بلا منفّذ، ملاحظات مفقودة، قفز مراحل، اختراق صلاحيات. كل المخالفات المفتوحة هنا."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <MetricCard
          label={GOVERNANCE_KIND_LABELS_AR.missing_log_note}
          value={counts.missing_log_note}
          icon={KIND_ICON.missing_log_note}
          tone={counts.missing_log_note > 0 ? "warning" : "default"}
        />
        <MetricCard
          label={GOVERNANCE_KIND_LABELS_AR.unowned_task}
          value={counts.unowned_task}
          icon={KIND_ICON.unowned_task}
          tone={counts.unowned_task > 0 ? "destructive" : "default"}
        />
        <MetricCard
          label={GOVERNANCE_KIND_LABELS_AR.stage_jump}
          value={counts.stage_jump}
          icon={KIND_ICON.stage_jump}
          tone={counts.stage_jump > 0 ? "warning" : "default"}
        />
        <MetricCard
          label={GOVERNANCE_KIND_LABELS_AR.permission_breach}
          value={counts.permission_breach}
          icon={KIND_ICON.permission_breach}
          tone={counts.permission_breach > 0 ? "destructive" : "default"}
        />
      </div>

      <section>
        <h2 className="mb-3 text-base font-semibold">المخالفات المفتوحة ({total})</h2>
        {violations.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-6" />}
            title="لا توجد مخالفات مفتوحة"
            description="كل قواعد الحوكمة الخمس مُلتزَم بها في الوقت الراهن."
          />
        ) : (
          <div className="space-y-2">
            {violations.map((row: GovernanceViolationRow) => {
              const task = Array.isArray(row.task) ? row.task[0] : row.task;
              const project = Array.isArray(row.project) ? row.project[0] : row.project;
              const kindLabel =
                GOVERNANCE_KIND_LABELS_AR[row.kind] ?? row.kind;
              return (
                <Card key={row.id} className="border-cc-red/30">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="destructive" className="text-[10px]">
                            {kindLabel}
                          </Badge>
                          {task && (
                            <Link
                              href={`/tasks/${task.id}`}
                              className="text-sm font-semibold hover:text-cyan inline-flex items-center gap-1"
                            >
                              <Briefcase className="size-3.5" />
                              {task.title}
                            </Link>
                          )}
                          {project && (
                            <Link
                              href={`/projects/${project.id}`}
                              className="text-[11px] text-muted-foreground hover:text-cyan"
                            >
                              · {project.name}
                            </Link>
                          )}
                        </div>
                        {row.note && (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {row.note}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          رُصدت: {formatArabicDateTime(row.detected_at)}
                        </p>
                      </div>
                      {canResolve && (
                        <ResolveViolationInline violationId={row.id} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
