"use client";

// Auth context — Phase 2 rewrite.
// Sources of truth:
//   auth.users          -> identity (Supabase managed)
//   employee_profiles   -> profile (full_name, department, job_title, avatar)
//   user_roles + roles  -> role assignment (key, name)
//   role_permissions    -> permission catalogue (string keys)
//
// Backward-compat fields (`roleName`, `allowedPages`, `isSuperAdmin`) are
// synthesized so legacy pages still mount; new code should prefer
// `permissions`, `roleKeys`, and `isOwner`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface AuthUser {
  // identity
  id: string;
  email: string;
  // profile
  name: string;
  employeeId: string;
  orgId: string;
  departmentId: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  // RBAC
  roleKeys: string[];
  roleNames: string[];
  permissions: Set<string>;
  isOwner: boolean;
  // backward-compat (legacy pages)
  roleName: string;
  allowedPages: string[];
  isSuperAdmin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
  // org-switcher hooks (single-tenant: no-op kept for sidebar shell)
  activeOrgId: string;
  switchOrg: (orgId: string) => void;
  orgs: { id: string; name: string; nameAr: string }[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Aligned with the routes that exist post-Phase-1.
// Phase 3 replaces this with permission-keyed nav config.
const LEGACY_ALLOWED_FOR_OWNER = [
  "dashboard",
  "agent",
  "team",
  "finance",
  "users",
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<{ id: string; name: string; nameAr: string }[]>([]);
  const [activeOrgId, setActiveOrgId] = useState("");

  const loadUser = useCallback(async () => {
    const supabase = createClient();

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Pull profile + organization in one query.
    const { data: profileRow, error: profileErr } = await supabase
      .from("employee_profiles")
      .select(
        "id, full_name, email, organization_id, department_id, job_title, avatar_url, organization:organizations ( id, name, slug )",
      )
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (profileErr || !profileRow) {
      setUser(null);
      setLoading(false);
      return;
    }

    const org = Array.isArray(profileRow.organization)
      ? profileRow.organization[0]
      : profileRow.organization;

    // Roles + permissions in one nested query.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select(
        "role:roles ( id, key, name, role_permissions ( permission:permissions ( key ) ) )",
      )
      .eq("user_id", authUser.id)
      .eq("organization_id", profileRow.organization_id);

    const roleKeys: string[] = [];
    const roleNames: string[] = [];
    const permissions = new Set<string>();
    for (const row of roleRows ?? []) {
      const role = Array.isArray(row.role) ? row.role[0] : row.role;
      if (!role) continue;
      roleKeys.push(role.key);
      roleNames.push(role.name);
      for (const rp of role.role_permissions ?? []) {
        const perm = Array.isArray(rp.permission) ? rp.permission[0] : rp.permission;
        if (perm?.key) permissions.add(perm.key);
      }
    }
    const isOwner = roleKeys.includes("owner");

    setUser({
      id: authUser.id,
      email: profileRow.email ?? authUser.email ?? "",
      name: profileRow.full_name,
      employeeId: profileRow.id,
      orgId: profileRow.organization_id,
      departmentId: profileRow.department_id,
      jobTitle: profileRow.job_title,
      avatarUrl: profileRow.avatar_url,
      roleKeys,
      roleNames,
      permissions,
      isOwner,
      roleName: roleNames[0] ?? "",
      allowedPages: LEGACY_ALLOWED_FOR_OWNER,
      isSuperAdmin: isOwner,
    });
    setActiveOrgId(profileRow.organization_id);
    setOrgs(org ? [{ id: org.id, name: org.name, nameAr: org.name }] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUser();

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setLoading(false);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        loadUser();
      }
    });

    return () => subscription.unsubscribe();
  }, [loadUser]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push("/login");
  }, [router]);

  const hasPermission = useCallback(
    (perm: string) => !!user && (user.isOwner || user.permissions.has(perm)),
    [user],
  );

  // Single-tenant: no real org switching; kept as a stub for sidebar shell.
  const switchOrg = useCallback(() => {
    /* no-op */
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signOut, hasPermission, activeOrgId, switchOrg, orgs }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
