import "server-only";
import { odooFromEnv } from "./client";
import { mapStageName } from "./types";

export interface LiveProject {
  odooId: number;
  name: string;
  clientId: number | null;
  clientName: string | null;
  managerId: number | null;
  managerName: string | null;
  startDate: string | null;
  endDate: string | null;
  taskCount: number;
}

export interface LiveClient {
  odooId: number;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  projectCount: number;
}

export interface LiveTask {
  odooId: number;
  name: string;
  projectId: number | null;
  projectName: string | null;
  stage: string;
  stageName: string;
  deadline: string | null;
  priority: "high" | "medium";
  assigneeIds: number[];
}

export interface LiveEmployee {
  odooId: number;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  departmentId: number | null;
  departmentName: string | null;
  managerId: number | null;
  managerName: string | null;
}

function m2o(v: unknown): [number, string] | null {
  if (Array.isArray(v) && v.length === 2) return v as [number, string];
  return null;
}

function str(v: unknown): string | null {
  if (!v || v === false) return null;
  return String(v);
}

export async function listLiveProjects(): Promise<LiveProject[]> {
  const odoo = odooFromEnv();
  const rows = await odoo.searchRead<Record<string, unknown>>(
    "project.project",
    [["active", "=", true]],
    ["id", "name", "partner_id", "user_id", "date_start", "date", "task_count"],
    { limit: 500, order: "id desc" },
  );
  return rows.map((r) => {
    const partner = m2o(r.partner_id);
    const user = m2o(r.user_id);
    return {
      odooId: r.id as number,
      name: String(r.name),
      clientId: partner?.[0] ?? null,
      clientName: partner?.[1] ?? null,
      managerId: user?.[0] ?? null,
      managerName: user?.[1] ?? null,
      startDate: str(r.date_start),
      endDate: str(r.date),
      taskCount: (r.task_count as number) ?? 0,
    };
  });
}

export async function listLiveClients(): Promise<LiveClient[]> {
  const odoo = odooFromEnv();
  const rows = await odoo.searchRead<Record<string, unknown>>(
    "res.partner",
    [["customer_rank", ">", 0], ["is_company", "=", true]],
    ["id", "name", "email", "phone", "mobile", "website"],
    { limit: 1000, order: "name asc" },
  );

  // Count projects per partner
  const partnerIds = rows.map((r) => r.id as number);
  const projectRows = await odoo.searchRead<Record<string, unknown>>(
    "project.project",
    [["partner_id", "in", partnerIds], ["active", "=", true]],
    ["id", "partner_id"],
    { limit: 5000 },
  );
  const projectCountMap = new Map<number, number>();
  for (const p of projectRows) {
    const partner = m2o(p.partner_id);
    if (partner) {
      projectCountMap.set(partner[0], (projectCountMap.get(partner[0]) ?? 0) + 1);
    }
  }

  return rows.map((r) => ({
    odooId: r.id as number,
    name: String(r.name),
    email: str(r.email),
    phone: str(r.phone) ?? str(r.mobile),
    website: str(r.website),
    projectCount: projectCountMap.get(r.id as number) ?? 0,
  }));
}

export interface ListLiveTasksOptions {
  stage?: string[];
  overdue?: boolean;
  projectOdooId?: number;
  assigneeUserId?: number;
  limit?: number;
}

