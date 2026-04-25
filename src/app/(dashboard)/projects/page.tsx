import Link from "next/link";
import { Briefcase, ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { listProjects } from "@/lib/data/projects";
import { listClients } from "@/lib/data/clients";
import { listAccountManagers, listServices } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  ProjectStatusBadge, PriorityBadge, ServiceBadge,
} from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import {
  DataTableShell, DataTable, DataTableHead, DataTableHeaderCell,
  DataTableRow, DataTableCell,
} from "@/components/data-table-shell";
import { formatArabicShortDate } from "@/lib/utils-format";
import { copy } from "@/lib/copy";
import { NewProjectDialog } from "./new-project-dialog";

export default async function ProjectsPage() {
  const session = await requireSession();
  const [projects, clients, services, ams] = await Promise.all([
    listProjects(session.orgId),
    listClients(session.orgId),
    listServices(session.orgId),
    listAccountManagers(session.orgId),
  ]);

  const clientOptions = clients.map((c) => ({ id: c.id, label: c.name }));
  const amOptions = ams.map((a) => ({ id: a.id, label: a.full_name + (a.job_title ? ` — ${a.job_title}` : "") }));

  const newProjectButton = (
    <NewProjectDialog
      clients={clientOptions}
      services={services}
      accountManagers={amOptions}
    />
  );

  return (
    <div>
      <PageHeader
        title="المشاريع"
        description="كل مشاريع الوكالة، الخدمات المقدمة، فريق التنفيذ، والمهام المرتبطة."
        actions={newProjectButton}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-6" />}
          title={copy.empty.projects.title}
          description={
            clients.length === 0
              ? "أنشئ عميلًا أولًا، ثم تستطيع إنشاء أول مشروع."
              : copy.empty.projects.description
          }
          action={clients.length > 0 ? newProjectButton : (
            <Button asChild render={<Link href="/clients" />}>
              الذهاب إلى العملاء
            </Button>
          )}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>المشروع</DataTableHeaderCell>
                <DataTableHeaderCell>العميل</DataTableHeaderCell>
                <DataTableHeaderCell>الخدمات</DataTableHeaderCell>
                <DataTableHeaderCell>الحالة</DataTableHeaderCell>
                <DataTableHeaderCell>الأولوية</DataTableHeaderCell>
                <DataTableHeaderCell>المهام</DataTableHeaderCell>
                <DataTableHeaderCell>المسؤول</DataTableHeaderCell>
                <DataTableHeaderCell>البدء</DataTableHeaderCell>
                <DataTableHeaderCell aria-label="إجراءات" />
              </tr>
            </DataTableHead>
            <tbody>
              {projects.map((p) => {
                const client = Array.isArray(p.client) ? p.client[0] : p.client;
                const am = Array.isArray(p.account_manager) ? p.account_manager[0] : p.account_manager;
                const taskCount = Array.isArray(p.tasks) ? p.tasks[0]?.count ?? 0 : 0;
                return (
                  <DataTableRow key={p.id}>
                    <DataTableCell className="font-medium">
                      <Link href={`/projects/${p.id}`} className="hover:text-cyan transition-colors">
                        {p.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">{client?.name ?? "—"}</DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {(p.project_services ?? []).map((ps, i) => {
                          const s = Array.isArray(ps.service) ? ps.service[0] : ps.service;
                          if (!s) return null;
                          return <ServiceBadge key={i} slug={s.slug} name={s.name} />;
                        })}
                      </div>
                    </DataTableCell>
                    <DataTableCell><ProjectStatusBadge status={p.status} /></DataTableCell>
                    <DataTableCell><PriorityBadge priority={p.priority} /></DataTableCell>
                    <DataTableCell className="tabular-nums">{taskCount}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{am?.full_name ?? "—"}</DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{formatArabicShortDate(p.start_date)}</DataTableCell>
                    <DataTableCell>
                      <Button asChild variant="ghost" size="sm" render={<Link href={`/projects/${p.id}`} />}>
                        <ChevronLeft className="size-3.5 icon-flip-rtl" />
                      </Button>
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
