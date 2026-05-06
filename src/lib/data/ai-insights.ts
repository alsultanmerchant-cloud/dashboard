import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { InsightsResult, StoredInsightRun } from "@/lib/ai-insights-schema";

export type ProjectHealth = {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  completionPct: number;
  healthScore: "healthy" | "at_risk" | "critical";
};

export type TeamMemberLoad = {
  id: string;
  name: string;
  openTasks: number;
  overdueTasks: number;
  doneTasks: number;
  loadLevel: "low" | "normal" | "high" | "overloaded";
};

export type OverdueTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string;
  daysOverdue: number;
  projectName: string | null;
  clientName: string | null;
};

export type BlockedTaskRow = {
  id: string;
  title: string;
  priority: string;
  projectName: string | null;
  clientName: string | null;
};

export type PendingHandoverRow = {
  id: string;
  clientName: string;
  urgencyLevel: string;
  status: string;
  createdAt: string;
};

export type InsightSummary = {
  activeProjects: number;
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  completedThisWeek: number;
  pendingHandovers: number;
};

type InsightRunRow = {
  id: string;
  status: "running" | "ready" | "failed";
  model: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  result_json: InsightsResult | null;
};

export async function getCurrentStoredInsight(orgId: string): Promise<StoredInsightRun | null> {
  const { data } = await supabaseAdmin
    .from("ai_insight_runs")
    .select("id, status, model, created_at, completed_at, error_message, result_json")
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("is_current", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as InsightRunRow | null;
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    result: row.result_json,
  };
}

export async function getInsightSummary(orgId: string): Promise<InsightSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [activeProjects, openTasks, overdueTasks, blockedTasks, completedThisWeek, pendingHandovers] =
    await Promise.all([
      supabaseAdmin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "active"),
      supabaseAdmin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("status", ["todo", "in_progress", "review"]),
      supabaseAdmin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("status", ["todo", "in_progress", "review", "blocked"])
        .lt("due_date", today),
      supabaseAdmin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "blocked"),
      supabaseAdmin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "done")
        .gte("completed_at", weekAgo),
      supabaseAdmin
        .from("sales_handover_forms")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("status", ["submitted", "in_review"]),
    ]);

  return {
    activeProjects: activeProjects.count ?? 0,
    openTasks: openTasks.count ?? 0,
    overdueTasks: overdueTasks.count ?? 0,
    blockedTasks: blockedTasks.count ?? 0,
    completedThisWeek: completedThisWeek.count ?? 0,
    pendingHandovers: pendingHandovers.count ?? 0,
  };
}

export async function getProjectHealth(orgId: string): Promise<ProjectHealth[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, name, status, client:clients(name)")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!projects?.length) return [];

  const projectIds = projects.map((p) => p.id);

  const { data: tasks } = await supabaseAdmin
    .from("tasks")
    .select("id, project_id, status, due_date")
    .eq("organization_id", orgId)
    .in("project_id", projectIds)
    .not("status", "eq", "cancelled");

  const buckets = new Map<
    string,
    { total: number; done: number; overdue: number; blocked: number }
  >();
  for (const p of projects) {
    buckets.set(p.id, { total: 0, done: 0, overdue: 0, blocked: 0 });
  }

  for (const t of tasks ?? []) {
    const b = buckets.get(t.project_id);
    if (!b) continue;
    b.total += 1;
    if (t.status === "done") {
      b.done += 1;
    } else if (t.status === "blocked") {
      b.blocked += 1;
      if (t.due_date && t.due_date < today) b.overdue += 1;
    } else if (t.due_date && t.due_date < today) {
      b.overdue += 1;
    }
  }

  return projects.map((p) => {
    const b = buckets.get(p.id)!;
    const completionPct = b.total === 0 ? 0 : Math.round((b.done / b.total) * 100);
    const client = Array.isArray(p.client) ? p.client[0] : p.client;

    let healthScore: ProjectHealth["healthScore"] = "healthy";
    if (b.overdue > 0 || b.blocked > 2) healthScore = "at_risk";
    if (b.overdue >= 3 || b.blocked >= 5 || (b.total > 0 && completionPct < 20 && b.overdue > 0)) {
      healthScore = "critical";
    }

    return {
      id: p.id,
      name: p.name,
      clientName: client?.name ?? null,
      status: p.status,
      totalTasks: b.total,
      doneTasks: b.done,
      overdueTasks: b.overdue,
      blockedTasks: b.blocked,
      completionPct,
      healthScore,
    };
  });
}

