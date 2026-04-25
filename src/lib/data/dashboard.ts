import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type DashboardStats = {
  activeClients: number;
  activeProjects: number;
  openTasks: number;
  overdueTasks: number;
  newHandovers: number;
  completedThisWeek: number;
  unreadNotifications: number;
  aiEventsToday: number;
};

export async function getDashboardStats(orgId: string, userId: string): Promise<DashboardStats> {
  const today = new Date().toISOString().slice(0, 10);
  const todayMidnightIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    activeClients, activeProjects, openTasks, overdueTasks,
    newHandovers, completedThisWeek, unread, aiToday,
  ] = await Promise.all([
    supabaseAdmin.from("clients").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("status", "active"),
    supabaseAdmin.from("projects").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("status", "active"),
    supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).in("status", ["todo", "in_progress", "review", "blocked"]),
    supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("status", ["todo", "in_progress", "review", "blocked"])
      .lt("due_date", today),
    supabaseAdmin.from("sales_handover_forms").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("status", "submitted"),
    supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("status", "done").gte("completed_at", weekAgoIso),
    supabaseAdmin.from("notifications").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).eq("recipient_user_id", userId).is("read_at", null),
    supabaseAdmin.from("ai_events").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).gte("created_at", todayMidnightIso),
  ]);

  return {
    activeClients: activeClients.count ?? 0,
    activeProjects: activeProjects.count ?? 0,
    openTasks: openTasks.count ?? 0,
    overdueTasks: overdueTasks.count ?? 0,
    newHandovers: newHandovers.count ?? 0,
    completedThisWeek: completedThisWeek.count ?? 0,
    unreadNotifications: unread.count ?? 0,
    aiEventsToday: aiToday.count ?? 0,
  };
}

export async function getRecentHandovers(orgId: string, limit = 5) {
  const { data } = await supabaseAdmin
    .from("sales_handover_forms")
    .select(`
      id, client_name, urgency_level, status, created_at,
      project:projects ( id, name )
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getOverdueTasks(orgId: string, limit = 8) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, title, due_date, priority, status, project_id,
      project:projects ( id, name, client:clients ( name ) )
    `)
    .eq("organization_id", orgId)
    .in("status", ["todo", "in_progress", "review", "blocked"])
    .lt("due_date", today)
    .order("due_date", { ascending: true })
    .limit(limit);
  return data ?? [];
}

export async function getActivityFeed(orgId: string, limit = 12) {
  const { data } = await supabaseAdmin
    .from("ai_events")
    .select("id, event_type, entity_type, entity_id, payload, importance, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getAiEventCounts(orgId: string) {
  const { data } = await supabaseAdmin
    .from("ai_events")
    .select("event_type, importance")
    .eq("organization_id", orgId);
  const byType: Record<string, number> = {};
  let importanceHigh = 0;
  let total = 0;
  for (const row of data ?? []) {
    byType[row.event_type] = (byType[row.event_type] ?? 0) + 1;
    if (row.importance === "high" || row.importance === "critical") importanceHigh += 1;
    total += 1;
  }
  return { byType, importanceHigh, total };
}

export async function getTeamLoad(orgId: string) {
  // Open tasks per assigned employee
  const { data } = await supabaseAdmin
    .from("task_assignees")
    .select(`
      task_id,
      task:tasks!inner ( id, status ),
      employee:employee_profiles ( id, full_name, avatar_url )
    `)
    .eq("organization_id", orgId);

  const buckets = new Map<string, { name: string; open: number; done: number }>();
  for (const row of data ?? []) {
    const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    if (!emp || !task) continue;
    const k = emp.id;
    if (!buckets.has(k)) buckets.set(k, { name: emp.full_name, open: 0, done: 0 });
    const b = buckets.get(k)!;
    if (task.status === "done") b.done += 1;
    else if (["todo", "in_progress", "review", "blocked"].includes(task.status)) b.open += 1;
  }
  return Array.from(buckets.entries()).map(([id, v]) => ({ id, ...v }));
}
