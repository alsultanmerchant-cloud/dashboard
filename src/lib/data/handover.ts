import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function listHandovers(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("sales_handover_forms")
    .select(`
      id, status, urgency_level, client_name, client_contact_name, client_phone,
      client_email, project_start_date, sales_notes, package_details,
      selected_service_ids, created_at,
      assigned_account_manager:employee_profiles!sales_handover_forms_assigned_account_manager_employee_id_fkey ( id, full_name ),
      project:projects ( id, name )
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}
