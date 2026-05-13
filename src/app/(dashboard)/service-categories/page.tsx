import { ListTree } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { listServiceCategories } from "@/lib/data/service-categories";
import { listServices } from "@/lib/data/employees";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CategoriesAdmin } from "./categories-admin";
import { SyncOdooButton } from "./sync-odoo-button";

export const dynamic = "force-dynamic";

export default async function ServiceCategoriesPage() {
  const session = await requirePagePermission("category.manage_templates");
  const t = await getTranslations("ServiceCategoriesPage");
  const [categories, services] = await Promise.all([
    listServiceCategories(session.orgId),
    listServices(session.orgId),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<SyncOdooButton />}
      />

      {categories.length === 0 ? (
        <EmptyState
          icon={<ListTree className="size-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : null}

      <CategoriesAdmin
        categories={categories}
        services={services.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
      />
    </div>
  );
}
