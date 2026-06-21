import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ServerSession = {
  userId: string;
  email: string;
  employeeId: string;
  orgId: string;
  orgName: string;
  fullName: string;
  departmentId: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  roleKeys: string[];
  roleNames: string[];
  permissions: Set<string>;
  isOwner: boolean;
};

function isExpectedDynamicServerUsage(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    err.digest === "DYNAMIC_SERVER_USAGE"
  );
}

export const getServerSession = cache(async (): Promise<ServerSession | null> => {
  try {
    return await loadSession();
  } catch (err) {
    // Next.js throws this during static generation to mark the route dynamic
    // when session lookup touches cookies(). That is expected for protected
    // pages, so don't spam build logs.
    if (isExpectedDynamicServerUsage(err)) {
      return null;
    }

    // Treat unexpected auth/session bootstrap failures as "no session" so
    // callers redirect instead of 503'ing the page. Common cause:
    // SUPABASE_SERVICE_ROLE_KEY missing in this environment (see admin.ts).
    console.error("[getServerSession] failed:", err);
    return null;
  }
});

async function loadSession(): Promise<ServerSession | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const email =
    typeof data.claims.email === "string" ? data.claims.email : "";

  // One round-trip: profile + nested org.
  const { data: profile } = await supabaseAdmin
    .from("employee_profiles")
    .select(
      "id, full_name, email, organization_id, department_id, job_title, avatar_url, organization:organizations!employee_profiles_organization_id_fkey ( id, name )",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return null;

  const org = Array.isArray(profile.organization) ? profile.organization[0] : profile.organization;

  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role:roles ( key, name, role_permissions ( permission:permissions ( key ) ) )")
    .eq("user_id", userId)
    .eq("organization_id", profile.organization_id);

  const roleKeys: string[] = [];
  const roleNames: string[] = [];
  const permissions = new Set<string>();
  for (const row of roleRows ?? []) {
    const role = Array.isArray(row.role) ? row.role[0] : row.role;
    if (!role) continue;
    roleKeys.push(role.key);
    if (role.name) roleNames.push(role.name);
    for (const rp of role.role_permissions ?? []) {
      const perm = Array.isArray(rp.permission) ? rp.permission[0] : rp.permission;
      if (perm?.key) permissions.add(perm.key);
    }
  }

  return {
    userId,
    email: profile.email ?? email,
    employeeId: profile.id,
    orgId: profile.organization_id,
    orgName: org?.name ?? "",
    fullName: profile.full_name,
    departmentId: profile.department_id,
    jobTitle: profile.job_title,
    avatarUrl: profile.avatar_url,
    roleKeys,
    roleNames,
    permissions,
    isOwner: roleKeys.includes("owner"),
  };
}

/**
 * Which dashboard a user sees is derived from ORG STRUCTURE, not an RBAC role
 * (there is no `head`/`team_lead` role). Resolution order: owner/admin → ceo;
 * else department head (departments.head_employee_id) → head; else referenced
 * by employee_profiles.team_leader_employee_id → team_lead; else ceo fallback.
 *
 * `memberEmployeeIds` is the set of employee_profiles.id the leader oversees
 * (excluding self). Used to scope task/leave/warning queries on the dashboard.
 */
export type DashboardScope =
  | { kind: "ceo" }
  | { kind: "head"; departmentId: string; departmentName: string; memberEmployeeIds: string[] }
  | { kind: "team_lead"; departmentId: string | null; memberEmployeeIds: string[] }
  | { kind: "agent"; employeeId: string };

