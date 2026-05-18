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

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organization_id", session.orgId)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [projAttach, taskAttach] = await Promise.all([
    supabaseAdmin
      .from("project_attachments")
      .select(
        "id, filename, mimetype, size_bytes, storage_path, source_url, created_at",
      )
      .eq("organization_id", session.orgId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("task_attachments")
      .select(
        "id, task_id, filename, mimetype, size_bytes, storage_path, source_url, created_at, task:tasks!task_attachments_task_id_fkey!inner ( id, task_code, project_id )",
      )
      .eq("organization_id", session.orgId)
      .eq("task.project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (projAttach.error) {
    console.error("[project attachments] project_attachments:", projAttach.error.message);
    return new NextResponse("Failed to load attachments", { status: 500 });
  }
  if (taskAttach.error) {
    console.error("[project attachments] task_attachments:", taskAttach.error.message);
    return new NextResponse("Failed to load attachments", { status: 500 });
  }

  const projectTasks = (taskAttach.data ?? []).map((r) => {
    const task = Array.isArray(r.task) ? r.task[0] : r.task;
    return {
      id: r.id as string,
      task_id: r.task_id as string,
      task_code: (task?.task_code as string | null) ?? null,
      task_title: null,
      filename: r.filename as string,
      mimetype: (r.mimetype as string | null) ?? null,
      size_bytes: (r.size_bytes as number | null) ?? null,
      storage_path: (r.storage_path as string | null) ?? null,
      source_url: (r.source_url as string | null) ?? null,
      created_at: r.created_at as string,
    };
  });

  const projectLevel = (projAttach.data ?? []).map((r) => ({
    id: r.id as string,
    task_id: "",
    task_code: null,
    task_title: null,
    filename: r.filename as string,
    mimetype: (r.mimetype as string | null) ?? null,
    size_bytes: (r.size_bytes as number | null) ?? null,
    storage_path: (r.storage_path as string | null) ?? null,
    source_url: (r.source_url as string | null) ?? null,
    created_at: r.created_at as string,
  }));

  const rows = [...projectLevel, ...projectTasks].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );

  return NextResponse.json({ rows });
}
