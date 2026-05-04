import Link from "next/link";
import { ListTodo, ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listLiveTasks } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TaskStageBadge, PriorityBadge } from "@/components/status-badges";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

const OPEN_STAGES = [
  "new", "in_progress", "manager_review", "specialist_review",
  "ready_to_send", "sent_to_client", "client_changes",
] as const;

const STAGE_FILTERS = [
  { key: "all", label: "كل المهام" },
  { key: "open", label: "مفتوحة", stages: OPEN_STAGES },
  { key: "overdue", label: "متأخرة" },
  { key: "done", label: "مكتملة", stages: ["done"] },
] as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; odooProjectId?: string }>;
}) {
  await requirePagePermission("tasks.view");
  const sp = await searchParams;
  const filter = (sp.filter as (typeof STAGE_FILTERS)[number]["key"]) ?? "open";
  const filterDef = STAGE_FILTERS.find((f) => f.key === filter) ?? STAGE_FILTERS[0];

  const tasks = await listLiveTasks({
    stage: "stages" in filterDef ? [...filterDef.stages!] : undefined,
    overdue: filter === "overdue",
    projectOdooId: sp.odooProjectId ? Number(sp.odooProjectId) : undefined,
  });

  return (
    <div>
      <PageHeader
        title="المهام"
        description="مهام الفرق مع حالات الإنجاز والأولوية — مباشرة من Odoo."
      />

      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-card/60 px-3 py-2.5">
        {STAGE_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/tasks?filter=${f.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-cyan/30 bg-cyan-dim text-cyan"
                : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">
          {tasks.length} مهمة
        </span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-6" />}
          title="لا توجد مهام"
          description="لا توجد مهام تطابق هذا الفلتر حالياً."
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>المهمة</DataTableHeaderCell>
                <DataTableHeaderCell>المشروع</DataTableHeaderCell>
                <DataTableHeaderCell>المرحلة</DataTableHeaderCell>
                <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
                <DataTableHeaderCell>الموعد النهائي</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="فتح" />
              </tr>
            </DataTableHead>
            <tbody>
              {tasks.map((t) => {
                const overdue = isOverdue(t.deadline) && t.stage !== "done";
                const delayDays = t.deadline && t.stage !== "done"
                  ? Math.floor((Date.now() - new Date(t.deadline).getTime()) / 86400000)
                  : null;
                return (
                  <DataTableRow key={t.odooId}>
                    <DataTableCell className="font-medium">
                      <Link href={`/tasks/odoo/${t.odooId}`} className="hover:text-cyan transition-colors">
                        {t.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {t.projectName ?? "—"}
                    </DataTableCell>
                    <DataTableCell>
                      <TaskStageBadge stage={t.stage} />
                    </DataTableCell>
                    <DataTableCell>
                      <PriorityBadge priority={t.priority} />
                    </DataTableCell>
                    <DataTableCell
                      className={cn(
                        "text-xs tabular-nums",
                        overdue ? "text-cc-red font-medium" : "text-muted-foreground",
                      )}
                      dir="ltr"
                    >
                      <div>{t.deadline ?? "—"}</div>
                      {delayDays != null && delayDays > 0 && (
                        <div className="text-[10px] text-cc-red">+{delayDays}d</div>
                      )}
                    </DataTableCell>
                    <DataTableCell>
                      <Link
                        href={`/tasks/odoo/${t.odooId}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
                        aria-label="فتح"
                      >
                        <ChevronLeft className="size-3.5 icon-flip-rtl" />
                      </Link>
                    </DataTableCell>
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
