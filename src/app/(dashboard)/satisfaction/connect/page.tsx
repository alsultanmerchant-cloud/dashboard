import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { WA_SESSION_ID } from "@/lib/wa/openwa-client";
import { ConnectWorkspace } from "./connect-workspace";

export default async function ConnectPage() {
  await requirePagePermission("clients.manage");
  const t = await getTranslations("SatisfactionPage.connect");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Link
        href="/satisfaction"
        className="mb-4 inline-flex items-center gap-1 text-xs text-cyan hover:underline"
      >
        <ArrowRight className="size-3.5 rtl:rotate-180" />
        {t("back")}
      </Link>
      <ConnectWorkspace primarySession={WA_SESSION_ID} />
    </div>
  );
}
