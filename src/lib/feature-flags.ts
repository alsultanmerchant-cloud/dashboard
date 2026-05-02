// Feature-flag runtime helper (phase T0).
//
// Single source of truth for "is this flag on for this user?" — used by
// pages, server actions, and the <FeatureFlag /> component.
//
// Resolution rules (matches docs/ENGINEERING_PLAN.md T0):
//   1. Flag must exist in public.feature_flags (returns false otherwise).
//   2. If `rollout_roles` is empty → the `enabled` bit alone decides.
//   3. If `rollout_roles` is non-empty → user must hold ≥1 of those role
//      keys AND `enabled` must be true.
//   4. Owners always satisfy the role check (per CLAUDE.md "owner = full
//      override").
//
// We cache per-request via React.cache so a page that gates 5 sections
// hits the DB once.

import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ServerSession } from "@/lib/auth-server";

/** Subset of the session shape we actually need. Keeps unit tests cheap. */
export type FlagUserContext = Pick<ServerSession, "userId" | "roleKeys" | "isOwner"> | null;

export type FeatureFlag = {
  key: string;
  enabled: boolean;
  rollout_roles: string[];
  description: string | null;
  updated_at: string;
};

/**
 * Pure resolver — given a flag row + a user, returns whether the flag
 * should be on. Exported for unit tests and server-only code that has
 * already loaded the row.
 */
export function resolveFlag(
  flag: Pick<FeatureFlag, "enabled" | "rollout_roles"> | null | undefined,
  user: FlagUserContext,
): boolean {
  if (!flag) return false;
  if (!flag.enabled) return false;
  const roles = flag.rollout_roles ?? [];
  if (roles.length === 0) return true;
  if (!user) return false;
  if (user.isOwner) return true; // owners override role-based rollout
  return roles.some((r) => user.roleKeys.includes(r));
}

/** Per-request cached fetch of every flag (cheap — table is tiny). */
const loadFlags = cache(async (): Promise<Map<string, FeatureFlag>> => {
  const { data, error } = await supabaseAdmin
    .from("feature_flags")
    .select("key, enabled, rollout_roles, description, updated_at");
  if (error) {
    console.error("[feature_flags_load_failed]", error.message);
    return new Map();
  }
  const map = new Map<string, FeatureFlag>();
  for (const row of data ?? []) map.set(row.key, row as FeatureFlag);
  return map;
});

/** Fetch a single flag (cached per-request). */
export async function getFlag(key: string): Promise<FeatureFlag | null> {
  const map = await loadFlags();
  return map.get(key) ?? null;
}

/** List every flag (cached per-request). For the admin settings page. */
export async function listFlags(): Promise<FeatureFlag[]> {
  const map = await loadFlags();
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Primary public entrypoint.
 *
 *   const showSales = await isFlagOn("sales_track_enabled", session);
 */
export async function isFlagOn(
  key: string,
  user: FlagUserContext,
): Promise<boolean> {
  const flag = await getFlag(key);
  return resolveFlag(flag, user);
}
