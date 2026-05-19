import { NextRequest, NextResponse } from "next/server";
import { getServerSession, hasPermission } from "@/lib/auth-server";
import {
  listTaskSearchSuggestions,
  listTaskTitleSuggestions,
} from "@/lib/data/tasks";

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "tasks.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  // When the /tasks view is scoped to one project the autocomplete splits
  // task hits into "In this project" vs "Other projects" — Rwasem parity.
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim() || null;
  if (!query) {
    return NextResponse.json({ tasks: [], tasksInProject: [], items: [] });
  }

  // Tasks first (the primary thing searched for — feedback #5), then
  // projects/stores as a secondary section. All run in parallel; a failure
  // in any one degrades to an empty list rather than failing the whole call.
  const [tasksGlobal, tasksInProject, items] = await Promise.all([
    listTaskTitleSuggestions(session.orgId, query, undefined, 12).catch(() => []),
    projectId
      ? listTaskTitleSuggestions(session.orgId, query, projectId, 8).catch(() => [])
      : Promise.resolve([]),
    listTaskSearchSuggestions(session.orgId, query).catch(() => []),
  ]);

  // The "other projects" list is the global hit list minus the rows that
  // already appear in the in-project section, so a task is never shown twice.
  const inProjectIds = new Set(tasksInProject.map((t) => t.id));
  const tasks = projectId
    ? tasksGlobal.filter((t) => !inProjectIds.has(t.id)).slice(0, 8)
    : tasksGlobal.slice(0, 8);

  return NextResponse.json({ tasks, tasksInProject, items });
}
