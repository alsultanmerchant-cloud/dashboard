import { notFound } from "next/navigation";
import { AlertTriangle, Briefcase, User, Calendar, Clock } from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getLiveTask, listLiveTaskMessages } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TaskStageBadge, PriorityBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/utils-format";

export default async function OdooTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePagePermission("tasks.view");

  const [task, messages] = await Promise.all([
    getLiveTask(Number(id)),
    listLiveTaskMessages(Number(id)),
  ]);

  if (!task) notFound();

  const overdue = isOverdue(task.deadline) && task.stage !== "done";
  const delayDays =
    task.deadline && task.stage !== "done"
      ? Math.floor((Date.now() - new Date(task.deadline).getTime()) / 86400000)
      : null;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={task.name}
        breadcrumbs={[
          { label: "المهام", href: "/tasks" },
          { label: task.name },
        ]}
      />

      {/* Overdue banner */}
      {delayDays != null && delayDays > 0 && (
        <Card className="mb-4 border-cc-red/40 bg-cc-red/10">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-cc-red">
              <AlertTriangle className="size-4" />
              متأخرة بـ {delayDays} يوم
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metadata grid */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">المرحلة</p>
            <TaskStageBadge stage={task.stage} />
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
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">الموعد النهائي</p>
            <p
              className={cn(
                "text-base font-semibold tabular-nums",
                overdue && "text-cc-red",
              )}
              dir="ltr"
            >
              {task.deadline ?? "—"}
            </p>
            {task.completedAt && (
              <p className="text-[11px] text-cc-green" dir="ltr">
                اكتملت {task.completedAt}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">المشروع</p>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Briefcase className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{task.projectName ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assignees */}
      {task.assigneeNames.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              المنفذون
            </p>
            <div className="flex flex-wrap gap-2">
              {task.assigneeNames.map((name, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-soft bg-soft-2 px-3 py-1.5"
                >
                  <div className="flex size-6 items-center justify-center rounded-full bg-cyan-dim text-[11px] font-semibold text-cyan">
                    {name[0]}
                  </div>
                  <span className="text-sm">{name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Description */}
      {task.description && task.description.trim() && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              الوصف
            </p>
            <div
              className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-foreground"
              dangerouslySetInnerHTML={{ __html: task.description }}
            />
          </CardContent>
        </Card>
      )}

      {/* Chatter / messages */}
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">
          التعليقات والنشاط ({messages.length})
        </p>
        {messages.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              لا توجد تعليقات على هذه المهمة.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <Card key={msg.id}>
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded-full bg-soft-2 text-[11px] font-semibold">
                        {msg.authorName?.[0] ?? <User className="size-3" />}
                      </div>
                      <span className="text-sm font-medium">{msg.authorName ?? "مجهول"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground" dir="ltr">
                      <Clock className="size-3" />
                      {msg.date.slice(0, 16).replace("T", " ")}
                    </div>
                  </div>
                  {msg.body ? (
                    <div
                      className="text-sm leading-relaxed text-foreground/90"
                      dangerouslySetInnerHTML={{ __html: msg.body }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground italic">رسالة فارغة</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Created at footer */}
      {task.createdAt && (
        <div className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground" dir="ltr">
          <Calendar className="size-3" />
          أُنشئت في {task.createdAt}
        </div>
      )}
    </div>
  );
}
