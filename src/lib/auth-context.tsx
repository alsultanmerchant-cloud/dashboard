"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  roleId: string;
  roleName: string;
  allowedPages: string[];
  isSuperAdmin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  activeOrgId: string;
  switchOrg: (orgId: string) => void;
  orgs: { id: string; name: string; nameAr: string }[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeOrgId, setActiveOrgId] = useState("");
  const [orgs, setOrgs] = useState<{ id: string; name: string; nameAr: string }[]>([]);

  const loadUser = useCallback(async () => {
    const supabase = createClient();

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Fetch profile with role
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*, roles(*)")
      .eq("id", authUser.id)
      .single();

    if (!profile) {
      setUser(null);
      setLoading(false);
      return;
    }

    const role = profile.roles as { id: string; name: string; slug: string; allowed_pages: string[] };

    const authUserData: AuthUser = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      orgId: profile.org_id,
      roleId: role.id,
      roleName: role.name,
      allowedPages: role.allowed_pages,
      isSuperAdmin: profile.is_super_admin,
    };

    setUser(authUserData);

    // Set org_id in localStorage for db.ts compatibility
    const orgId = localStorage.getItem("cc_org_id") || profile.org_id;
    // Non-super-admin always uses their own org
    const effectiveOrgId = profile.is_super_admin ? orgId : profile.org_id;
    setActiveOrgId(effectiveOrgId);
    localStorage.setItem("cc_org_id", effectiveOrgId);

    // Load orgs — all for super admin, own org for others
    if (profile.is_super_admin) {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id, name, name_ar")
        .order("created_at");
      if (orgData) {
        setOrgs(orgData.map((o) => ({ id: o.id, name: o.name, nameAr: o.name_ar || o.name })));
      }
    } else {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id, name, name_ar")
        .eq("id", profile.org_id)
        .single();
      if (orgData) {
        setOrgs([{ id: orgData.id, name: orgData.name, nameAr: orgData.name_ar || orgData.name }]);
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadUser();

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadUser]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem("cc_org_id");
    router.push("/login");
  }, [router]);

  const switchOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    localStorage.setItem("cc_org_id", orgId);
    // Force re-render by updating state — pages with orgId in useEffect deps will refetch
    window.dispatchEvent(new Event("org-switch"));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, activeOrgId, switchOrg, orgs }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