export const getDashboardScope = cache(async (session: ServerSession): Promise<DashboardScope> => {
  // Owner/admin always get the executive (CEO) view. The department-lead role
  // (Head of Technical / Department Manager) also gets the org-wide executive
  // view — even when they head a department in the data — but the financial
  // blocks on it are gated separately by the `finance.view` permission.
  if (
    session.isOwner ||
    session.roleKeys.includes("admin") ||
    session.roleKeys.includes("dept_lead")
  ) {
    return { kind: "ceo" };
  }

  // Structural scope checks are independent. Run them together and bound
  // them so a slow Supabase request cannot leave /dashboard on its route-level
  // loading skeleton forever.
  const scopeSignal = AbortSignal.timeout(6_000);
  const [headedResult, reportsResult] = await Promise.all([
    supabaseAdmin
      .from("departments")
      .select("id, name")
      .eq("organization_id", session.orgId)
      .eq("head_employee_id", session.employeeId)
      .order("created_at", { ascending: true })
      .limit(1)
      .abortSignal(scopeSignal),
    supabaseAdmin
      .from("employee_profiles")
      .select("id, department_id")
      .eq("organization_id", session.orgId)
      .eq("team_leader_employee_id", session.employeeId)
      .abortSignal(scopeSignal),
  ]);

  if (headedResult.error) {
    console.error("[getDashboardScope] department-head lookup failed:", headedResult.error.message);
  }
  if (reportsResult.error) {
    console.error("[getDashboardScope] team-lead lookup failed:", reportsResult.error.message);
  }

  // Head: this employee heads at least one department.
  const headed = headedResult.data;
  if (headed && headed.length > 0) {
    const dept = headed[0];
    const { data: members, error: membersError } = await supabaseAdmin
      .from("employee_profiles")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("department_id", dept.id)
      .neq("id", session.employeeId)
      .abortSignal(scopeSignal);
    if (membersError) {
      console.error("[getDashboardScope] department-members lookup failed:", membersError.message);
    }
    return {
      kind: "head",
      departmentId: dept.id,
      departmentName: dept.name,
      memberEmployeeIds: (members ?? []).map((m) => m.id),
    };
  }

  // Team lead: at least one employee reports to this employee as team leader.
  const reports = reportsResult.data;
  if (reports && reports.length > 0) {
    return {
      kind: "team_lead",
      departmentId: reports.find((r) => r.department_id)?.department_id ?? session.departmentId,
      memberEmployeeIds: reports.map((r) => r.id),
    };
  }

  // Executive-capable non-leaders (manager/viewer with reports.view) keep the
  // org-wide CEO view; everyone else who can work tasks gets a PERSONAL view
  // (My Performance / My Tasks) instead of leaking the executive dashboard.
  if (hasPermission(session, "reports.view")) {
    return { kind: "ceo" };
  }
  if (hasPermission(session, "tasks.view")) {
    return { kind: "agent", employeeId: session.employeeId };
  }

  return { kind: "ceo" };
});

export async function requireSession(): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(perm: string): Promise<ServerSession> {
  const session = await requireSession();
  if (!session.isOwner && !session.permissions.has(perm)) {
    throw new Error(`صلاحية مفقودة: ${perm}`);
  }
  return session;
}

export function hasPermission(session: ServerSession, perm: string) {
  return session.isOwner || session.permissions.has(perm);
}

/**
 * Page-level permission guard. Use in server components.
 * - Not authenticated → redirect to /login.
 * - Authenticated but missing the permission → redirect to /dashboard
 *   (gracefully sends the user back to a page they can use).
 * Use `requirePermission` (which throws) for server actions instead, so the
 * action can return a structured `{ error }` to the form.
 */
export async function requirePagePermission(perm: string): Promise<ServerSession> {
  const session = await requireSession();
  if (!hasPermission(session, perm)) {
    redirect("/dashboard");
  }
  return session;
}

/** Same as requirePagePermission but accepts any-of a list. */
export async function requirePagePermissionAny(perms: string[]): Promise<ServerSession> {
  const session = await requireSession();
  if (session.isOwner) return session;
  if (!perms.some((p) => session.permissions.has(p))) {
    redirect("/dashboard");
  }
  return session;
}

/**
 * Picks the home page that best matches the caller's daily job (Sky Light
 * operations PDF §9 + audit in this session). Used by `/` and the auth
 * callback so each role lands on the page they actually use.
 *
 * Temporary default    → /projects whenever the caller can view projects
 * Account manager      → /am/<id>/dashboard when projects are unavailable
 * Specialist           → /uploads (upload-deadline queue per PDF §11)
 * Agent / team_lead    → /tasks (assigned-to-me list; agent queue page TBD)
 *
 * Falls back to /dashboard. The fallback is also safe to redirect to from
 * `requirePagePermission` because /dashboard requires only a session.
 */
export function landingPathFor(session: ServerSession): string {
  if (hasPermission(session, "projects.view")) return "/projects";
  if (session.roleKeys.includes("account_manager") && session.employeeId) {
    return `/am/${session.employeeId}/dashboard`;
  }
  if (session.roleKeys.includes("specialist")) return "/uploads";
  // Structural heads / team-leaders land on /dashboard, which self-routes to
  // the scoped department view via getDashboardScope().
  if (session.roleKeys.includes("team_lead")) return "/dashboard";
  if (session.roleKeys.includes("agent")) return "/tasks";
  return "/dashboard";
}
