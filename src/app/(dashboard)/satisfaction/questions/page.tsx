import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { listSatisfactionQuestions } from "@/lib/satisfaction-questions";
import { PageHeader } from "@/components/page-header";
import { QuestionsWorkspace } from "./questions-workspace";

// The questions queue: findings the status-refresh pass couldn't judge, each
// distilled into one direct question for the team. An answer either closes the
// issue everywhere (via the resolution overlay) or documents that it is still
// open — and both feed the next AI passes as ground truth.

export default async function SatisfactionQuestionsPage() {
  const session = await requirePagePermission("clients.view");
  const t = await getTranslations("SatisfactionPage");
  const data = await listSatisfactionQuestions(session.orgId);

  return (
    <div>
      <PageHeader title={t("questions.title")} description={t("questions.subtitle")} />
      <Link
        href="/satisfaction"
        className="mb-4 inline-flex items-center gap-1 text-xs text-cyan hover:underline"
      >
        <ArrowRight className="size-3.5 rtl:rotate-180" />
        {t("questions.back")}
      </Link>
      <QuestionsWorkspace
        canManage={session.permissions.has("clients.manage")}
        initialOpen={data.open}
        initialAnswered={data.answered}
      />
    </div>
  );
}
