import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function listEmployees(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select(
      "*, department:departments!employee_profiles_department_id_fkey ( id, name, slug, kind )",
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listAccountManagers(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, full_name, job_title, user_id")
    .eq("organization_id", orgId)
    .eq("employment_status", "active")
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}

export async function listServices(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("services")
    .select("id, name, slug, description")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listDepartments(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("departments")
    .select("id, name, slug, description, kind, parent_department_id")
    .eq("organization_id", orgId)
    .order("kind")
    .order("name");
  if (error) throw error;
  return data ?? [];
}
