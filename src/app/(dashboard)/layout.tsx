import { requireSession } from "@/lib/auth-server";
import { DashboardShell } from "./dashboard-shell";
import type { AuthInitialUser } from "@/lib/auth-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const initialUser: AuthInitialUser = {
    id: session.userId,
    email: session.email,
    name: session.fullName,
    employeeId: session.employeeId,
    orgId: session.orgId,
    departmentId: session.departmentId,
    jobTitle: session.jobTitle,
    avatarUrl: session.avatarUrl,
    roleKeys: session.roleKeys,
    roleNames: session.roleNames,
    permissions: Array.from(session.permissions),
    isOwner: session.isOwner,
    orgName: session.orgName,
  };

  return <DashboardShell initialUser={initialUser}>{children}</DashboardShell>;
}
