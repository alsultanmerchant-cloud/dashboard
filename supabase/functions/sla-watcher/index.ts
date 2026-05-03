// Phase T5 — SLA Watcher edge function.
//
// Cron: every 5 minutes (15-minute SLAs need sub-15-min cadence).
//
// For every task NOT in 'done':
//   1. Compute time-in-current-stage. If sla_rules.business_hours_only=true
//      use business_minutes_between(start, end); else raw minutes.
//   2. Resolve max_minutes:
//        tasks.sla_override_minutes
//        > task_templates.sla_minutes_new / sla_minutes_in_progress
//          (only for stages 'new' / 'in_progress')
//        > sla_rules global value for the stage_key
//   3. If exceeded AND no open `deadline` exception for
//      (task_id, stage_entered_at) → INSERT exceptions + escalations +
//      notifications + ai_event(SLA_BREACHED).
//
// Idempotent thanks to the partial unique index
// `uniq_exceptions_open_per_stage` from migration 0025.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type StageKey =
  | "new"
  | "in_progress"
  | "manager_review"
  | "specialist_review"
  | "ready_to_send"
  | "sent_to_client"
  | "client_changes"
  | "done";

type TaskRow = {
  id: string;
  organization_id: string;
  project_id: string;
  service_id: string | null;
  stage: StageKey;
  stage_entered_at: string;
  sla_override_minutes: number | null;
  created_from_template_item_id: string | null;
  title: string;
};

type SlaRuleRow = {
  organization_id: string;
  stage_key: string;
  max_minutes: number;
  business_hours_only: boolean;
};

