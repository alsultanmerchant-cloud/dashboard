import { requireSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DashboardShell } from "./dashboard-shell";
import type { AuthInitialUser } from "@/lib/auth-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const { data: profile } = await supabaseAdmin
    .from("employee_profiles")
    .select("department_id, job_title, avatar_url, email")
    .eq("id", session.employeeId)
    .maybeSingle();

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, name")
    .eq("id", session.orgId)
    .maybeSingle();

  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role:roles ( key, name )")
    .eq("user_id", session.userId)
    .eq("organization_id", session.orgId);

  const roleNames: string[] = [];
  for (const row of roleRows ?? []) {
    const role = Array.isArray(row.role) ? row.role[0] : row.role;
    if (role?.name) roleNames.push(role.name);
  }

  const initialUser: AuthInitialUser = {
    id: session.userId,
    email: profile?.email ?? session.email,
    name: session.fullName,
    employeeId: session.employeeId,
    orgId: session.orgId,
    departmentId: profile?.department_id ?? null,
    jobTitle: profile?.job_title ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    roleKeys: session.roleKeys,
    roleNames,
    permissions: Array.from(session.permissions),
    isOwner: session.isOwner,
    orgName: org?.name ?? "",
  };

  return <DashboardShell initialUser={initialUser}>{children}</DashboardShell>;
}
