import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ListTodo, CheckCircle2, AlertTriangle, Activity,
  Mail, Phone, Briefcase, User, ChevronLeft,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth-server";
import { getLiveEmployee } from "@/lib/odoo/live";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TaskStageBadge, PriorityBadge } from "@/components/status-badges";
import { isOverdue } from "@/lib/utils-format";
import { cn } from "@/lib/utils";

export default async function OdooEmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePagePermission("employees.view");

  const emp = await getLiveEmployee(Number(id));
  if (!emp) notFound();

  const { analytics, tasks } = emp;

  // Group tasks: open / overdue / done
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((t) => t.stage !== "done");
  const overdueTasks = openTasks.filter((t) => t.deadline && t.deadline < today);

  return (
    <div className="space-y-6">
      <PageHeader
        title={emp.name}
        breadcrumbs={[
          { label: "الموظفون", href: "/organization/employees" },
          { label: emp.name },
        ]}
      />

      {/* Profile card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <Avatar size="lg">
              <AvatarFallback>{emp.name[0]}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">{emp.name}</h2>
              <p className="text-sm text-muted-foreground">
                {emp.jobTitle ?? "—"}
                {emp.departmentName && ` · ${emp.departmentName}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                {emp.email && (
                  <span className="inline-flex items-center gap-1" dir="ltr">
                    <Mail className="size-3" /> {emp.email}
                  </span>
                )}
                {emp.phone && (
                  <span className="inline-flex items-center gap-1" dir="ltr">
                    <Phone className="size-3" /> {emp.phone}
                  </span>
                )}
                {emp.managerName && (
                  <span className="inline-flex items-center gap-1">
                    <User className="size-3" /> المدير: {emp.managerName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Analytics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إجمالي المهام"
          value={analytics.total}
          icon={<ListTodo className="size-5" />}
          tone="default"
        />
        <MetricCard
          label="مفتوحة"
          value={analytics.inProgress}
          icon={<Activity className="size-5" />}
          tone="info"
        />
        <MetricCard
          label="مكتملة"
          value={analytics.done}
          hint={`${analytics.completionPercent}%`}
          icon={<CheckCircle2 className="size-5" />}
          tone="success"
        />
        <MetricCard
          label="متأخرة"
          value={analytics.overdue}
          icon={<AlertTriangle className="size-5" />}
          tone={analytics.overdue > 0 ? "destructive" : "default"}
        />
      </div>

      {/* Overdue tasks (priority) */}
      {overdueTasks.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-4 text-cc-red" />
            مهام متأخرة ({overdueTasks.length})
          </h2>
          <Card className="border-cc-red/20">
            <CardContent className="p-0">
              <TaskList tasks={overdueTasks} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* All open tasks */}
      <div>
        <h2 className="mb-3 text-base font-semibold">
          المهام المفتوحة ({openTasks.filter((t) => !overdueTasks.includes(t)).length})
        </h2>
        {openTasks.filter((t) => !overdueTasks.includes(t)).length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              لا توجد مهام مفتوحة.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <TaskList tasks={openTasks.filter((t) => !overdueTasks.includes(t))} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function TaskList({ tasks }: { tasks: import("@/lib/odoo/live").LiveTask[] }) {
  return (
    <ul className="divide-y divide-white/[0.04]">
      {tasks.map((t) => {
        const overdue = isOverdue(t.deadline) && t.stage !== "done";
        return (
          <li key={t.odooId}>
            <Link
              href={`/tasks/odoo/${t.odooId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <TaskStageBadge stage={t.stage} />
                  <PriorityBadge priority={t.priority} />
                  {t.projectName && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <Briefcase className="size-3" /> {t.projectName}
                    </span>
                  )}
                  {t.deadline && (
                    <span
                      className={cn("tabular-nums", overdue && "text-cc-red font-medium")}
                      dir="ltr"
                    >
                      {t.deadline}
                    </span>
                  )}
                </div>
              </div>
              <ChevronLeft className="size-4 shrink-0 text-muted-foreground icon-flip-rtl" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
