import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function listTaskTemplates(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("task_templates")
    .select(`
      id, name, description, is_active, created_at,
      service:services ( id, name, slug ),
      task_template_items ( count )
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getTaskTemplate(orgId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("task_templates")
    .select(`
      *,
      service:services ( id, name, slug ),
      task_template_items (
        id, title, description, default_role_key, offset_days_from_project_start,
        duration_days, priority, order_index,
        default_department:departments ( id, name )
      )
    `)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (data?.task_template_items) {
    data.task_template_items.sort(
      (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
    );
  }
  return data;
}
