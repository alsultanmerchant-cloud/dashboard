import Link from "next/link";
import { ShieldAlert, Briefcase } from "lucide-react";
import { requirePagePermissionAny, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import { formatArabicDateTime } from "@/lib/utils-format";
import { EscalationsToolbar } from "./escalations-toolbar";
import { ResolveExceptionInline } from "./resolve-exception-inline";
import { AcknowledgeButton } from "./acknowledge-button";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  client: "عميل",
  deadline: "موعد",
  quality: "جودة",
  resource: "موارد",
};

const STATUS_LABELS: Record<string, string> = {
  open: "مفتوح",
  acknowledged: "مُقَرّ به",
  closed: "مغلق",
};

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
  searchParams?: Promise<{ kind?: string }>;
}) {
  const session = await requirePagePermissionAny([
    "escalation.view_own",
    "escalation.view_all",
  ]);
  const sp = (await searchParams) ?? {};
  const kindFilter = ["client", "deadline", "quality", "resource"].includes(sp.kind ?? "")
    ? (sp.kind as string)
    : null;

  const seeAll = hasPermission(session, "escalation.view_all");

  // Exceptions visible to caller. RLS already filters; we add convenience
  // sort + the optional kind filter. When seeAll is false we narrow to
  // exceptions opened by the user (RLS would also surface tasks they own
  // / follow / are assigned to via the policy from migration 0025).
  let exceptionsQuery = supabaseAdmin
    .from("exceptions")
    .select(
      "id, task_id, kind, reason, opened_at, resolved_at, opened_by, task:task_id ( id, title, project_id )",
    )
    .eq("organization_id", session.orgId)
    .order("opened_at", { ascending: false })
    .limit(200);
  if (kindFilter) exceptionsQuery = exceptionsQuery.eq("kind", kindFilter);
  if (!seeAll) {
    exceptionsQuery = exceptionsQuery.eq("opened_by", session.userId);
  }
  const { data: exceptions } = await exceptionsQuery;

  // Escalations either raised TO the user, or all if seeAll.
  let escalationsQuery = supabaseAdmin
    .from("escalations")
    .select(
      "id, task_id, exception_id, level, status, raised_at, acknowledged_at, raised_to_user_id, task:task_id ( id, title )",
    )
    .eq("organization_id", session.orgId)
    .order("raised_at", { ascending: false })
    .limit(200);
  if (!seeAll) {
    escalationsQuery = escalationsQuery.eq("raised_to_user_id", session.userId);
  }
  const { data: escalations } = await escalationsQuery;

  // Counts by kind for the breakdown chip strip.
  const openExc = (exceptions ?? []).filter((e) => !e.resolved_at);
  const counts: Record<string, number> = { client: 0, deadline: 0, quality: 0, resource: 0 };
  for (const e of openExc) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

  return (
    <div>
      <PageHeader
        title="التصعيدات والاستثناءات"
        description="صندوق وارد التصعيدات الموجَّهة إليك. تتبَّع الاستثناءات المفتوحة وأقرَّها أو أغلقها."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {(["client", "deadline", "quality", "resource"] as const).map((k) => (
          <Badge key={k} variant="outline" className="text-xs">
            {KIND_LABELS[k]} · {counts[k]}
          </Badge>
        ))}
      </div>

      <EscalationsToolbar activeKind={kindFilter} />

      <section className="mb-10">
        <h2 className="mb-3 text-base font-semibold">الاستثناءات</h2>
        {(exceptions ?? []).length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title="لا توجد استثناءات"
            description={copy.empty.notifications.description}
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
                            {KIND_LABELS[row.kind] ?? row.kind}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {isOpen ? "مفتوح" : "مغلق"}
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
                          فُتح: {formatArabicDateTime(row.opened_at)}
                          {row.resolved_at && (
                            <>
                              {" · "}
                              أُغلق: {formatArabicDateTime(row.resolved_at)}
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
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">التصعيدات</h2>
        {(escalations ?? []).length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title="لا توجد تصعيدات"
            description="ستظهر هنا التصعيدات الموجَّهة إليك تلقائيًا عند خرق SLA."
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
                            {STATUS_LABELS[row.status] ?? row.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            مستوى {row.level}
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
                          رفع التصعيد: {formatArabicDateTime(row.raised_at)}
                          {row.acknowledged_at && (
                            <>
                              {" · "}
                              تم الإقرار: {formatArabicDateTime(row.acknowledged_at)}
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
      </section>
    </div>
  );
}
