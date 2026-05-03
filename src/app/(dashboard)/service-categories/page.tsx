import { ListTree } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listServiceCategories } from "@/lib/data/service-categories";
import { listServices } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CategoriesAdmin } from "./categories-admin";

export const dynamic = "force-dynamic";

export default async function ServiceCategoriesPage() {
  const session = await requirePagePermission("category.manage_templates");
  const [categories, services] = await Promise.all([
    listServiceCategories(session.orgId),
    listServices(session.orgId),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="تصنيفات الخدمات"
        description="إدارة باقات الخدمات (Onboarding، السوشيال ميديا، الإعلانات الممولة، SEO، التصميم…) والقوالب المرتبطة بها."
      />

      {categories.length === 0 ? (
        <EmptyState
          icon={<ListTree className="size-6" />}
          title="لا توجد تصنيفات بعد"
          description="استخدم زر + إضافة تصنيف، أو استورد تصنيفات Odoo عبر سكريبت import-odoo-categories."
        />
      ) : null}

      <CategoriesAdmin
        categories={categories}
        services={services.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
      />
    </div>
  );
}
