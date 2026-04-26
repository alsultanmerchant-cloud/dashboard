import Link from "next/link";
import { ListTodo, ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listTasks } from "@/lib/data/tasks";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TaskStatusBadge, PriorityBadge, ServiceBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { copy } from "@/lib/copy";
import { isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "كل المهام" },
  { key: "open", label: "مفتوحة", statuses: ["todo", "in_progress", "review", "blocked"] },
  { key: "overdue", label: "متأخرة" },
  { key: "done", label: "مكتملة", statuses: ["done"] },
] as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await requirePagePermission("tasks.view");
  const sp = await searchParams;
  const filter = (sp.filter ?? "open") as (typeof STATUS_FILTERS)[number]["key"];

  const filterDef = STATUS_FILTERS.find((f) => f.key === filter) ?? STATUS_FILTERS[0];
  const tasks = await listTasks(session.orgId, {
    status: "statuses" in filterDef ? [...filterDef.statuses!] : undefined,
    overdue: filter === "overdue",
  });

  return (
    <div>
      <PageHeader
        title="المهام"
        description="كل مهام الفرق مع حالات الإنجاز والأولوية والإسناد. انقر على المهمة لفتح التفاصيل والتعليقات."
      />

      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-card/60 px-3 py-2.5">
        {STATUS_FILTERS.map((f) => (
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
          title={copy.empty.tasks.title}
          description={copy.empty.tasks.description}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>المهمة</DataTableHeaderCell>
                <DataTableHeaderCell>المشروع</DataTableHeaderCell>
                <DataTableHeaderCell>الخدمة</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
                <DataTableHeaderCell>تاريخ التسليم</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="فتح" />
              </tr>
            </DataTableHead>
            <tbody>
              {tasks.map((t) => {
                const project = Array.isArray(t.project) ? t.project[0] : t.project;
                const client = project?.client && (Array.isArray(project.client) ? project.client[0] : project.client);
                const service = Array.isArray(t.service) ? t.service[0] : t.service;
                const overdue = isOverdue(t.due_date) && t.status !== "done" && t.status !== "cancelled";
                return (
                  <DataTableRow key={t.id}>
                    <DataTableCell className="font-medium">
                      <Link href={`/tasks/${t.id}`} className="hover:text-cyan transition-colors">
                        {t.title}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-xs">
                      <div className="text-foreground">{project?.name ?? "—"}</div>
                      {client?.name && <div className="text-muted-foreground">{client.name}</div>}
                    </DataTableCell>
                    <DataTableCell>
                      {service ? <ServiceBadge slug={service.slug} name={service.name} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </DataTableCell>
                    <DataTableCell><TaskStatusBadge status={t.status} /></DataTableCell>
                    <DataTableCell><PriorityBadge priority={t.priority} /></DataTableCell>
                    <DataTableCell className={cn("text-xs tabular-nums", overdue ? "text-cc-red font-medium" : "text-muted-foreground")} dir="ltr">
                      {t.due_date ?? "—"}
                    </DataTableCell>
                    <DataTableCell>
                      <Link
                        href={`/tasks/${t.id}`}
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
