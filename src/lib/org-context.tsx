"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface Organization {
  id: string;
  name: string;
  nameAr: string;
  avatar: string;
}

export const ORGANIZATIONS: Organization[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "قائمه الطلبات",
    nameAr: "قائمه الطلبات",
    avatar: "ق",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "حجوزات",
    nameAr: "حجوزات",
    avatar: "ح",
  },
];

interface OrgContextValue {
  orgId: string;
  org: Organization;
  switchOrg: (id: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

function getStoredOrgId(): string {
  if (typeof window === "undefined") return ORGANIZATIONS[0].id;
  return localStorage.getItem("cc_org_id") || ORGANIZATIONS[0].id;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgId] = useState<string>(getStoredOrgId);

  const switchOrg = useCallback((id: string) => {
    setOrgId(id);
    localStorage.setItem("cc_org_id", id);
  }, []);

  const org = ORGANIZATIONS.find((o) => o.id === orgId) || ORGANIZATIONS[0];

  return (
    <OrgContext.Provider value={{ orgId, org, switchOrg }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
