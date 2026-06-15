// /settings/ai-knowledge — review/edit/deactivate/delete the durable lessons
// the team taught the AI from the select-text "teach" flow. Open to any
// authenticated dashboard user (same access as teaching).

import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth-server";
import { listAllKnowledge, type KnowledgeAdminRow } from "@/lib/data/ai-knowledge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { KnowledgeRow } from "./knowledge-row";

export default async function AiKnowledgePage() {
  const session = await requireSession();
  const t = await getTranslations("AiKnowledge");

  let rows: KnowledgeAdminRow[] = [];
  let loadError = false;
  try {
    rows = await listAllKnowledge(session.orgId);
  } catch (e) {
    console.error("[ai_knowledge_page_load_failed]", (e as Error).message);
    loadError = true;
  }

  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
            <Sparkles className="size-3 text-cyan" />
            {t("activeCount", { count: activeCount })}
          </Badge>
        }
      />

      {loadError ? (
        <ErrorState title={t("errorTitle")} description={t("errorDescription")} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<Sparkles className="size-6" />}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {rows.map((row) => (
            <KnowledgeRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