export async function listLiveTasks(opts: ListLiveTasksOptions = {}): Promise<LiveTask[]> {
  const odoo = odooFromEnv();

  // Load stage names once
  const stages = await odoo.searchRead<Record<string, unknown>>(
    "project.task.type",
    [],
    ["id", "name"],
    { limit: 200 },
  );
  const stageNameById = new Map<number, string>();
  for (const s of stages) stageNameById.set(s.id as number, String(s.name));

  const domain: unknown[] = [];
  if (opts.projectOdooId) domain.push(["project_id", "=", opts.projectOdooId]);
  if (opts.assigneeUserId) domain.push(["user_ids", "in", [opts.assigneeUserId]]);
  if (opts.overdue) {
    const today = new Date().toISOString().slice(0, 10);
    domain.push(["date_deadline", "<", today], ["stage_id.name", "!=", "Done"]);
  }
  if (opts.stage?.length) {
    // Map dashboard stage keys back to Odoo stage names for filtering
    // We filter client-side after fetching since mapping is small
  }

  const rows = await odoo.searchRead<Record<string, unknown>>(
    "project.task",
    domain,
    ["id", "name", "project_id", "stage_id", "date_deadline", "priority", "user_ids"],
    { limit: opts.limit ?? 500, order: "id desc" },
  );

  let tasks: LiveTask[] = rows.map((r) => {
    const project = m2o(r.project_id);
    const stageM2o = m2o(r.stage_id);
    const stageName = stageM2o ? (stageNameById.get(stageM2o[0]) ?? stageM2o[1]) : "New";
    const stage = mapStageName(stageName);
    const deadlineRaw = str(r.date_deadline);
    const deadline = deadlineRaw ? deadlineRaw.slice(0, 10) : null;
    const userIds = Array.isArray(r.user_ids) ? (r.user_ids as number[]) : [];
    return {
      odooId: r.id as number,
      name: String(r.name),
      projectId: project?.[0] ?? null,
      projectName: project?.[1] ?? null,
      stage,
      stageName,
      deadline,
      priority: (r.priority as string) === "1" ? "high" : "medium",
      assigneeIds: userIds,
    };
  });

  if (opts.stage?.length) {
    tasks = tasks.filter((t) => opts.stage!.includes(t.stage));
  }
  if (opts.overdue) {
    const today = new Date().toISOString().slice(0, 10);
    tasks = tasks.filter((t) => t.deadline && t.deadline < today && t.stage !== "done");
  }

  return tasks;
}

export interface LiveTaskDetail {
  odooId: number;
  name: string;
  projectId: number | null;
  projectName: string | null;
  stage: string;
  stageName: string;
  deadline: string | null;
  completedAt: string | null;
  createdAt: string | null;
  priority: "high" | "medium";
  description: string | null;
  assigneeIds: number[];
  assigneeNames: string[];
}

export interface LiveTaskMessage {
  id: number;
  body: string;
  authorId: number | null;
  authorName: string | null;
  date: string;
}

export async function getLiveTask(odooId: number): Promise<LiveTaskDetail | null> {
  const odoo = odooFromEnv();

  const stages = await odoo.searchRead<Record<string, unknown>>(
    "project.task.type", [], ["id", "name"], { limit: 200 },
  );
  const stageNameById = new Map<number, string>();
  for (const s of stages) stageNameById.set(s.id as number, String(s.name));

  const rows = await odoo.read<Record<string, unknown>>(
    "project.task",
    [odooId],
    ["id", "name", "project_id", "stage_id", "date_deadline", "priority",
     "user_ids", "description", "create_date", "date_end"],
  );
  if (!rows.length) return null;
  const r = rows[0];

  const project = m2o(r.project_id);
  const stageM2o = m2o(r.stage_id);
  const stageName = stageM2o ? (stageNameById.get(stageM2o[0]) ?? stageM2o[1]) : "New";
  const stage = mapStageName(stageName);
  const userIds = Array.isArray(r.user_ids) ? (r.user_ids as number[]) : [];

  // Resolve res.users → display names
  let assigneeNames: string[] = [];
  if (userIds.length) {
    const users = await odoo.read<Record<string, unknown>>("res.users", userIds, ["id", "name"]);
    assigneeNames = users.map((u) => String(u.name));
  }

  return {
    odooId: r.id as number,
    name: String(r.name),
    projectId: project?.[0] ?? null,
    projectName: project?.[1] ?? null,
    stage,
    stageName,
    deadline: str(r.date_deadline)?.slice(0, 10) ?? null,
    completedAt: str(r.date_end)?.slice(0, 10) ?? null,
    createdAt: str(r.create_date)?.slice(0, 16) ?? null,
    priority: (r.priority as string) === "1" ? "high" : "medium",
    description: str(r.description),
    assigneeIds: userIds,
    assigneeNames,
  };
}

