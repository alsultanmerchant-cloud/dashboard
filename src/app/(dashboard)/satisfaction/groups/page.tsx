import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listClientOptions } from "@/lib/data/clients";
import { getWaGroupLinks } from "@/lib/data/satisfaction";
import { PageHeader } from "@/components/page-header";
import { WaGroupsWorkspace } from "./groups-workspace";

export default async function WaGroupsPage() {
  const session = await requirePagePermission("clients.view");
  const t = await getTranslations("SatisfactionPage");

  const [links, clients] = await Promise.all([
    getWaGroupLinks(session.orgId),
    listClientOptions(session.orgId),
  ]);
  const options = clients.map((c) => ({ value: c.id as string, label: c.name as string }));

  return (
    <div>
      <PageHeader title={t("groups.title")} description={t("groups.subtitle")} />
      <Link
        href="/satisfaction"
        className="mb-4 inline-flex items-center gap-1 text-xs text-cyan hover:underline"
      >
        <ArrowRight className="size-3.5 rtl:rotate-180" />
        {t("groups.back")}
      </Link>
      <WaGroupsWorkspace links={links} options={options} />
    </div>
  );
}
