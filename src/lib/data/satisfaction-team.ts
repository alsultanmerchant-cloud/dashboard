import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TASK_OWNER_ROLE_LABELS, type TaskOwnerRoleKey } from "@/lib/labels";
import { isLeadershipSql } from "@/lib/data/leadership";
import { resolveClientProjectIds } from "@/lib/data/satisfaction-identity";

// =========================================================================
// Client team-activity snapshot — the ACCOUNTABILITY layer of /satisfaction.
//
// Ties every client complaint to the real delivery work behind it: which
// service, which overdue tasks, WHO executes them, who owns the stage they are
// stuck in, and how much each person has actually done (author-attributed
// activity — the Team-Pulse 0229 rule: never count activity *on* a task as the
// assignee's own work). Fed to the model as a factual roster; the model may
// only select and cite from it (see satisfaction-analyze.ts), never invent a
// name, count, or task code. `persistSatisfaction` re-validates against this
// roster so an invented name can never reach the DB.
//
// Attribution semantics (verified against the accountability engine, 0222/0223):
//   - Stage owner of a STUCK task = accountable_position_for_stage(stage_owner_positions, stage)
//     resolved to the assignee whose position matches. This is the person the
//     task is currently waiting on (specialist in in_progress, team manager in
//     manager_review, account manager in sent_to_client/ready_to_send).
//   - Executor = the role_type='agent' assignee (المنفّذ).
//   - Account manager = the role_type='account_manager' assignee.
// Overdue tasks have ~100% assignee coverage (measured), so person attribution
// is reliable on exactly the tasks that matter. projects.*_specialist_id slots
// are near-empty (4-9/56) and intentionally NOT used — they would fire false
// "no specialist" gaps everywhere.
// =========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`satisfaction-team: invalid ${label}`);
  return value.toLowerCase();
}

// Single read-only analytics statement (same gate as accountability.ts). trim()
// is load-bearing: agent_run_readonly_sql validates with btrim + ^(select|with).
async function runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", {
    p_sql: sql.trim(),
  });
  if (error) throw new Error(`satisfaction-team query failed: ${error.message}`);
  return (data ?? []) as T[];
}

const roleLabel = (role: string | null): string =>
  (role && TASK_OWNER_ROLE_LABELS[role as TaskOwnerRoleKey]) || role || "—";

// ---- Types ---------------------------------------------------------------
export interface StuckTask {
  taskCode: string | null;
  title: string;
  stage: string;
  service: string | null;
  daysStuck: number | null;
  archived: boolean; // task is Odoo-archived (historical; only present in full-period runs)
  executor: string | null; // role_type='agent' assignee (المنفّذ)
  accountManager: string | null; // role_type='account_manager' assignee
  stageOwner: string | null; // person whose position owns the CURRENT stage
  stageOwnerRole: string | null; // that position role (specialist/manager/…)
  lastActionBy: string | null;
  lastActionAt: string | null;
  notes30d: number;
  moves30d: number;
}

export interface ServiceLine {
  service: string;
  totalOpen: number;
  overdue: number;
}

export interface TeamMemberActivity {
  employeeId: string;
  name: string;
  positionRole: string | null;
  positionLabel: string;
  department: string | null;
  openTasks: number;
  overdueTasks: number;
  actions30d: number; // authored comments + stage moves on THIS client's tasks
  lastActionAt: string | null;
}

export interface ClientTeamActivitySnapshot {
  accountManager: string | null;
  services: ServiceLine[];
  stuckTasks: StuckTask[]; // worst-stuck (oldest in stage) first, capped
  people: TeamMemberActivity[]; // capped, overdue/active first
  gaps: string[]; // code-detected structural findings (Arabic)
  hasData: boolean; // false → no open tasks at all for this client
}

const MAX_STUCK = 10;
const MAX_PEOPLE = 12;

