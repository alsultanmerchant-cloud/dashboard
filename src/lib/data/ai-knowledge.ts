import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// AI company knowledge — the "teach the AI" store (migration 0181).
//
// Durable, org-wide instructions the team taught the assistant from the
// dashboard ("this number means X", "never call client Y churned", ...).
// listActiveKnowledge / insertKnowledge are the read/write primitives;
// buildKnowledgeBlock renders them as a prompt block injected into BOTH the
// CEO-brief generation prompt and the /agent system prompt so a lesson sticks
// everywhere and the same mistake never recurs.
// =========================================================================

export type KnowledgeKind = "correction" | "fact" | "preference" | "terminology";

export interface CompanyKnowledge {
  id: string;
  kind: KnowledgeKind;
  instruction: string;
  sourceField: string | null;
  createdAt: string;
}

type KnowledgeRow = {
  id: string;
  kind: KnowledgeKind;
  instruction: string;
  source_field: string | null;
  created_at: string;
};

export async function listActiveKnowledge(orgId: string): Promise<CompanyKnowledge[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_company_knowledge")
    .select("id, kind, instruction, source_field, created_at")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    // chronological so newer lessons reinforce / supersede older ones in-prompt
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    console.warn(`[ai-knowledge] list failed: ${error.message}`);
    return [];
  }
  return ((data ?? []) as KnowledgeRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    instruction: r.instruction,
    sourceField: r.source_field,
    createdAt: r.created_at,
  }));
}

export async function insertKnowledge(params: {
  orgId: string;
  createdBy: string | null;
  kind?: KnowledgeKind;
  instruction: string;
  sourceField?: string | null;
  wrongText?: string | null;
  correctedText?: string | null;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("ai_company_knowledge")
    .insert({
      organization_id: params.orgId,
      created_by: params.createdBy,
      kind: params.kind ?? "correction",
      instruction: params.instruction,
      source_field: params.sourceField ?? null,
      wrong_text: params.wrongText ?? null,
      corrected_text: params.correctedText ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.warn(`[ai-knowledge] insert failed: ${error.message}`);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

// --- Management (read-all + update + delete) -------------------------------

export interface KnowledgeAdminRow {
  id: string;
  kind: KnowledgeKind;
  instruction: string;
  sourceField: string | null;
  isActive: boolean;
  authorName: string | null;
  createdAt: string;
}

type KnowledgeAdminRaw = {
  id: string;
  kind: KnowledgeKind;
  instruction: string;
  source_field: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
};

/** All lessons (active + inactive) for the management UI, newest first, with author name. */
export async function listAllKnowledge(orgId: string): Promise<KnowledgeAdminRow[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_company_knowledge")
    .select("id, kind, instruction, source_field, is_active, created_at, created_by")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn(`[ai-knowledge] listAll failed: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as KnowledgeAdminRaw[];

  // Resolve author names (employee_profiles.user_id → full_name), best-effort.
  const userIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("employee_profiles")
      .select("user_id, full_name")
      .eq("organization_id", orgId)
      .in("user_id", userIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string | null; full_name: string | null }>) {
      if (p.user_id) nameByUser.set(p.user_id, p.full_name ?? "");
    }
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    instruction: r.instruction,
    sourceField: r.source_field,
    isActive: r.is_active,
    authorName: r.created_by ? nameByUser.get(r.created_by) ?? null : null,
    createdAt: r.created_at,
  }));
}

export async function updateKnowledge(
  id: string,
  orgId: string,
  patch: { instruction?: string; kind?: KnowledgeKind; isActive?: boolean },
): Promise<boolean> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.instruction !== undefined) update.instruction = patch.instruction;
  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  const { error } = await supabaseAdmin
    .from("ai_company_knowledge")
    .update(update)
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) {
    console.warn(`[ai-knowledge] update failed: ${error.message}`);
    return false;
  }
  return true;
}

export async function deleteKnowledge(id: string, orgId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("ai_company_knowledge")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) {
    console.warn(`[ai-knowledge] delete failed: ${error.message}`);
    return false;
  }
  return true;
}

const KIND_LABEL_AR: Record<KnowledgeKind, string> = {
  correction: "تصحيح",
  fact: "حقيقة",
  preference: "تفضيل",
  terminology: "مصطلح",
};

/**
 * Renders the org's active lessons as an Arabic prompt block. Returns "" when
 * there is nothing taught yet (callers append it conditionally). Injected into
 * the CEO-brief prompt and the agent system prompt.
 */
export async function buildKnowledgeBlock(orgId: string): Promise<string> {
  const items = await listActiveKnowledge(orgId);
  if (items.length === 0) return "";
  const lines = items
    .map((k, i) => `${i + 1}. [${KIND_LABEL_AR[k.kind]}] ${k.instruction}`)
    .join("\n");
  return `## معرفة الشركة المُعتمَدة (تعليمات دائمة علّمها الفريق — التزم بها حرفيًا ولا تكرّر الأخطاء السابقة)
هذه حقائق وتصحيحات أكّدها فريق الشركة. إذا تعارضت مع استنتاجك أو مع البيانات الخام، فالأولوية لهذه التعليمات في الصياغة والتفسير:
${lines}`;
}
