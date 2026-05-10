import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listClients } from "@/lib/data/clients";
import { listAccountManagers, listEmployees, listServices } from "@/lib/data/employees";
import { listAllActiveTemplates, listServiceCategories } from "@/lib/data/service-categories";
import { PageHeader } from "@/components/page-header";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const session = await requirePagePermission("projects.manage");
  const [clients, services, ams, categories, employees, allTemplates] =
    await Promise.all([
      listClients(session.orgId),
      listServices(session.orgId),
      listAccountManagers(session.orgId),
      listServiceCategories(session.orgId),
      listEmployees(session.orgId),
      // Pre-fetch every active template-with-items so the preview pane can render
      // entirely client-side. Fetched in parallel with services (no service-id
      // filter) to avoid a sequential round-trip.
      listAllActiveTemplates(session.orgId),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="مشروع جديد"
        description="اختر العميل والخدمات؛ ستظهر المهام التي سيتم إنشاؤها في لوحة المعاينة على اليسار."
        breadcrumbs={[
          { label: "المشاريع", href: "/projects" },
          { label: "مشروع جديد" },
        ]}
      />

      <NewProjectForm
        clients={clients.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
        }))}
        services={services.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
        accountManagers={ams.map((a) => ({
          id: a.id,
          full_name: a.full_name,
          job_title: a.job_title ?? null,
        }))}
        employees={employees.map((e) => {
          const dept = Array.isArray(e.department) ? e.department[0] : e.department;
          return {
            id: e.id,
            full_name: e.full_name,
            job_title: e.job_title ?? null,
            department_name: dept?.name ?? null,
          };
        })}
        categories={categories.map((c) => ({
          id: c.id,
          key: c.key,
          name_ar: c.name_ar,
          service_id: c.service_id,
          service_name: c.service_name,
        }))}
        templates={allTemplates}
      />

      <div className="text-xs text-muted-foreground">
        <Link
          href="/service-categories"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          إدارة تصنيفات الخدمات وقوالب المهام
          <ChevronRight className="size-3.5 icon-flip-rtl" />
        </Link>
      </div>
    </div>
  );
}
