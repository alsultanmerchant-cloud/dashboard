import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Agent AI cache (migration 0206) — the last generated result for each of the
// cockpit's AI cards, per (employee, kind). The dashboard renders the cached
// payload instantly on load (no Gemini call); the agent presses "re-analyse"
// to regenerate, and the client saves the fresh result back here on finish.
// =========================================================================

export type AgentAiKind = "growth_coach" | "tech_tip" | "today_priorities";

export const AGENT_AI_KINDS: readonly AgentAiKind[] = [
  "growth_coach",
  "tech_tip",
  "today_priorities",
];

export function isAgentAiKind(v: unknown): v is AgentAiKind {
  return typeof v === "string" && (AGENT_AI_KINDS as readonly string[]).includes(v);
}

export interface AgentAiCacheEntry<T> {
  payload: T;
  generatedAt: string;
}

const getAgentAiCaches = cache(async (
  orgId: string,
  employeeId: string,
): Promise<Map<AgentAiKind, AgentAiCacheEntry<unknown>>> => {
  const { data, error } = await supabaseAdmin
    .from("agent_ai_cache")
    .select("kind, payload, generated_at")
    .eq("organization_id", orgId)
    .eq("employee_id", employeeId);
  if (error || !data) return new Map();

  const entries = new Map<AgentAiKind, AgentAiCacheEntry<unknown>>();
  for (const row of data) {
    if (!isAgentAiKind(row.kind)) continue;
    entries.set(row.kind, {
      payload: row.payload,
      generatedAt: row.generated_at as string,
    });
  }
  return entries;
});

export async function getAgentAiCache<T>(
  orgId: string,
  employeeId: string,
  kind: AgentAiKind,
): Promise<AgentAiCacheEntry<T> | null> {
  const entry = (await getAgentAiCaches(orgId, employeeId)).get(kind);
  return entry
    ? { payload: entry.payload as T, generatedAt: entry.generatedAt }
    : null;
}

export async function saveAgentAiCache(
  orgId: string,
  employeeId: string,
  kind: AgentAiKind,
  payload: unknown,
): Promise<void> {
  const { error } = await supabaseAdmin.from("agent_ai_cache").upsert(
    {
      organization_id: orgId,
      employee_id: employeeId,
      kind,
      payload: payload as never,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,employee_id,kind" },
  );
  if (error) throw error;
}
