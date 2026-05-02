"use server";

// Feature Flags admin actions (phase T0).
//
// Every action follows the project mutation contract:
//   1. zod validate
//   2. requirePermission('feature_flag.manage') — gate
//   3. write (RLS enforces the same rule defense-in-depth)
//   4. logAudit + logAiEvent (flag flips ARE business-relevant)
//   5. revalidatePath so the gated content re-renders on the next request

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";

const KEY_RE = /^[a-z][a-z0-9_]*$/;

const ToggleSchema = z.object({
  key: z.string().regex(KEY_RE, "مفتاح غير صالح"),
  enabled: z.boolean(),
});

const RolesSchema = z.object({
  key: z.string().regex(KEY_RE, "مفتاح غير صالح"),
  rolloutRoles: z
    .array(z.string().regex(/^[a-z_]+$/, "اسم دور غير صالح"))
    .max(20, "عدد كبير من الأدوار"),
});

type ActionResult = { ok: true } | { error: string };

async function loadCurrent(key: string) {
  const { data } = await supabaseAdmin
    .from("feature_flags")
    .select("key, enabled, rollout_roles")
    .eq("key", key)
    .maybeSingle();
  return data;
}

export async function toggleFeatureFlagAction(input: {
  key: string;
  enabled: boolean;
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("feature_flag.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const before = await loadCurrent(parsed.data.key);
  if (!before) return { error: "المفتاح غير موجود" };
  if (before.enabled === parsed.data.enabled) {
    // No-op (toggling to same value). Still revalidate to be safe.
    revalidatePath("/settings/feature-flags");
    return { ok: true };
  }

  const { error } = await supabaseAdmin
    .from("feature_flags")
    .update({ enabled: parsed.data.enabled })
    .eq("key", parsed.data.key);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: parsed.data.enabled ? "feature_flag.enable" : "feature_flag.disable",
    entityType: "feature_flag",
    entityId: null,
    metadata: { key: parsed.data.key, before: before.enabled, after: parsed.data.enabled },
  });

  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "FEATURE_FLAG_TOGGLED",
    entityType: "feature_flag",
    entityId: null,
    payload: {
      key: parsed.data.key,
      before: before.enabled,
      after: parsed.data.enabled,
      rollout_roles: before.rollout_roles ?? [],
    },
    importance: "normal",
  });

  // Reset every dashboard page — gated content can live anywhere.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setFeatureFlagRolesAction(input: {
  key: string;
  rolloutRoles: string[];
}): Promise<ActionResult> {
  let session;
  try {
    session = await requirePermission("feature_flag.manage");
  } catch (e) {
    return { error: (e as Error).message };
  }

  const parsed = RolesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }

  const before = await loadCurrent(parsed.data.key);
  if (!before) return { error: "المفتاح غير موجود" };

  // Reject role keys that don't exist in the catalog. Keeps the table tidy
  // and gives the UI a clear error instead of silently no-op-ing later.
  if (parsed.data.rolloutRoles.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("roles")
      .select("key")
      .in("key", parsed.data.rolloutRoles);
    const valid = new Set((rows ?? []).map((r) => r.key));
    const bad = parsed.data.rolloutRoles.filter((k) => !valid.has(k));
    if (bad.length > 0) {
      return { error: `أدوار غير معروفة: ${bad.join("، ")}` };
    }
  }

  const dedup = Array.from(new Set(parsed.data.rolloutRoles)).sort();
  const beforeRoles = (before.rollout_roles ?? []).slice().sort();
  const same =
    dedup.length === beforeRoles.length &&
    dedup.every((r, i) => r === beforeRoles[i]);
  if (same) {
    revalidatePath("/settings/feature-flags");
    return { ok: true };
  }

  const { error } = await supabaseAdmin
    .from("feature_flags")
    .update({ rollout_roles: dedup })
    .eq("key", parsed.data.key);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "feature_flag.set_roles",
    entityType: "feature_flag",
    entityId: null,
    metadata: { key: parsed.data.key, before: beforeRoles, after: dedup },
  });

  await logAiEvent({
    organizationId: session.orgId,
    actorUserId: session.userId,
    eventType: "FEATURE_FLAG_ROLES_CHANGED",
    entityType: "feature_flag",
    entityId: null,
    payload: { key: parsed.data.key, before: beforeRoles, after: dedup },
    importance: "low",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