export async function getTeamLoad(orgId: string): Promise<TeamMemberLoad[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await supabaseAdmin
    .from("task_assignees")
    .select(
      `
      task_id,
      task:tasks!inner ( id, status, due_date ),
      employee:employee_profiles ( id, full_name )
    `,
    )
    .eq("organization_id", orgId);

  const buckets = new Map<string, { name: string; open: number; overdue: number; done: number }>();
  for (const row of data ?? []) {
    const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    if (!emp || !task) continue;
    if (!buckets.has(emp.id)) buckets.set(emp.id, { name: emp.full_name, open: 0, overdue: 0, done: 0 });
    const b = buckets.get(emp.id)!;
    if (task.status === "done") {
      b.done += 1;
    } else if (["todo", "in_progress", "review", "blocked"].includes(task.status)) {
      b.open += 1;
      if (task.due_date && task.due_date < today) b.overdue += 1;
    }
  }

  return Array.from(buckets.entries())
    .map(([id, b]) => {
      let loadLevel: TeamMemberLoad["loadLevel"] = "low";
      if (b.open >= 3) loadLevel = "normal";
      if (b.open >= 6) loadLevel = "high";
      if (b.open >= 10) loadLevel = "overloaded";
      return { id, name: b.name, openTasks: b.open, overdueTasks: b.overdue, doneTasks: b.done, loadLevel };
    })
    .sort((a, b) => b.openTasks - a.openTasks);
}

export async function getOverdueTasksList(orgId: string, limit = 8): Promise<OverdueTaskRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, title, status, priority, due_date,
      project:projects ( name, client:clients ( name ) )
    `)
    .eq("organization_id", orgId)
    .in("status", ["todo", "in_progress", "review", "blocked"])
    .lt("due_date", today)
    .order("due_date", { ascending: true })
    .limit(limit);

  return (data ?? []).map((t) => {
    const project = Array.isArray(t.project) ? t.project[0] : t.project;
    const client = project && (Array.isArray(project.client) ? project.client[0] : project.client);
    const daysOverdue = Math.floor(
      (Date.now() - new Date(t.due_date).getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      daysOverdue,
      projectName: project?.name ?? null,
      clientName: client?.name ?? null,
    };
  });
}

export async function getBlockedTasksList(orgId: string, limit = 6): Promise<BlockedTaskRow[]> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select(`
      id, title, priority,
      project:projects ( name, client:clients ( name ) )
    `)
    .eq("organization_id", orgId)
    .eq("status", "blocked")
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((t) => {
    const project = Array.isArray(t.project) ? t.project[0] : t.project;
    const client = project && (Array.isArray(project.client) ? project.client[0] : project.client);
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      projectName: project?.name ?? null,
      clientName: client?.name ?? null,
    };
  });
}

export async function getPendingHandovers(orgId: string, limit = 5): Promise<PendingHandoverRow[]> {
  const { data } = await supabaseAdmin
    .from("sales_handover_forms")
    .select("id, client_name, urgency_level, status, created_at")
    .eq("organization_id", orgId)
    .in("status", ["submitted", "in_review"])
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((h) => ({
    id: h.id,
    clientName: h.client_name,
    urgencyLevel: h.urgency_level,
    status: h.status,
    createdAt: h.created_at,
  }));
}
