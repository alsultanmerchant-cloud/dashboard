import { ClipboardList, CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { listTaskTemplates, getTaskTemplate } from "@/lib/data/templates";
import { listDepartments } from "@/lib/data/employees";
import { listPositions } from "@/lib/data/positions";
import { AddTemplateItemDialog } from "./[id]/add-item-dialog";
import { EditTemplateItemDialog } from "./[id]/edit-item-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ConfigShell, type ConfigItem } from "@/components/config-shell";
import { Card, CardContent } from "@/components/ui/card";
import { ServiceBadge, PriorityBadge } from "@/components/status-badges";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";

// Service-slug → Odoo-palette hex (matches the kanban service stripe).
const SERVICE_COLOR: Record<string, string> = {
  seo:                  "#dfb700",
  "media-buying":       "#28a745",
  media_buying:         "#28a745",
  "social-media":       "#3597d3",
  social_media:         "#3597d3",
  "social-media-management": "#3597d3",
  "account-manager":    "#5b8a72",
  account_manager:      "#5b8a72",
};

export default async function TaskTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await requirePagePermission("templates.manage");
  const t = await getTranslations("TaskTemplatesPage");
  const sp = await searchParams;
  const templates = await listTaskTemplates(session.orgId);

  // Default to the first template when none picked — Odoo settings views
  // do the same so the right pane is never blank by default.
  const selectedId = sp.id ?? templates[0]?.id ?? null;
  const [selected, departments, positions] = await Promise.all([
    selectedId ? getTaskTemplate(session.orgId, selectedId) : Promise.resolve(null),
    listDepartments(session.orgId),
    listPositions(session.orgId),
  ]);
  const positionOptions = positions.map((p) => ({ slug: p.slug, name: p.name }));
  const positionNameBySlug = new Map(positions.map((p) => [p.slug, p.name]));

  const items: ConfigItem[] = templates.map((t) => {
    const service = Array.isArray(t.service) ? t.service[0] : t.service;
    const itemCount = Array.isArray(t.task_template_items)
      ? t.task_template_items[0]?.count ?? 0
      : 0;
    const serviceHint =
      service?.name &&
      service.name.trim().toLocaleLowerCase() !== t.name.trim().toLocaleLowerCase()
        ? service.name
        : undefined;
    return {
      id: t.id,
      label: t.name,
      hint: serviceHint,
      stripeColor: service?.slug ? SERVICE_COLOR[service.slug] : undefined,
      inactive: !t.is_active,
      badge: (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {itemCount}
        </span>
      ),
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ConfigShell
          basePath="/task-templates"
          items={items}
          selectedId={selectedId}
          detail={
            selected ? (
              <TemplateDetail
                tpl={selected}
                departments={departments.map((d) => ({ id: d.id, name: d.name }))}
                positions={positionOptions}
                positionNameBySlug={positionNameBySlug}
                labels={{
                  active: t("active"),
                  inactive: t("inactive"),
                  title: t("table.title"),
                  department: t("table.department"),
                  role: t("table.role"),
                  offsetDays: t("table.offsetDays"),
                  durationDays: t("table.durationDays"),
                  priority: t("table.priority"),
                  edit: t("table.edit"),
                }}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TemplateDetail({
  tpl,
  departments,
  positions,
  positionNameBySlug,
  labels,
}: {
  tpl: NonNullable<Awaited<ReturnType<typeof getTaskTemplate>>>;
  departments: { id: string; name: string }[];
  positions: { slug: string; name: string }[];
  positionNameBySlug: Map<string, string>;
  labels: {
    active: string;
    inactive: string;
    title: string;
    department: string;
    role: string;
    offsetDays: string;
    durationDays: string;
    priority: string;
    edit: string;
  };
}) {
  const service = Array.isArray(tpl.service) ? tpl.service[0] : tpl.service;
  const items = tpl.task_template_items ?? [];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">{tpl.name}</h2>
            {tpl.description && (
              <p className="mt-1 text-sm text-muted-foreground">{tpl.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {service && <ServiceBadge slug={service.slug} name={service.name} />}
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                tpl.is_active
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {tpl.is_active ? labels.active : labels.inactive}
            </span>
            <AddTemplateItemDialog
              templateId={tpl.id}
              departments={departments}
              positions={positions}
            />
          </div>
        </CardContent>
      </Card>

      <DataTableShell>
        <DataTable>
          <DataTableHead>
            <tr>
              <DataTableHeaderCell>#</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.title}</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.department}</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.role}</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.offsetDays}</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.durationDays}</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.priority}</DataTableHeaderCell>
              <DataTableHeaderCell>{labels.edit}</DataTableHeaderCell>
            </tr>
          </DataTableHead>
          <tbody>
            {items.map((it, idx) => {
              const dept = Array.isArray(it.default_department)
                ? it.default_department[0]
                : it.default_department;
              return (
                <DataTableRow key={it.id}>
                  <DataTableCell className="tabular-nums text-xs text-muted-foreground">
                    {idx + 1}
                  </DataTableCell>
                  <DataTableCell className="font-medium">
                    <div>{it.title}</div>
                    {it.description && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {it.description}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {dept?.name ?? "—"}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted-foreground">
                    {it.default_role_key
                      ? positionNameBySlug.get(it.default_role_key) ??
                        it.default_role_key
                      : "—"}
                  </DataTableCell>
                  <DataTableCell className="tabular-nums" dir="ltr">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3" />
                      +{it.offset_days_from_project_start}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="tabular-nums text-xs text-muted-foreground" dir="ltr">
                    {it.duration_days}
                  </DataTableCell>
                  <DataTableCell>
                    <PriorityBadge priority={it.priority} />
                  </DataTableCell>
                  <DataTableCell>
                    <EditTemplateItemDialog
                      item={{
                        id: it.id,
                        title: it.title,
                        description: it.description ?? null,
                        default_role_key: it.default_role_key ?? null,
                        default_department_id: dept?.id ?? null,
                        offset_days_from_project_start:
                          it.offset_days_from_project_start,
                        duration_days: it.duration_days,
                        upload_offset_days_before_deadline:
                          (it as { upload_offset_days_before_deadline?: number | null })
                            .upload_offset_days_before_deadline ?? null,
                        priority: it.priority,
                        stage_owner_positions:
                          (it as {
                            stage_owner_positions?: Record<
                              string,
                              string | null
                            > | null;
                          }).stage_owner_positions ?? null,
                        stage_sla_overrides:
                          (it as {
                            stage_sla_overrides?: Record<
                              string,
                              number | null
                            > | null;
                          }).stage_sla_overrides ?? null,
                      }}
                      departments={departments}
                      positions={positions}
                    />
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
