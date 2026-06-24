import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Migration phase: agents (specialists) may only see the tasks/projects they're
// involved in — assigned to or following — not the whole org. These helpers
// compute the allowed id sets, applied as a scope on the Tasks/Projects pages
// (and their pagination API) for scope.kind === 'agent'. Managers/heads/owner
// are unscoped.

/**
 * Task ids the agent is allowed to see: tasks they're assigned to (task_assignees
 * by employee) ∪ tasks they follow (task_followers by user). Returns a deduped
 * array (possibly empty → agent sees nothing).
 */
export async function getAgentTaskScopeIds(
  orgId: string,
  employeeId: string | null,
  userId: string | null,
): Promise<string[]> {
  const ids = new Set<string>();
  const queries: PromiseLike<{ data: { task_id: string }[] | null }>[] = [];

  if (employeeId) {
    queries.push(
      supabaseAdmin
        .from("task_assignees")
        .select("task_id")
        .eq("organization_id", orgId)
        .eq("employee_id", employeeId)
        .limit(5000),
    );
  }
  if (userId) {
    queries.push(
      supabaseAdmin
        .from("task_followers")
        .select("task_id")
        .eq("user_id", userId)
        .limit(5000),
    );
  }
  const results = await Promise.all(queries);
  for (const r of results) {
    for (const row of r.data ?? []) {
      if (row.task_id) ids.add(row.task_id as string);
    }
  }
  return Array.from(ids);
}

/**
 * Resolve the effective `customFilterTaskIds` for a request: when the viewer is
 * an agent, intersect the active custom-filter set (if any) with their allowed
 * task ids; otherwise pass the custom-filter set through unchanged. Returns
 * `[]` when the agent has no tasks (→ empty result), never `null` for agents.
 */
export async function applyAgentTaskScope(
  orgId: string,
  customFilterTaskIds: string[] | null,
  agentScope: { employeeId: string | null; userId: string | null } | null,
): Promise<string[] | null> {
  if (!agentScope) return customFilterTaskIds;
  const allowed = await getAgentTaskScopeIds(
    orgId,
    agentScope.employeeId,
    agentScope.userId,
  );
  if (!customFilterTaskIds) return allowed;
  const allowedSet = new Set(allowed);
  return customFilterTaskIds.filter((id) => allowedSet.has(id));
}

/**
 * Project ids the agent is allowed to see: projects that contain a task assigned
 * to them, plus projects they follow directly (project_followers). The task set
 * is derived from getAgentTaskScopeIds so "assigned/following a task" also opens
 * its project.
 */
export async function getAgentProjectScopeIds(
  orgId: string,
  employeeId: string | null,
  userId: string | null,
): Promise<string[]> {
  const projectIds = new Set<string>();
  const taskIds = await getAgentTaskScopeIds(orgId, employeeId, userId);

  // Projects of the agent's tasks. Chunk the IN list small (100) — a large
  // `.in()` is sent as a GET query string and blows the URL length limit,
  // silently dropping ids.
  for (let i = 0; i < taskIds.length; i += 100) {
    const chunk = taskIds.slice(i, i + 100);
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("project_id")
      .eq("organization_id", orgId)
      .in("id", chunk);
    for (const row of data ?? []) {
      if (row.project_id) projectIds.add(row.project_id as string);
    }
  }

  // Projects the agent follows directly (table may not exist in every env — a
  // failed query just yields no extra ids).
  if (userId) {
    const { data } = await supabaseAdmin
      .from("project_followers")
      .select("project_id")
      .eq("user_id", userId)
      .limit(5000);
    for (const row of data ?? []) {
      if (row.project_id) projectIds.add(row.project_id as string);
    }
  }

  return Array.from(projectIds);
}
