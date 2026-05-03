import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function listProjects(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(`
      id, name, status, priority, start_date, end_date, created_at,
      hold_reason, held_at, cycle_length_months, next_renewal_date,
      client:clients ( id, name ),
      account_manager:employee_profiles!projects_account_manager_employee_id_fkey ( id, full_name ),
      project_services ( service:services ( id, name, slug ) ),
      tasks(count)
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getProject(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(`
      *,
      client:clients ( id, name, contact_name, phone, email ),
      account_manager:employee_profiles!projects_account_manager_employee_id_fkey ( id, full_name, job_title ),
      project_services ( id, status, service:services ( id, name, slug ) ),
      project_members ( id, role_label, employee:employee_profiles ( id, full_name, job_title, avatar_url ) )
    `)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectTaskSummary(orgId: string, projectId: string) {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("stage, status")
    .eq("organization_id", orgId)
    .eq("project_id", projectId);

  const summary = {
    total: 0,
    // Sky Light / Rwasem stages
    new: 0,
    in_progress: 0,
    manager_review: 0,
    specialist_review: 0,
    ready_to_send: 0,
    sent_to_client: 0,
    client_changes: 0,
    done: 0,
    // Legacy status counts (kept for any older callers).
    todo: 0,
    review: 0,
    blocked: 0,
    cancelled: 0,
  } as Record<string, number>;

  for (const row of data ?? []) {
    summary.total += 1;
    if (row.stage) summary[row.stage] = (summary[row.stage] ?? 0) + 1;
    if (row.status) summary[row.status] = (summary[row.status] ?? 0) + 1;
  }
  return summary;
}
