import { FileSpreadsheet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth-server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ImportForm } from "./import-form";

export default async function ImportContractsPage() {
  await requirePagePermission("contract.manage");
  const t = await getTranslations("ContractsImportPage");

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumbs={[
          { label: t("breadcrumbs.contracts"), href: "/contracts" },
          { label: t("breadcrumbs.import") },
        ]}
      />

      <Card className="border-cyan/20 bg-cyan-dim/10">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="size-5 text-cyan shrink-0 mt-0.5" />
            <div className="text-xs text-foreground/90 leading-relaxed space-y-1.5">
              <p>
                <strong>{t("howItWorks")}</strong>
              </p>
              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                <li>{t("steps.upload")}</li>
                <li>{t("steps.preview")}</li>
                <li>{t("steps.save")}</li>
              </ol>
              <p className="text-[11px] mt-2">
                {t.rich("note", {
                  code: (chunks) => <code>{chunks}</code>,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ImportForm />
    </div>
  );
}
