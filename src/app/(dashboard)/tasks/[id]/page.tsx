import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { getTask, listTaskComments } from "@/lib/data/tasks";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  TaskStatusBadge, PriorityBadge, ServiceBadge,
} from "@/components/status-badges";
import { TaskStatusSelect } from "../task-status-select";
import { CommentComposer } from "../comment-composer";
import { formatArabicDateTime, isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  const [task, comments] = await Promise.all([
    getTask(session.orgId, id),
    listTaskComments(session.orgId, id),
  ]);
  if (!task) notFound();

  const project = Array.isArray(task.project) ? task.project[0] : task.project;
  const client = project?.client && (Array.isArray(project.client) ? project.client[0] : project.client);
  const service = Array.isArray(task.service) ? task.service[0] : task.service;
  const overdue = isOverdue(task.due_date) && task.status !== "done" && task.status !== "cancelled";

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={task.title}
        description={task.description ?? undefined}
        breadcrumbs={[
          { label: "المهام", href: "/tasks" },
          { label: task.title },
        ]}
        actions={<TaskStatusSelect taskId={task.id} currentStatus={task.status} />}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الحالة</p>
            <TaskStatusBadge status={task.status} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الأولوية</p>
            <PriorityBadge priority={task.priority} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">تاريخ التسليم</p>
            <p className={cn("text-base font-semibold tabular-nums", overdue && "text-cc-red")} dir="ltr">
              {task.due_date ?? "—"}
            </p>
            {task.completed_at && (
              <p className="text-[11px] text-cc-green">اكتملت {formatArabicDateTime(task.completed_at)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">المشروع</p>
            <Link href={`/projects/${project?.id}`} className="flex items-center gap-1.5 text-sm font-medium hover:text-cyan transition-colors">
              <Briefcase className="size-3.5" />
              {project?.name ?? "—"}
            </Link>
            {client?.name && <p className="text-[11px] text-muted-foreground truncate">{client.name}</p>}
          </CardContent>
        </Card>
      </div>

      {service && (
        <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="size-3.5" />
          <span>الخدمة:</span>
          <ServiceBadge slug={service.slug} name={service.name} />
        </div>
      )}

      <SectionTitle
        title="المتابعات والتعليقات"
        description="استخدم @الاسم للإشارة لزميل في الفريق — سيصله تنبيه فوري."
      />

      <div className="space-y-3 mb-4">
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-white/10 bg-card/30 px-4 py-6 text-center">
            لا توجد تعليقات بعد. كن أول من يعلّق.
          </p>
        ) : (
          comments.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar size="sm">
                    <AvatarFallback>{c.author_name[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{c.author_name}</p>
                      <p className="text-[11px] text-muted-foreground">{formatArabicDateTime(c.created_at)}</p>
                    </div>
                    <p className="mt-1.5 text-sm whitespace-pre-wrap leading-relaxed">{renderBodyWithMentions(c.body)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <CommentComposer taskId={task.id} />
    </div>
  );
}

function renderBodyWithMentions(body: string) {
  const parts = body.split(/(@[\p{L}\p{N}_]+)/gu);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="rounded-md bg-cyan-dim/70 px-1 py-0.5 text-cyan font-medium">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