type TemplateSlaRow = {
  task_template_item_id: string;
  sla_minutes_new: number | null;
  sla_minutes_in_progress: number | null;
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function businessMinutesBetween(
  start: string,
  end: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("business_minutes_between", {
    p_start: start,
    p_end: end,
  });
  if (error) {
    console.error("[sla-watcher] business_minutes_between failed", error.message);
    return rawMinutes(start, end);
  }
  return Number(data ?? 0);
}

function rawMinutes(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

async function loadSlaRules(orgId: string): Promise<Map<string, SlaRuleRow>> {
  const { data, error } = await supabase
    .from("sla_rules")
    .select("organization_id, stage_key, max_minutes, business_hours_only")
    .eq("organization_id", orgId);
  if (error) throw error;
  const map = new Map<string, SlaRuleRow>();
  for (const row of (data ?? []) as SlaRuleRow[]) {
    map.set(row.stage_key, row);
  }
  return map;
}

async function loadTemplateSla(
  templateItemIds: string[],
): Promise<Map<string, TemplateSlaRow>> {
  if (templateItemIds.length === 0) return new Map();
  // task_template_items → task_templates (service_id, sla_minutes_new/in_progress
  // live on task_templates, not task_template_items).
  const { data, error } = await supabase
    .from("task_template_items")
    .select(
      "id, task_template_id, task_templates:task_template_id ( sla_minutes_new, sla_minutes_in_progress )",
    )
    .in("id", templateItemIds);
  if (error) throw error;
  const out = new Map<string, TemplateSlaRow>();
  for (const row of (data ?? []) as Array<{
    id: string;
    task_templates:
      | { sla_minutes_new: number | null; sla_minutes_in_progress: number | null }
      | { sla_minutes_new: number | null; sla_minutes_in_progress: number | null }[]
      | null;
  }>) {
    const tpl = Array.isArray(row.task_templates)
      ? row.task_templates[0]
      : row.task_templates;
    out.set(row.id, {
      task_template_item_id: row.id,
      sla_minutes_new: tpl?.sla_minutes_new ?? null,
      sla_minutes_in_progress: tpl?.sla_minutes_in_progress ?? null,
    });
  }
  return out;
}

function resolveMaxMinutes(
  task: TaskRow,
  rule: SlaRuleRow | undefined,
  template: TemplateSlaRow | undefined,
): { max: number | null; source: string; businessHoursOnly: boolean } {
  if (task.sla_override_minutes != null) {
    return {
      max: task.sla_override_minutes,
      source: "task_override",
      businessHoursOnly: rule?.business_hours_only ?? true,
    };
  }
  if (task.stage === "new" && template?.sla_minutes_new != null) {
    return {
      max: template.sla_minutes_new,
      source: "template_new",
      businessHoursOnly: true,
    };
  }
  if (task.stage === "in_progress" && template?.sla_minutes_in_progress != null) {
    return {
      max: template.sla_minutes_in_progress,
      source: "template_in_progress",
      businessHoursOnly: true,
    };
  }
  if (rule) {
    return {
      max: rule.max_minutes,
      source: "global_rule",
      businessHoursOnly: rule.business_hours_only,
    };
  }
  return { max: null, source: "none", businessHoursOnly: true };
}

async function findTeamLeadForTask(
  orgId: string,
  taskId: string,
): Promise<string | null> {
  // Resolve the task's department via its service.default_department_id.
  // If we find any department_team_leads row, we pick the first one.
  // Fallback: any department head_employee_id user.
  const { data: task } = await supabase
    .from("tasks")
    .select(
      "service_id, project_id, projects:project_id ( account_manager_employee_id )",
    )
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return null;

  let departmentId: string | null = null;
  if (task.service_id) {
    const { data: svc } = await supabase
      .from("services")
      .select("default_department_id")
      .eq("id", task.service_id)
      .maybeSingle();
    departmentId = svc?.default_department_id ?? null;
  }

  if (departmentId) {
    const { data: leads } = await supabase
      .from("department_team_leads")
      .select("user_id")
      .eq("department_id", departmentId)
      .limit(1);
    if (leads && leads.length > 0) return leads[0].user_id;

    // fall back to head_employee_id → user_id
    const { data: dept } = await supabase
      .from("departments")
      .select("head_employee_id")
      .eq("id", departmentId)
      .maybeSingle();
    if (dept?.head_employee_id) {
      const { data: emp } = await supabase
        .from("employee_profiles")
        .select("user_id")
        .eq("id", dept.head_employee_id)
        .maybeSingle();
      if (emp?.user_id) return emp.user_id;
    }
  }

  // Last resort: project AM
  const project = Array.isArray(task.projects) ? task.projects[0] : task.projects;
  if (project?.account_manager_employee_id) {
    const { data: emp } = await supabase
      .from("employee_profiles")
      .select("user_id")
      .eq("id", project.account_manager_employee_id)
      .maybeSingle();
    return emp?.user_id ?? null;
  }
  return null;
}

async function processTask(task: TaskRow, rules: Map<string, SlaRuleRow>) {
  if (task.stage === "done") return;

  const rule = rules.get(task.stage);
  let template: TemplateSlaRow | undefined;
  if (
    (task.stage === "new" || task.stage === "in_progress") &&
    task.created_from_template_item_id
  ) {
    const tpl = await loadTemplateSla([task.created_from_template_item_id]);
    template = tpl.get(task.created_from_template_item_id);
  }

  const { max, source, businessHoursOnly } = resolveMaxMinutes(task, rule, template);
  if (max == null) return;

  const now = new Date().toISOString();
  const elapsed = businessHoursOnly
    ? await businessMinutesBetween(task.stage_entered_at, now)
    : rawMinutes(task.stage_entered_at, now);

  if (elapsed <= max) return;

  // Skip if an open deadline exception already covers this stage.
  const { data: existing } = await supabase
    .from("exceptions")
    .select("id")
    .eq("task_id", task.id)
    .eq("kind", "deadline")
    .is("resolved_at", null)
    .eq("stage_entered_at", task.stage_entered_at)
    .limit(1);
  if (existing && existing.length > 0) return;

  const exceededBy = elapsed - max;
  const reason = `تجاوز الـSLA بـ ${exceededBy} دقيقة (${source})`;

  const { data: exc, error: excErr } = await supabase
    .from("exceptions")
    .insert({
      organization_id: task.organization_id,
      task_id: task.id,
      kind: "deadline",
      reason,
      opened_by: null,
      stage_entered_at: task.stage_entered_at,
    })
    .select("id")
    .single();
  if (excErr || !exc) {
    console.error("[sla-watcher] insert exception failed", excErr?.message);
    return;
  }

  const teamLead = await findTeamLeadForTask(task.organization_id, task.id);
  if (teamLead) {
    await supabase.from("escalations").insert({
      organization_id: task.organization_id,
      exception_id: exc.id,
      task_id: task.id,
      level: 1,
      raised_to_user_id: teamLead,
      status: "open",
    });

    await supabase.from("notifications").insert({
      organization_id: task.organization_id,
      recipient_user_id: teamLead,
      type: "SLA_BREACHED",
      title: `تصعيد SLA — ${task.title}`,
      body: reason,
      entity_type: "task",
      entity_id: task.id,
    });
  }

  await supabase.from("ai_events").insert({
    organization_id: task.organization_id,
    event_type: "SLA_BREACHED",
    entity_type: "task",
    entity_id: task.id,
    payload: {
      stage: task.stage,
      max_minutes: max,
      elapsed_minutes: elapsed,
      exceeded_by: exceededBy,
      source,
      business_hours_only: businessHoursOnly,
      escalated_to: teamLead,
    },
    importance: "high",
  });
}

async function run() {
  // Pull every non-done task. Single-tenant for now, but we partition by org.
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(
      "id, organization_id, project_id, service_id, stage, stage_entered_at, sla_override_minutes, created_from_template_item_id, title",
    )
    .neq("stage", "done");
  if (error) throw error;

  const orgIds = [...new Set((tasks ?? []).map((t) => t.organization_id))];
  const rulesByOrg = new Map<string, Map<string, SlaRuleRow>>();
  for (const orgId of orgIds) {
    rulesByOrg.set(orgId, await loadSlaRules(orgId));
  }

  let processed = 0;
  for (const task of (tasks ?? []) as TaskRow[]) {
    const rules = rulesByOrg.get(task.organization_id);
    if (!rules) continue;
    try {
      await processTask(task, rules);
      processed += 1;
    } catch (e) {
      console.error("[sla-watcher] task failed", task.id, (e as Error).message);
    }
  }

  return { processed, taskCount: tasks?.length ?? 0 };
}

Deno.serve(async () => {
  try {
    const result = await run();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
