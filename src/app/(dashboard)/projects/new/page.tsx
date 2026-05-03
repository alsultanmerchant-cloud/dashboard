import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listClients } from "@/lib/data/clients";
import { listAccountManagers, listServices } from "@/lib/data/employees";
import { listServiceCategories, listTemplatesForServices } from "@/lib/data/service-categories";
import { PageHeader } from "@/components/page-header";
import { NewProjectForm } from "./new-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const session = await requirePagePermission("projects.manage");
  const [clients, services, ams, categories] = await Promise.all([
    listClients(session.orgId),
    listServices(session.orgId),
    listAccountManagers(session.orgId),
    listServiceCategories(session.orgId),
  ]);

  // Pre-fetch every active template-with-items so the preview pane can render
  // entirely client-side without a round-trip on each tick of the date input.
  const allTemplates = await listTemplatesForServices(
    session.orgId,
    services.map((s) => s.id),
  );

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
        clients={clients.map((c) => ({ id: c.id, label: c.name }))}
        services={services.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
        accountManagers={ams.map((a) => ({
          id: a.id,
          label: a.full_name + (a.job_title ? ` — ${a.job_title}` : ""),
        }))}
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