export async function listLiveTaskMessages(odooId: number): Promise<LiveTaskMessage[]> {
  const odoo = odooFromEnv();
  const rows = await odoo.searchRead<Record<string, unknown>>(
    "mail.message",
    [["res_id", "=", odooId], ["model", "=", "project.task"],
     ["message_type", "in", ["comment", "email"]]],
    ["id", "body", "author_id", "date"],
    { limit: 100, order: "date asc" },
  );
  return rows.map((r) => {
    const author = m2o(r.author_id);
    return {
      id: r.id as number,
      body: stripOdooLinks(String(r.body ?? "")),
      authorId: author?.[0] ?? null,
      authorName: author?.[1] ?? null,
      date: String(r.date ?? ""),
    };
  });
}

function stripOdooLinks(html: string): string {
  // Remove Odoo internal anchor tags but keep their text content
  return html
    .replace(/<a[^>]*class="o_mail_redirect"[^>]*>([^<]*)<\/a>/g, "$1")
    .replace(/<a[^>]*href="https?:\/\/[^"]*\/web#[^"]*"[^>]*>([^<]*)<\/a>/g, "$1")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard metrics — all task-derived KPIs in one Odoo round-trip
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardOdooMetrics {
  overdueCount: number;
  reworkCount: number;          // tasks currently in "Client Changes" stage
  reviewBacklog: number;        // tasks in manager/specialist review stages
  closedThisWeek: number;       // tasks with date_end in last 7 days
  onTimePct: number | null;     // % of tasks done in last 30 days delivered on/before deadline
  onTimeSample: number;
  onTimeHits: number;
  overdueTasks: LiveTask[];     // top 5, sorted most-overdue first
  // Useful aggregate counts
  totalProjects: number;
  totalActiveProjects: number;
  totalClients: number;
}

export async function getDashboardOdooMetrics(): Promise<DashboardOdooMetrics> {
  const odoo = odooFromEnv();

  // Pre-load stage names
  const stages = await odoo.searchRead<Record<string, unknown>>(
    "project.task.type", [], ["id", "name"], { limit: 200 },
  );
  const stageNameById = new Map<number, string>();
  for (const s of stages) stageNameById.set(s.id as number, String(s.name));

  // One big read — all tasks with the fields we need for every KPI
  const taskRows = await odoo.searchRead<Record<string, unknown>>(
    "project.task",
    [],
    ["id", "name", "project_id", "stage_id", "date_deadline", "date_end", "priority", "user_ids"],
    { limit: 10000, order: "id desc" },
  );

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  let overdueCount = 0;
  let reworkCount = 0;
  let reviewBacklog = 0;
  let closedThisWeek = 0;
  let onTimeSample = 0;
  let onTimeHits = 0;
  const overdueAll: LiveTask[] = [];

  for (const r of taskRows) {
    const stageM2o = m2o(r.stage_id);
    const stageName = stageM2o ? (stageNameById.get(stageM2o[0]) ?? stageM2o[1]) : "New";
    const stage = mapStageName(stageName);
    const deadline = str(r.date_deadline)?.slice(0, 10) ?? null;
    const endDate = str(r.date_end)?.slice(0, 10) ?? null;
    const project = m2o(r.project_id);
    const userIds = Array.isArray(r.user_ids) ? (r.user_ids as number[]) : [];

    // Overdue: open tasks past their deadline
    if (deadline && deadline < today && stage !== "done") {
      overdueCount++;
      overdueAll.push({
        odooId: r.id as number,
        name: String(r.name),
        projectId: project?.[0] ?? null,
        projectName: project?.[1] ?? null,
        stage,
        stageName,
        deadline,
        priority: (r.priority as string) === "1" ? "high" : "medium",
        assigneeIds: userIds,
      });
    }

    if (stage === "client_changes") reworkCount++;
    if (stage === "manager_review" || stage === "specialist_review") reviewBacklog++;

    if (stage === "done" && endDate) {
      if (endDate >= weekAgo) closedThisWeek++;
      if (endDate >= monthAgo && deadline) {
        onTimeSample++;
        if (endDate <= deadline) onTimeHits++;
      }
    }
  }

  // Sort overdue by deadline ascending (most overdue first)
  overdueAll.sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  });

  // Side counts (cheap parallel queries)
  const [activeProjectsCount, totalProjectsCount, totalClientsCount] = await Promise.all([
    odoo.executeKw<number>("project.project", "search_count", [[["active", "=", true]]]),
    odoo.executeKw<number>("project.project", "search_count", [[]]),
    odoo.executeKw<number>(
      "res.partner", "search_count",
      [[["customer_rank", ">", 0], ["is_company", "=", true]]],
    ),
  ]);

  return {
    overdueCount,
    reworkCount,
    reviewBacklog,
    closedThisWeek,
    onTimeSample,
    onTimeHits,
    onTimePct: onTimeSample > 0 ? Math.round((onTimeHits / onTimeSample) * 100) : null,
    overdueTasks: overdueAll.slice(0, 5),
    totalProjects: totalProjectsCount,
    totalActiveProjects: activeProjectsCount,
    totalClients: totalClientsCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports + governance — derived live from Odoo so the reactive layer
// (which used to read empty Supabase tables) shows real signal.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectComplianceRow {
  projectId: number;
  projectName: string;
  total: number;
  withinDeadline: number;
  pct: number | null;
}

