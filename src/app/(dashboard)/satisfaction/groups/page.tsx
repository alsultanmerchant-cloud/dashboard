import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listClientOptions } from "@/lib/data/clients";
import {
  getWaGroupLinks,
  listProjectOptions,
  getWaLinkSuggestions,
  getProjectGroupCoverage,
} from "@/lib/data/satisfaction";
import { PageHeader } from "@/components/page-header";
import { WaGroupsWorkspace } from "./groups-workspace";

// Sync refreshes member counts for ~368 groups via the OpenWA gateway with a
// bounded (concurrency 3) pool — allow extra time so it doesn't time out.
export const maxDuration = 300;

export default async function WaGroupsPage() {
  const session = await requirePagePermission("clients.view");
  const t = await getTranslations("SatisfactionPage");

  const [links, clients, projects, suggestions, coverageGaps] = await Promise.all([
    getWaGroupLinks(session.orgId),
    listClientOptions(session.orgId),
    listProjectOptions(session.orgId),
    getWaLinkSuggestions(session.orgId),
    getProjectGroupCoverage(session.orgId),
  ]);
  const options = clients.map((c) => ({ value: c.id as string, label: c.name as string }));
  const projectOptions = projects.map((p) => ({
    value: p.id as string,
    label: p.project_code ? `${p.project_code} · ${p.name}` : (p.name as string),
  }));

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
      <WaGroupsWorkspace
        links={links}
        options={options}
        projectOptions={projectOptions}
        suggestions={suggestions}
        coverageGaps={coverageGaps}
      />
    </div>
  );
}
