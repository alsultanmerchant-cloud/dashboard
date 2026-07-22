import Link from "next/link";
import { LinkIcon, CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import {
  getMatchCoverage,
  listUnlinkedTasks,
  listTemplateItemOptions,
  type UnlinkedStatus,
} from "@/lib/data/task-template-links";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { LinkTaskPicker } from "./link-task-picker";

const STATUS_STYLE: Record<UnlinkedStatus, string> = {
  unmatched: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ambiguous: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  ad_hoc: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

export default async function UnlinkedTasksPage() {
  const session = await requirePagePermission("templates.manage");
  const t = await getTranslations("UnlinkedTasksPage");

  const [coverage, tasks, options] = await Promise.all([
    getMatchCoverage(session.orgId),
    listUnlinkedTasks(session.orgId),
    listTemplateItemOptions(session.orgId),
  ]);

  const statusLabel: Record<UnlinkedStatus, string> = {
    unmatched: t("status.unmatched"),
    ambiguous: t("status.ambiguous"),
    ad_hoc: t("status.adHoc"),
  };

  const pickerLabels = {
    trigger: t("link.pickPlaceholder"),
    search: t("link.search"),
    empty: t("link.empty"),
    success: t("link.success"),
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />

      {/* Coverage summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t("coverage.linked")}
          value={`${coverage.linkedPct}%`}
          sub={`${coverage.linked.toLocaleString()} / ${coverage.total.toLocaleString()}`}
          tone="good"
        />
        <StatCard label={statusLabel.unmatched} value={coverage.unmatched.toLocaleString()} />
        <StatCard label={statusLabel.ambiguous} value={coverage.ambiguous.toLocaleString()} />
        <StatCard label={statusLabel.ad_hoc} value={coverage.adHoc.toLocaleString()} />
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>{t("table.code")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.task")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.service")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.project")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.reason")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("table.action")}</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {tasks.map((task) => (
                <DataTableRow key={task.id}>
                  <DataTableCell className="whitespace-nowrap font-mono text-xs">
                    {task.taskCode ? (
                      <Link
                        href={`/tasks/${task.id}`}
                        className="text-primary hover:underline"
                      >
                        {task.taskCode}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </DataTableCell>
                  <DataTableCell className="max-w-xs font-medium">
                    <div className="truncate" title={task.title ?? ""}>
                      {task.title ?? "—"}
                    </div>
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {task.serviceName ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    <div className="truncate" title={task.projectName ?? ""}>
                      {task.projectName ?? "—"}
                    </div>
                    {task.clientName && (
                      <div className="truncate text-[11px] opacity-70">
                        {task.clientName}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[task.status]}`}
                    >
                      {statusLabel[task.status]}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <LinkTaskPicker
                      taskId={task.id}
                      serviceId={task.serviceId}
                      options={options}
                      labels={pickerLabels}
                    />
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        </DataTableShell>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {tone === "good" && <LinkIcon className="size-3.5" />}
          {label}
        </div>
        <div
          className={`mt-1 text-2xl font-bold tabular-nums ${
            tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