// ---- Loader --------------------------------------------------------------
async function _getClientTeamActivitySnapshot(
  orgId: string,
  clientId: string,
  includeArchived = false,
): Promise<ClientTeamActivitySnapshot> {
  assertUuid(orgId, "orgId");
  assertUuid(clientId, "clientId");
  // EVERY project the client's identity touches (owned + WA-group-linked + merged
  // twins), not just owned — so a split client's real delivery work is analyzed.
  const projectIds = (await resolveClientProjectIds(orgId, clientId)).map((id) =>
    assertUuid(id, "projectId"),
  );
  if (projectIds.length === 0) {
    return {
      accountManager: null,
      services: [],
      stuckTasks: [],
      people: [],
      gaps: [],
      hasData: false,
    };
  }
  const proj = `select unnest(array[${projectIds.map((id) => `'${id}'`).join(",")}]::uuid[]) as id`;
  // Odoo-archived tasks keep is_overdue=true forever (the flag is never cleared
  // on archive), so ~88% of "overdue" rows are actually archived work whose cycle
  // ended. The current/weekly view must show ONLY live tasks; a full-period run
  // additionally surfaces archived tasks (flagged historical) as past problems.
  // See [[project_satisfaction_execution_scope_fix]].
  const notArchived = includeArchived ? "" : "and t.archived_at is null";

  // Query A — the stuck work behind complaints (overdue tasks, fully resolved).
  const stuckRows = await runSql<{
    task_code: string | null;
    title: string | null;
    stage: string;
    service: string | null;
    days_stuck: number | null;
    archived: boolean;
    executor: string | null;
    account_manager: string | null;
    stage_owner: string | null;
    owner_role: string | null;
    notes_30d: number;
    moves_30d: number;
    last_action_by: string | null;
    last_action_at: string | null;
  }>(`
with cli_projects as (${proj})
select t.task_code, t.title, t.stage::text as stage, s.name as service,
  extract(day from now() - t.stage_entered_at)::int as days_stuck,
  (t.archived_at is not null) as archived,
  public.accountable_position_for_stage(t.stage_owner_positions, t.stage::text) as owner_role,
  -- المنفّذ = the executing SPECIALIST, not a team leader/manager who is also
  -- tagged as an 'agent' on the task. Rank non-leadership first, then specialists,
  -- so a task assigned to (team_lead + specialist + manager) attributes to the
  -- specialist. See [[project_agents_only_performance]].
  (select e.full_name from task_assignees ta join employee_profiles e on e.id = ta.employee_id
     left join positions pos on pos.id = e.position_id
     where ta.task_id = t.id and ta.role_type = 'agent'
     order by (case when ${isLeadershipSql("pos")} then 1 else 0 end),
              (case when pos.role = 'specialist' then 0 else 1 end),
              e.full_name
     limit 1) as executor,
  (select e.full_name from task_assignees ta join employee_profiles e on e.id = ta.employee_id
     where ta.task_id = t.id and ta.role_type = 'account_manager' limit 1) as account_manager,
  (select string_agg(distinct e.full_name, ', ')
     from task_assignees ta join employee_profiles e on e.id = ta.employee_id
     join positions pos on pos.id = e.position_id
     where ta.task_id = t.id
       and pos.role = public.accountable_position_for_stage(t.stage_owner_positions, t.stage::text)
  ) as stage_owner,
  (select count(*) from task_comments tc where tc.task_id = t.id and tc.action_kind = 'note'
     and tc.created_at > now() - interval '30 days') as notes_30d,
  (select count(*) from task_comments tc where tc.task_id = t.id and tc.action_kind = 'stage_move'
     and tc.created_at > now() - interval '30 days') as moves_30d,
  (select e.full_name from task_comments tc join employee_profiles e on e.id = tc.actor_employee_id
     where tc.task_id = t.id order by tc.created_at desc limit 1) as last_action_by,
  (select max(tc.created_at)::text from task_comments tc where tc.task_id = t.id) as last_action_at
from tasks t
join cli_projects cp on cp.id = t.project_id
left join services s on s.id = t.service_id
where t.is_overdue = true ${notArchived}
order by (t.archived_at is not null) asc, t.stage_entered_at asc
limit ${MAX_STUCK}`);

  // Query B — service lines across all open work (context for the AI).
  const serviceRows = await runSql<{ service: string; total_open: number; overdue: number }>(`
with cli_projects as (${proj})
select coalesce(s.name, 'أخرى') as service,
  count(*) as total_open,
  count(*) filter (where t.is_overdue) as overdue
from tasks t
join cli_projects cp on cp.id = t.project_id
left join services s on s.id = t.service_id
where t.stage <> 'done' ${notArchived}
group by 1
order by overdue desc, total_open desc`);

  // Query C — people roster: everyone assigned to the client's open tasks, with
  // their open/overdue load + author-attributed 30-day activity on this client.
  const peopleRows = await runSql<{
    employee_id: string;
    name: string;
    position_role: string | null;
    department: string | null;
    open_tasks: number;
    overdue_tasks: number;
    actions_30d: number;
    last_action_at: string | null;
  }>(`
with cli_projects as (${proj}),
cli_tasks as (select t.id, t.is_overdue, t.stage::text as stage from tasks t join cli_projects cp on cp.id = t.project_id where true ${notArchived})
select e.id as employee_id, e.full_name as name, pos.role as position_role, d.name as department,
  count(distinct ct.id) filter (where ct.stage <> 'done') as open_tasks,
  count(distinct ct.id) filter (where ct.is_overdue) as overdue_tasks,
  (select count(*) from task_comments tc
     where tc.actor_employee_id = e.id and tc.task_id in (select id from cli_tasks)
       and tc.created_at > now() - interval '30 days') as actions_30d,
  (select max(tc.created_at)::text from task_comments tc
     where tc.actor_employee_id = e.id and tc.task_id in (select id from cli_tasks)) as last_action_at
from task_assignees ta
join cli_tasks ct on ct.id = ta.task_id
join employee_profiles e on e.id = ta.employee_id
left join positions pos on pos.id = e.position_id
left join departments d on d.id = e.department_id
where ta.role_type in ('agent', 'account_manager')
group by e.id, e.full_name, pos.role, d.name
order by overdue_tasks desc, actions_30d desc, open_tasks desc
limit ${MAX_PEOPLE}`);

  const stuckTasks: StuckTask[] = stuckRows.map((r) => ({
    taskCode: r.task_code,
    title: (r.title ?? "").trim() || "—",
    stage: r.stage,
    service: r.service,
    daysStuck: r.days_stuck,
    archived: Boolean(r.archived),
    executor: r.executor,
    accountManager: r.account_manager,
    stageOwner: r.stage_owner,
    stageOwnerRole: r.owner_role,
    lastActionBy: r.last_action_by,
    lastActionAt: r.last_action_at,
    notes30d: Number(r.notes_30d ?? 0),
    moves30d: Number(r.moves_30d ?? 0),
  }));

  const services: ServiceLine[] = serviceRows.map((r) => ({
    service: r.service,
    totalOpen: Number(r.total_open ?? 0),
    overdue: Number(r.overdue ?? 0),
  }));

  const people: TeamMemberActivity[] = peopleRows.map((r) => ({
    employeeId: r.employee_id,
    name: r.name,
    positionRole: r.position_role,
    positionLabel: roleLabel(r.position_role),
    department: r.department,
    openTasks: Number(r.open_tasks ?? 0),
    overdueTasks: Number(r.overdue_tasks ?? 0),
    actions30d: Number(r.actions_30d ?? 0),
    lastActionAt: r.last_action_at,
  }));

  // Account manager = the AM carried on the client's tasks (most common one).
  const amCount = new Map<string, number>();
  for (const t of stuckTasks) if (t.accountManager) amCount.set(t.accountManager, (amCount.get(t.accountManager) ?? 0) + 1);
  for (const p of people) if (p.positionRole === "account_manager") amCount.set(p.name, (amCount.get(p.name) ?? 0) + 1);
  const accountManager =
    [...amCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // ---- Code-detected structural findings (facts, not AI). Specialist slots are
  // too sparse to use, so gaps come from the activity signal itself. ----
  const gaps: string[] = [];
  // (a) A task stuck ≥14 days with ZERO stage moves in 30d → genuinely dormant.
  for (const t of stuckTasks) {
    if ((t.daysStuck ?? 0) >= 14 && t.moves30d === 0) {
      const who = t.stageOwner || t.executor;
      gaps.push(
        `مهمة ${t.taskCode ?? t.title} عالقة ${t.daysStuck} يوم في «${t.stage}» بدون أي حركة خلال ٣٠ يوم${who ? ` — المسؤول: ${who}` : ""}.`,
      );
    }
  }
  // (b) Account manager assigned to overdue work but silent (0 authored actions).
  const silentAm = people.find(
    (p) => p.positionRole === "account_manager" && p.overdueTasks > 0 && p.actions30d === 0,
  );
  if (silentAm) {
    gaps.push(
      `مدير الحساب ${silentAm.name} مسؤول عن ${silentAm.overdueTasks} مهمة متأخرة دون أي نشاط مسجّل خلال ٣٠ يوم.`,
    );
  }
  // (c) A service line entirely overdue (every open task late) → systemic on that service.
  for (const s of services) {
    if (s.overdue > 0 && s.overdue === s.totalOpen && s.totalOpen >= 2) {
      gaps.push(`كل مهام خدمة «${s.service}» متأخرة (${s.overdue}/${s.totalOpen}).`);
    }
  }

  return {
    accountManager,
    services,
    stuckTasks,
    people,
    gaps: gaps.slice(0, 6),
    hasData: services.length > 0 || people.length > 0,
  };
}
export const getClientTeamActivitySnapshot = cache(_getClientTeamActivitySnapshot);

// Render the snapshot as the model's 5th source block. Kept here so the prompt
// builder stays lean and the exact wording lives next to the data shape.
export function renderTeamActivityBlock(snap: ClientTeamActivitySnapshot): string {
  if (!snap.hasData) return "";
  const lines: string[] = [];
  lines.push("\n\n=== الفريق والمسؤوليات (بيانات نظام — أسماء وأرقام حقيقية، استشهد بها حرفياً) ===");
  lines.push(`مدير الحساب: ${snap.accountManager ?? "غير محدد"}`);

  if (snap.services.length) {
    lines.push("\nالخدمات (مهام مفتوحة / متأخرة):");
    for (const s of snap.services) {
      lines.push(`- ${s.service}: ${s.totalOpen} مفتوحة${s.overdue ? ` — ${s.overdue} متأخرة` : ""}`);
    }
  }

  if (snap.stuckTasks.length) {
    lines.push("\nأسوأ المهام المتأخرة (المسؤولية التشغيلية):");
    for (const t of snap.stuckTasks) {
      const owner =
        t.stageOwner && t.stageOwnerRole
          ? `مالك المرحلة: ${t.stageOwner} (${roleLabel(t.stageOwnerRole)})`
          : t.stageOwner
            ? `مالك المرحلة: ${t.stageOwner}`
            : "مالك المرحلة: غير محدد";
      lines.push(
        `- ${t.archived ? "🗄️ (مؤرشفة/تاريخية) " : ""}${t.taskCode ? `[${t.taskCode}] ` : ""}${t.title} — خدمة: ${t.service ?? "غير مصنّفة"} — مرحلة «${t.stage}»${
          t.daysStuck != null ? ` منذ ${t.daysStuck} يوم` : ""
        } — المنفّذ: ${t.executor ?? "غير معيّن"} — ${owner} — نشاط ٣٠ يوم: ${t.notes30d} تعليق/${t.moves30d} نقلة — آخر إجراء: ${
          t.lastActionBy ?? "لا يوجد"
        }`,
      );
    }
  }

  if (snap.people.length) {
    lines.push("\nروستر الفريق (مهام مفتوحة/متأخرة — نشاط ٣٠ يوم مُسند للفاعل):");
    for (const p of snap.people) {
      lines.push(
        `- ${p.name} (${p.positionLabel}${p.department ? `، ${p.department}` : ""}): ${p.openTasks} مفتوحة/${p.overdueTasks} متأخرة — ${p.actions30d} إجراء`,
      );
    }
  }

  if (snap.gaps.length) {
    lines.push("\nفجوات مكتشفة آليًا (حقائق من النظام):");
    for (const g of snap.gaps) lines.push(`- ${g}`);
  }

  return lines.join("\n");
}
