// Odoo record shapes — only the fields we actually pull.
// Many2one fields come back as [id, display_name] tuples or `false` when unset.

export type OdooMany2one = [number, string] | false;
export type OdooMany2many = number[];
export type OdooDate = string | false; // "YYYY-MM-DD" or false
export type OdooDatetime = string | false; // "YYYY-MM-DD HH:MM:SS" UTC

export interface OdooEmployee {
  id: number;
  name: string;
  work_email: string | false;
  work_phone: string | false;
  job_title: string | false;
  department_id: OdooMany2one;
  parent_id: OdooMany2one; // manager
  active: boolean;
}

export interface OdooDepartment {
  id: number;
  name: string;
  parent_id: OdooMany2one;
  manager_id: OdooMany2one;
}

export interface OdooPartner {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  mobile: string | false;
  website: string | false;
  is_company: boolean;
  customer_rank: number;
  comment: string | false;
  street?: string | false;
  street2?: string | false;
  city?: string | false;
}

export interface OdooProject {
  id: number;
  name: string;
  partner_id: OdooMany2one;
  user_id: OdooMany2one; // project manager (Odoo standard)
  date_start: OdooDate;
  date: OdooDate; // end / deadline
  active: boolean;
  description: string | false;
  // From the rwasem_project_task_progress addon — may be absent on vanilla Odoo.
  total_progress?: number;
  // From aptuem_project_default_task — services bought (M2M to project.category).
  // These render as chips on the Rwasem project kanban card.
  category_ids?: OdooMany2many;
  // Rwasem custom fields:
  store_name?: string | false;
  account_manager_id?: OdooMany2one;
  social_specialist_id?: OdooMany2one;
  media_specialist_id?: OdooMany2one;
  seo_specialist_id?: OdooMany2one;
  target?: string | false;
  color?: number;
  is_favorite?: boolean;
  tag_ids?: OdooMany2many;
  // Members shown as avatars in the kanban card footer.
  favorite_user_ids?: OdooMany2many;
  last_update_status?: string | false;
  last_update_color?: number | false;
  // ks_gantt_view_project — Sky Light fills these on every project even
  // when the standard date_start/date are blank (only 8/75 in live Odoo).
  ks_project_start?: OdooDatetime;
  ks_project_end?: OdooDatetime;
  // rwasem_project_category_enhancements
  site_address?: string | false;
  site_address_display?: string | false;
  site_latitude?: number | false;
  site_longitude?: number | false;
  financial_info?: string | false;
  has_active_category?: boolean;
  // rwasem_project_task_progress
  // (already declared above as total_progress)
  // rwasem_document_management_project
  document_count?: number;
}

export interface OdooProjectTag {
  id: number;
  name: string;
  color: number;
}

export interface OdooProjectCategory {
  id: number;
  name: string;
  active: boolean;
  color: number;
}

export interface OdooTaskStage {
  id: number;
  name: string;
  sequence: number;
}

export interface OdooTask {
  id: number;
  name: string;
  active?: boolean;
  project_id: OdooMany2one;
  stage_id: OdooMany2one;
  user_ids: OdooMany2many;
  date_deadline: OdooDate; // Deadline / Planned Date in the manual
  create_date: OdooDatetime;
  date_end: OdooDatetime;
  description: string | false;
  priority: string;
  // Custom progress fields from rwasem_project_task_progress.
  progress_percentage?: number;
  expected_progress?: number;
  progress_slip?: number;
  // Custom category from aptuem_project_default_task — the service category.
  category_id?: OdooMany2one;
  // rwasem_project_category_enhancements / project_customization
  date_assign?: OdooDate;
  date_start?: OdooDate;
  duration_days?: number;
  // eg_task_stage_duration
  current_stage_duration?: string | false;
  working_days_open?: number;
  working_days_close?: number;
  duration_tracking?: Record<string, number> | false;
  // project_customization
  actual_done_date?: OdooDatetime;
  delay_days?: number;
  is_overdue?: boolean;
  design_count?: number;
  // rwasem_document_management_project
  document_count?: number;
  // Odoo core
  email_cc?: string | false;
}

// Map Odoo stage names → dashboard task_stage enum.
// The PDF guarantees these exact stage names exist.
export const ODOO_STAGE_NAME_TO_DASHBOARD: Record<string, string> = {
  New: "new",
  "In Progress": "in_progress",
  "Manager Review": "manager_review",
  "Specialist Review": "specialist_review",
  "Ready to Send": "ready_to_send",
  "Sent to Client": "sent_to_client",
  "Client Changes": "client_changes",
  Done: "done",
};

export function mapStageName(name: string | undefined): string {
  if (!name) return "new";
  return ODOO_STAGE_NAME_TO_DASHBOARD[name.trim()] ?? "new";
}
