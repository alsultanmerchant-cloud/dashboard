import { NextResponse } from "next/server";
import { requireSession, hasPermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!hasPermission(session, "projects.view")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id: projectId } = await params;

  const { data, error } = await supabaseAdmin
    .from("task_activities")
    .select(
      "id, summary, due_date, completed_at, task:tasks!task_activities_task_id_fkey!inner ( id, task_code, title, project_id ), assignee:employee_profiles ( id, full_name )",
    )
    .eq("organization_id", session.orgId)
    .is("completed_at", null)
    .eq("task.project_id", projectId)
    .order("due_date", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[project activities] load failed:", error.message);
    return new NextResponse("Failed to load activities", { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  type Row = {
    id: string;
    summary: string | null;
    due_date: string | null;
    completed_at: string | null;
    task:
      | { id: string; task_code: string | null; title: string | null; project_id: string }
      | { id: string; task_code: string | null; title: string | null; project_id: string }[]
      | null;
    assignee:
      | { id: string; full_name: string }
      | { id: string; full_name: string }[]
      | null;
  };

  const activities = ((data ?? []) as Row[])
    .filter((r) => r.due_date != null)
    .map((r) => {
      const task = Array.isArray(r.task) ? r.task[0] : r.task;
      const assignee = Array.isArray(r.assignee) ? r.assignee[0] : r.assignee;
      const due = r.due_date as string;
      return {
        id: r.id,
        summary: r.summary,
        note: null,
        due_date: due,
        task_id: task?.id ?? "",
        task_code: task?.task_code ?? null,
        task_title: task?.title ?? null,
        assignee_name: assignee?.full_name ?? null,
        overdue: due < today,
      };
    });

  return NextResponse.json({ activities });
}
