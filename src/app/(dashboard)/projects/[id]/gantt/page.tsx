import { notFound } from "next/navigation";
import { requirePagePermission, hasPermission } from "@/lib/auth-server";
import { getProject } from "@/lib/data/projects";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { ProjectGantt, type GanttTask, type GanttLink } from "./project-gantt";
import type { GanttPrefs } from "./gantt-settings";

export const dynamic = "force-dynamic";

export default async function ProjectGanttPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePagePermission("projects.view");
  const project = await getProject(session.orgId, id);
  if (!project) notFound();

  const [{ data: tasks }, { data: links }] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("id, title, task_code, stage, start_date, planned_date, code_seq, created_at")
      .eq("organization_id", session.orgId)
      .eq("project_id", id)
      .order("code_seq", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("task_links")
      .select("id, source_task_id, target_task_id, dependency_type, lag_days")
      .eq("organization_id", session.orgId),
  ]);

  const taskList = (tasks ?? []) as GanttTask[];
  const taskIds = new Set(taskList.map((t) => t.id));
  const linkList = ((links ?? []) as GanttLink[]).filter(
    (l) => taskIds.has(l.source_task_id) && taskIds.has(l.target_task_id),
  );

  const projectCode = (project as { project_code?: string | null }).project_code ?? null;
  const ganttPrefs =
    ((project as { gantt_prefs?: GanttPrefs | null }).gantt_prefs ?? {}) as GanttPrefs;

  return (
    <div className="space-y-4">
      <PageHeader
        title={(projectCode ? `${projectCode} · ` : "") + project.name + " — مخطط جانت"}
        description="عرض زمني للمهام والترابطات (FS/SS/FF/SF + إزاحة)."
        breadcrumbs={[
          { label: "المشاريع", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "مخطط جانت" },
        ]}
      />

      <ProjectGantt
        projectId={project.id}
        tasks={taskList}
        links={linkList}
        canManage={hasPermission(session, "tasks.manage")}
        initialPrefs={ganttPrefs}
      />
    </div>
  );
}
