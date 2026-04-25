import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { getTaskTemplate } from "@/lib/data/templates";
import { PageHeader } from "@/components/page-header";
import { ServiceBadge, PriorityBadge } from "@/components/status-badges";
import { ROLE_LABELS } from "@/lib/labels";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";

export default async function TaskTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const tpl = await getTaskTemplate(session.orgId, id);
  if (!tpl) notFound();

  const service = Array.isArray(tpl.service) ? tpl.service[0] : tpl.service;
  const items = tpl.task_template_items ?? [];

  return (
    <div>
      <PageHeader
        title={tpl.name}
        description={tpl.description ?? undefined}
        breadcrumbs={[
          { label: "قوالب المهام", href: "/task-templates" },
          { label: tpl.name },
        ]}
        actions={service && <ServiceBadge slug={service.slug} name={service.name} />}
      />

      <DataTableShell>
        <DataTable>
          <DataTableHead>
            <tr>
              <DataTableHeaderCell>#</DataTableHeaderCell>
              <DataTableHeaderCell>عنوان المهمة</DataTableHeaderCell>
              <DataTableHeaderCell>القسم المسؤول</DataTableHeaderCell>
              <DataTableHeaderCell>الدور المسؤول</DataTableHeaderCell>
              <DataTableHeaderCell>الإزاحة (يوم)</DataTableHeaderCell>
              <DataTableHeaderCell>المدة (يوم)</DataTableHeaderCell>
              <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
            </tr>
          </DataTableHead>
          <tbody>
            {items.map((it, idx) => {
              const dept = Array.isArray(it.default_department) ? it.default_department[0] : it.default_department;
              return (
                <DataTableRow key={it.id}>
                  <DataTableCell className="text-xs text-muted-foreground tabular-nums">{idx + 1}</DataTableCell>
                  <DataTableCell className="font-medium">
                    <div>{it.title}</div>
                    {it.description && <div className="text-xs text-muted-foreground mt-0.5">{it.description}</div>}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">{dept?.name ?? "—"}</DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {it.default_role_key ? ROLE_LABELS[it.default_role_key] ?? it.default_role_key : "—"}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums" dir="ltr">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3" />
                      +{it.offset_days_from_project_start}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="tabular-nums text-xs text-muted-foreground" dir="ltr">{it.duration_days}</DataTableCell>
                  <DataTableCell><PriorityBadge priority={it.priority} /></DataTableCell>
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      </DataTableShell>
    </div>
  );
}