export interface ReworkByProjectRow {
  projectId: number;
  projectName: string;
  count: number;
}

export interface AgentLeaderboardRow {
  userId: number;
  fullName: string;
  closedCount: number;
  utilizationPct: number;     // closed / topClosed * 100
}

export interface ReviewBacklogRow {
  odooId: number;
  name: string;
  projectName: string | null;
  stage: string;
  stageName: string;
  deadline: string | null;
}

export interface ReportsOdooData {
  onTime: { pct: number | null; sample: number; hits: number };
  reviewBacklog: ReviewBacklogRow[];
  reworkTotal: number;
  reworkByProject: ReworkByProjectRow[];
  agentLeaderboard: AgentLeaderboardRow[];
  projectCompliance: ProjectComplianceRow[];
}

// Build all reports KPIs from one big Odoo task fetch + one users batch lookup.
// Used by /reports and the dashboard page (it can call this if it ever needs
// the per-project / per-user breakdowns that getDashboardOdooMetrics omits).
export async function getReportsOdooData(): Promise<ReportsOdooData> {
  const odoo = odooFromEnv();

  // Pre-load stage names
  const stages = await odoo.searchRead<Record<string, unknown>>(
    "project.task.type", [], ["id", "name"], { limit: 200 },
  );
  const stageNameById = new Map<number, string>();
  for (const s of stages) stageNameById.set(s.id as number, String(s.name));

  // Big task pull
  const taskRows = await odoo.searchRead<Record<string, unknown>>(
    "project.task",
    [],
    ["id", "name", "project_id", "stage_id", "date_deadline", "date_end", "user_ids"],
    { limit: 10000, order: "id desc" },
  );

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);

  // Aggregators
  let onTimeSample = 0;
  let onTimeHits = 0;

  const reviewBacklogAll: ReviewBacklogRow[] = [];

  // Per-project: total open + within-deadline open
  type ProjectAgg = { name: string; total: number; within: number; rework: number };
  const projectMap = new Map<number, ProjectAgg>();

  // Per-user closed in last 28 days
  const userClosedMap = new Map<number, number>();

  for (const r of taskRows) {
    const stageM2o = m2o(r.stage_id);
    const stageName = stageM2o ? (stageNameById.get(stageM2o[0]) ?? stageM2o[1]) : "New";
    const stage = mapStageName(stageName);
    const deadline = str(r.date_deadline)?.slice(0, 10) ?? null;
    const endDate = str(r.date_end)?.slice(0, 10) ?? null;
    const project = m2o(r.project_id);
    const userIds = Array.isArray(r.user_ids) ? (r.user_ids as number[]) : [];

    // On-time pct (last 30 days)
    if (stage === "done" && endDate && endDate >= monthAgo && deadline) {
      onTimeSample++;
      if (endDate <= deadline) onTimeHits++;
    }

    // Review backlog
    if (stage === "manager_review" || stage === "specialist_review") {
      reviewBacklogAll.push({
        odooId: r.id as number,
        name: String(r.name),
        projectName: project?.[1] ?? null,
        stage,
        stageName,
        deadline,
      });
    }

    // Per-project compliance + rework
    if (project) {
      const pid = project[0];
      let agg = projectMap.get(pid);
      if (!agg) {
        agg = { name: project[1], total: 0, within: 0, rework: 0 };
        projectMap.set(pid, agg);
      }
      if (stage !== "done") {
        agg.total++;
        if (!deadline || deadline >= today) agg.within++;
      }
      if (stage === "client_changes") agg.rework++;
    }

    // Closed-this-period per user (for leaderboard)
    if (stage === "done" && endDate && endDate >= fourWeeksAgo) {
      for (const uid of userIds) {
        userClosedMap.set(uid, (userClosedMap.get(uid) ?? 0) + 1);
      }
    }
  }

  // Resolve user_ids → names for leaderboard
  const userIds = Array.from(userClosedMap.keys()).filter((id) => userClosedMap.get(id)! > 0);
  let userNames = new Map<number, string>();
  if (userIds.length) {
    const users = await odoo.read<Record<string, unknown>>(
      "res.users", userIds, ["id", "name"],
    );
    userNames = new Map(users.map((u) => [u.id as number, String(u.name)]));
  }

  // Build leaderboard rows
  const leaderboardRaw = Array.from(userClosedMap.entries())
    .map(([uid, count]) => ({
      userId: uid,
      fullName: userNames.get(uid) ?? `User ${uid}`,
      closedCount: count,
    }))
    .sort((a, b) => b.closedCount - a.closedCount);

  const topClosed = leaderboardRaw[0]?.closedCount ?? 1;
  const agentLeaderboard: AgentLeaderboardRow[] = leaderboardRaw.map((r) => ({
    ...r,
    utilizationPct: topClosed > 0 ? Math.round((r.closedCount / topClosed) * 100) : 0,
  }));

  // Project compliance — only projects with at least 1 open task
  const projectCompliance: ProjectComplianceRow[] = Array.from(projectMap.entries())
    .filter(([, v]) => v.total > 0)
    .map(([pid, v]) => ({
      projectId: pid,
      projectName: v.name,
      total: v.total,
      withinDeadline: v.within,
      pct: v.total > 0 ? Math.round((v.within / v.total) * 100) : null,
    }))
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))   // worst first
    .slice(0, 10);

  // Rework by project — top 10
  const reworkByProject: ReworkByProjectRow[] = Array.from(projectMap.entries())
    .filter(([, v]) => v.rework > 0)
    .map(([pid, v]) => ({
      projectId: pid,
      projectName: v.name,
      count: v.rework,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const reworkTotal = Array.from(projectMap.values()).reduce(
    (s, v) => s + v.rework, 0,
  );

  // Sort review backlog by deadline (most overdue first)
  reviewBacklogAll.sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  });

  return {
    onTime: {
      pct: onTimeSample > 0 ? Math.round((onTimeHits / onTimeSample) * 100) : null,
      sample: onTimeSample,
      hits: onTimeHits,
    },
    reviewBacklog: reviewBacklogAll.slice(0, 20),
    reworkTotal,
    reworkByProject,
    agentLeaderboard: agentLeaderboard.slice(0, 10),
    projectCompliance,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance violations — computed live from Odoo state
// ─────────────────────────────────────────────────────────────────────────────

export type OdooGovernanceKind =
  | "unowned_task"          // user_ids is empty
  | "missing_deadline"      // open task has no date_deadline
  | "stuck_in_review"       // task in *_review stage past deadline
  | "overdue_no_progress";  // overdue task in "new" stage (never started)

export const ODOO_GOVERNANCE_KIND_LABELS: Record<OdooGovernanceKind, string> = {
  unowned_task: "مهمة بلا منفّذ",
  missing_deadline: "مهمة بدون موعد نهائي",
  stuck_in_review: "عالقة في المراجعة",
  overdue_no_progress: "متأخّرة ولم تُبدأ",
};

export interface OdooGovernanceViolation {
  kind: OdooGovernanceKind;
  taskOdooId: number;
  taskName: string;
  projectId: number | null;
  projectName: string | null;
  stage: string;
  deadline: string | null;
}

export interface OdooGovernanceResult {
  violations: OdooGovernanceViolation[];
  countsByKind: Record<OdooGovernanceKind, number>;
  total: number;
}

export async function getOdooGovernanceViolations(): Promise<OdooGovernanceResult> {
  const odoo = odooFromEnv();
  const stages = await odoo.searchRead<Record<string, unknown>>(
    "project.task.type", [], ["id", "name"], { limit: 200 },
  );
  const stageNameById = new Map<number, string>();
  for (const s of stages) stageNameById.set(s.id as number, String(s.name));

  const taskRows = await odoo.searchRead<Record<string, unknown>>(
    "project.task",
    [],
    ["id", "name", "project_id", "stage_id", "date_deadline", "user_ids"],
    { limit: 10000, order: "id desc" },
  );

  const today = new Date().toISOString().slice(0, 10);
  const violations: OdooGovernanceViolation[] = [];
  const counts: Record<OdooGovernanceKind, number> = {
    unowned_task: 0,
    missing_deadline: 0,
    stuck_in_review: 0,
    overdue_no_progress: 0,
  };

  function record(kind: OdooGovernanceKind, r: Record<string, unknown>, stage: string) {
    const project = m2o(r.project_id);
    violations.push({
      kind,
      taskOdooId: r.id as number,
      taskName: String(r.name),
      projectId: project?.[0] ?? null,
      projectName: project?.[1] ?? null,
      stage,
      deadline: str(r.date_deadline)?.slice(0, 10) ?? null,
    });
    counts[kind]++;
  }

  for (const r of taskRows) {
    const stageM2o = m2o(r.stage_id);
    const stageName = stageM2o ? (stageNameById.get(stageM2o[0]) ?? stageM2o[1]) : "New";
    const stage = mapStageName(stageName);

    // Skip done tasks — governance is about open work
    if (stage === "done") continue;

    const deadline = str(r.date_deadline)?.slice(0, 10) ?? null;
    const userIds = Array.isArray(r.user_ids) ? (r.user_ids as number[]) : [];

    if (userIds.length === 0) record("unowned_task", r, stage);
    if (!deadline) record("missing_deadline", r, stage);
    if (
      (stage === "manager_review" || stage === "specialist_review") &&
      deadline && deadline < today
    ) {
      record("stuck_in_review", r, stage);
    }
    if (stage === "new" && deadline && deadline < today) {
      record("overdue_no_progress", r, stage);
    }
  }

  return {
    violations: violations.slice(0, 500),  // cap for sane page render
    countsByKind: counts,
    total: violations.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics + detail fetchers
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskAnalytics {
  total: number;
  byStage: Record<string, number>;
  byPriority: { high: number; medium: number };
  overdue: number;
  done: number;
  inProgress: number;
  completionPercent: number;
}

export function computeTaskAnalytics(tasks: LiveTask[]): TaskAnalytics {
  const today = new Date().toISOString().slice(0, 10);
  const byStage: Record<string, number> = {};
  let overdue = 0;
  let done = 0;
  let highCount = 0;
  for (const t of tasks) {
    byStage[t.stage] = (byStage[t.stage] ?? 0) + 1;
    if (t.priority === "high") highCount++;
    if (t.stage === "done") done++;
    if (t.deadline && t.deadline < today && t.stage !== "done") overdue++;
  }
  const inProgress = tasks.length - done;
  return {
    total: tasks.length,
    byStage,
    byPriority: { high: highCount, medium: tasks.length - highCount },
    overdue,
    done,
    inProgress,
    completionPercent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

export interface LiveProjectDetail extends LiveProject {
  description: string | null;
  tasks: LiveTask[];
  analytics: TaskAnalytics;
}

export async function getLiveProject(odooId: number): Promise<LiveProjectDetail | null> {
  const odoo = odooFromEnv();
  const rows = await odoo.read<Record<string, unknown>>(
    "project.project",
    [odooId],
    ["id", "name", "partner_id", "user_id", "date_start", "date",
     "description", "task_count"],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const partner = m2o(r.partner_id);
  const user = m2o(r.user_id);

  const base: LiveProject = {
    odooId: r.id as number,
    name: String(r.name),
    clientId: partner?.[0] ?? null,
    clientName: partner?.[1] ?? null,
    managerId: user?.[0] ?? null,
    managerName: user?.[1] ?? null,
    startDate: str(r.date_start),
    endDate: str(r.date),
    taskCount: (r.task_count as number) ?? 0,
  };

  const tasks = await listLiveTasks({ projectOdooId: odooId, limit: 1000 });
  const analytics = computeTaskAnalytics(tasks);

  return {
    ...base,
    description: str(r.description),
    tasks,
    analytics,
  };
}

export interface LiveClientDetail extends LiveClient {
  street: string | null;
  city: string | null;
  comment: string | null;
  createdAt: string | null;
  projects: LiveProject[];
}

export async function getLiveClient(odooId: number): Promise<LiveClientDetail | null> {
  const odoo = odooFromEnv();
  const rows = await odoo.read<Record<string, unknown>>(
    "res.partner",
    [odooId],
    ["id", "name", "email", "phone", "mobile", "website",
     "street", "city", "comment", "create_date"],
  );
  if (!rows.length) return null;
  const r = rows[0];

  // Pull all projects belonging to this partner
  const projectRows = await odoo.searchRead<Record<string, unknown>>(
    "project.project",
    [["partner_id", "=", odooId], ["active", "=", true]],
    ["id", "name", "partner_id", "user_id", "date_start", "date", "task_count"],
    { limit: 200, order: "id desc" },
  );
  const projects: LiveProject[] = projectRows.map((p) => {
    const partner = m2o(p.partner_id);
    const user = m2o(p.user_id);
    return {
      odooId: p.id as number,
      name: String(p.name),
      clientId: partner?.[0] ?? null,
      clientName: partner?.[1] ?? null,
      managerId: user?.[0] ?? null,
      managerName: user?.[1] ?? null,
      startDate: str(p.date_start),
      endDate: str(p.date),
      taskCount: (p.task_count as number) ?? 0,
    };
  });

  return {
    odooId: r.id as number,
    name: String(r.name),
    email: str(r.email),
    phone: str(r.phone) ?? str(r.mobile),
    website: str(r.website),
    projectCount: projects.length,
    street: str(r.street),
    city: str(r.city),
    comment: str(r.comment),
    createdAt: str(r.create_date)?.slice(0, 10) ?? null,
    projects,
  };
}

export interface LiveEmployeeDetail extends LiveEmployee {
  userId: number | null;
  tasks: LiveTask[];
  analytics: TaskAnalytics;
}

export async function getLiveEmployee(odooId: number): Promise<LiveEmployeeDetail | null> {
  const odoo = odooFromEnv();
  const rows = await odoo.read<Record<string, unknown>>(
    "hr.employee",
    [odooId],
    ["id", "name", "work_email", "work_phone", "job_title",
     "department_id", "parent_id", "user_id"],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const dept = m2o(r.department_id);
  const manager = m2o(r.parent_id);
  const user = m2o(r.user_id);
  const userId = user?.[0] ?? null;

  // Tasks assigned to this employee's res.users id
  let tasks: LiveTask[] = [];
  if (userId) {
    tasks = await listLiveTasks({ assigneeUserId: userId, limit: 500 });
  }

  return {
    odooId: r.id as number,
    name: String(r.name),
    email: str(r.work_email),
    phone: str(r.work_phone),
    jobTitle: str(r.job_title),
    departmentId: dept?.[0] ?? null,
    departmentName: dept?.[1] ?? null,
    managerId: manager?.[0] ?? null,
    managerName: manager?.[1] ?? null,
    userId,
    tasks,
    analytics: computeTaskAnalytics(tasks),
  };
}

export async function listLiveEmployees(): Promise<LiveEmployee[]> {
  const odoo = odooFromEnv();
  const rows = await odoo.searchRead<Record<string, unknown>>(
    "hr.employee",
    [["active", "=", true]],
    ["id", "name", "work_email", "work_phone", "job_title", "department_id", "parent_id"],
    { limit: 500, order: "name asc" },
  );
  return rows.map((r) => {
    const dept = m2o(r.department_id);
    const manager = m2o(r.parent_id);
    return {
      odooId: r.id as number,
      name: String(r.name),
      email: str(r.work_email),
      phone: str(r.work_phone),
      jobTitle: str(r.job_title),
      departmentId: dept?.[0] ?? null,
      departmentName: dept?.[1] ?? null,
      managerId: manager?.[0] ?? null,
      managerName: manager?.[1] ?? null,
    };
  });
}
