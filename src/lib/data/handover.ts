import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function listHandovers(
  orgId: string,
  paging: { page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.max(1, Math.min(100, paging.pageSize ?? 25));
  const page = Math.max(1, paging.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabaseAdmin
    .from("sales_handover_forms")
    .select(
      `id, status, urgency_level, client_name, client_contact_name, client_phone,
       client_email, project_start_date, sales_notes, package_details,
       selected_service_ids, created_at,
       assigned_account_manager:employee_profiles!sales_handover_forms_assigned_account_manager_employee_id_fkey ( id, full_name ),
       project:projects ( id, name )`,
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}
