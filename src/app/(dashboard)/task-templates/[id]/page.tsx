import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getTaskTemplate } from "@/lib/data/templates";
import { PageHeader } from "@/components/page-header";
import { ServiceBadge, PriorityBadge } from "@/components/status-badges";
import { ROLE_LABELS } from "@/lib/labels";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { StageOwnerEditor } from "./stage-owner-editor";
import { AddTemplateItemDialog } from "./add-item-dialog";
import { listDepartments } from "@/lib/data/employees";

// Server-side helper — renders the distinct roles used across stages as a
// compact preview (e.g. "المتخصص · المنفذ · مدير الحساب"). Lives here so
// the read-only render path doesn't import the client editor module.
const ROLE_LABEL_PREVIEW: Record<string, string> = {
  specialist: "المتخصص",
  manager: "مدير القسم",
  agent: "المنفذ",
  account_manager: "مدير الحساب",
  supporting_lead: "قائد القسم المساند",
  supporting_agent: "منفذ القسم المساند",
};
function stageOwnerPreview(
  mapping: Record<string, string | null> | null | undefined,
): string {
  if (!mapping) return "—";
  const distinct = Array.from(
    new Set(Object.values(mapping).filter((v): v is string => Boolean(v))),
  ).map((r) => ROLE_LABEL_PREVIEW[r] ?? r);
  return distinct.length > 0 ? distinct.join(" · ") : "—";
}

export default async function TaskTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePagePermission("templates.manage");
  const [tpl, departments] = await Promise.all([
    getTaskTemplate(session.orgId, id),
    listDepartments(session.orgId),
  ]);
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
        actions={
          <div className="flex items-center gap-2">
            {service && <ServiceBadge slug={service.slug} name={service.name} />}
            <AddTemplateItemDialog
              templateId={tpl.id}
              departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            />
          </div>
        }
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
              <DataTableHeaderCell>مالك كل مرحلة</DataTableHeaderCell>
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
                  <DataTableCell>
                    <div className="flex flex-col gap-1">
                      <StageOwnerEditor
                        itemId={it.id}
                        initial={
                          (it as { stage_owner_positions?: Record<string, string | null> | null })
                            .stage_owner_positions ?? null
                        }
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {stageOwnerPreview(
                          (it as { stage_owner_positions?: Record<string, string | null> | null })
                            .stage_owner_positions ?? null,
                        )}
                      </span>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      </DataTableShell>
    </div>
  );
}
