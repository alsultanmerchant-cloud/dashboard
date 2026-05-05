import Link from "next/link";
import { ShieldAlert, Briefcase } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePagePermissionAny, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/pagination";
import { formatArabicDateTime } from "@/lib/utils-format";
import { EscalationsToolbar } from "./escalations-toolbar";
import { ResolveExceptionInline } from "./resolve-exception-inline";
import { AcknowledgeButton } from "./acknowledge-button";

export const dynamic = "force-dynamic";

const EXC_PAGE_SIZE = 25;
const ESC_PAGE_SIZE = 25;

type ExceptionRow = {
  id: string;
  task_id: string;
  kind: string;
  reason: string;
  opened_at: string;
  resolved_at: string | null;
  opened_by: string | null;
  task: { id: string; title: string; project_id: string } | { id: string; title: string; project_id: string }[] | null;
};

type EscalationRow = {
  id: string;
  task_id: string;
  exception_id: string | null;
  level: number;
  status: string;
  raised_at: string;
  acknowledged_at: string | null;
  raised_to_user_id: string | null;
  task: { id: string; title: string } | { id: string; title: string }[] | null;
};

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ kind?: string; epage?: string; spage?: string }>;
}) {
  const session = await requirePagePermissionAny([
    "escalation.view_own",
    "escalation.view_all",
  ]);
  const [sp, t] = await Promise.all([
    searchParams ?? Promise.resolve({}),
    getTranslations("Escalations"),
  ]);

  const kindFilter = ["client", "deadline", "quality", "resource"].includes(sp.kind ?? "")
    ? (sp.kind as string)
    : null;
  const ePage = Math.max(1, Number(sp.epage) || 1);
  const sPage = Math.max(1, Number(sp.spage) || 1);
  const seeAll = hasPermission(session, "escalation.view_all");

  const eFrom = (ePage - 1) * EXC_PAGE_SIZE;
  const eTo = eFrom + EXC_PAGE_SIZE - 1;
  let exceptionsQuery = supabaseAdmin
    .from("exceptions")
    .select(
      "id, task_id, kind, reason, opened_at, resolved_at, opened_by, task:task_id ( id, title, project_id )",
      { count: "exact" },
    )
    .eq("organization_id", session.orgId)
    .order("opened_at", { ascending: false })
    .range(eFrom, eTo);
  if (kindFilter) exceptionsQuery = exceptionsQuery.eq("kind", kindFilter);
  if (!seeAll) exceptionsQuery = exceptionsQuery.eq("opened_by", session.userId);
  const { data: exceptions, count: exceptionsTotal } = await exceptionsQuery;

  let kindCountsQuery = supabaseAdmin
    .from("exceptions")
    .select("kind")
    .eq("organization_id", session.orgId)
    .is("resolved_at", null);
  if (!seeAll) kindCountsQuery = kindCountsQuery.eq("opened_by", session.userId);
  const { data: openKindRows } = await kindCountsQuery;
  const counts: Record<string, number> = { client: 0, deadline: 0, quality: 0, resource: 0 };
  for (const r of openKindRows ?? []) counts[r.kind] = (counts[r.kind] ?? 0) + 1;

  const sFrom = (sPage - 1) * ESC_PAGE_SIZE;
  const sTo = sFrom + ESC_PAGE_SIZE - 1;
  let escalationsQuery = supabaseAdmin
    .from("escalations")
    .select(
      "id, task_id, exception_id, level, status, raised_at, acknowledged_at, raised_to_user_id, task:task_id ( id, title )",
      { count: "exact" },
    )
    .eq("organization_id", session.orgId)
    .order("raised_at", { ascending: false })
    .range(sFrom, sTo);
  if (!seeAll) escalationsQuery = escalationsQuery.eq("raised_to_user_id", session.userId);
  const { data: escalations, count: escalationsTotal } = await escalationsQuery;

  const kindKeys = ["client", "deadline", "quality", "resource"] as const;

  return (
    <div>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {kindKeys.map((k) => (
          <Badge key={k} variant="outline" className="text-xs">
            {t(`kindLabels.${k}`)} · {counts[k]}
          </Badge>
        ))}
      </div>

      <EscalationsToolbar activeKind={kindFilter} />

      <section className="mb-10">
        <h2 className="mb-3 text-base font-semibold">{t("exceptions")}</h2>
        {(exceptions ?? []).length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title={t("noExceptions")}
            description={t("noEscalationsDescription")}
          />
        ) : (
          <div className="space-y-2">
            {(exceptions as ExceptionRow[] | null ?? []).map((row) => {
              const task = Array.isArray(row.task) ? row.task[0] : row.task;
              const isOpen = !row.resolved_at;
              const canResolve =
                isOpen &&
                (row.opened_by === session.userId ||
                  hasPermission(session, "escalation.view_all"));
              return (
                <Card key={row.id} className={isOpen ? "border-cc-red/30" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant={isOpen ? "destructive" : "secondary"} className="text-[10px]">
                            {t(`kindLabels.${row.kind as "client" | "deadline" | "quality" | "resource"}`) ?? row.kind}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {isOpen ? t("isOpen") : t("isClosed")}
                          </Badge>
                          {task && (
                            <Link
                              href={`/tasks/${task.id}`}
                              className="text-sm font-semibold hover:text-cyan inline-flex items-center gap-1"
                            >
                              <Briefcase className="size-3.5" />
                              {task.title}
                            </Link>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {row.reason}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("openedAt")}: {formatArabicDateTime(row.opened_at)}
                          {row.resolved_at && (
                            <>
                              {" · "}
                              {t("closedAt")}: {formatArabicDateTime(row.resolved_at)}
                            </>
                          )}
                        </p>
                      </div>
                      {canResolve && (
                        <ResolveExceptionInline exceptionId={row.id} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {(exceptionsTotal ?? 0) > EXC_PAGE_SIZE && (
          <div className="mt-4">
            <Pagination
              total={exceptionsTotal ?? 0}
              pageSize={EXC_PAGE_SIZE}
              currentPage={ePage}
              pageParam="epage"
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">{t("escalationsSection")}</h2>
        {(escalations ?? []).length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title={t("noEscalations")}
            description={t("noEscalationsDescription")}
          />
        ) : (
          <div className="space-y-2">
            {(escalations as EscalationRow[] | null ?? []).map((row) => {
              const task = Array.isArray(row.task) ? row.task[0] : row.task;
              const canAck =
                row.status === "open" &&
                (row.raised_to_user_id === session.userId ||
                  hasPermission(session, "escalation.acknowledge"));
              return (
                <Card key={row.id} className={row.status === "open" ? "border-cc-red/30" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant={row.status === "open" ? "destructive" : "secondary"} className="text-[10px]">
                            {t(`statusLabels.${row.status as "open" | "acknowledged" | "closed"}`) ?? row.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {t("level", { n: row.level })}
                          </Badge>
                          {task && (
                            <Link
                              href={`/tasks/${task.id}`}
                              className="text-sm font-semibold hover:text-cyan inline-flex items-center gap-1"
                            >
                              <Briefcase className="size-3.5" />
                              {task.title}
                            </Link>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {t("raisedAt")}: {formatArabicDateTime(row.raised_at)}
                          {row.acknowledged_at && (
                            <>
                              {" · "}
                              {t("acknowledgedAt")}: {formatArabicDateTime(row.acknowledged_at)}
                            </>
                          )}
                        </p>
                      </div>
                      {canAck && <AcknowledgeButton id={row.id} />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {(escalationsTotal ?? 0) > ESC_PAGE_SIZE && (
          <div className="mt-4">
            <Pagination
              total={escalationsTotal ?? 0}
              pageSize={ESC_PAGE_SIZE}
              currentPage={sPage}
              pageParam="spage"
            />
          </div>
        )}
      </section>
    </div>
  );
}
