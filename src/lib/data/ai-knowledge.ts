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
