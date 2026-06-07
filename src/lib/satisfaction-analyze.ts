import "server-only";
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit, logAiEvent } from "@/lib/audit";
import { SatisfactionSchema, type SatisfactionResult } from "@/lib/satisfaction-schema";
import { buildClientTranscripts } from "@/lib/data/satisfaction";

// Shared client-satisfaction analysis core. Used by the on-demand API route
// (/api/satisfaction/analyze) AND the daily cron (/api/cron/wa-analyze).
// Reads the merged transcript (one-time .txt import + live WhatsApp messages),
// runs Gemini, and stores the result as the client's current analysis.

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3-flash-preview";
const MAX_CHARS = 45_000;

function trim(t: string): string {
  if (t.length <= MAX_CHARS) return t;
  return "…(الأقدم محذوف)\n" + t.slice(t.length - MAX_CHARS);
}

export class NoTranscriptError extends Error {
  constructor() {
    super("لا توجد محادثات مستوردة لهذا العميل بعد");
    this.name = "NoTranscriptError";
  }
}

export interface AnalyzeOutcome {
  analysisId: string;
  result: SatisfactionResult;
}

export async function analyzeClientSatisfaction(
  orgId: string,
  clientId: string,
  actorUserId: string | null,
): Promise<AnalyzeOutcome> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("name")
    .eq("organization_id", orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("العميل غير موجود");

  const transcripts = await buildClientTranscripts(orgId, clientId);
  if (!transcripts.client && !transcripts.technical) throw new NoTranscriptError();

  const clientBlock = transcripts.client || "(لم تتوفر محادثة مع العميل)";
  const technicalBlock = transcripts.technical || "(لم تتوفر محادثة الفريق التقني)";

  const { object: result } = await generateObject({
    model: google(MODEL),
    schema: SatisfactionSchema,
    prompt: `أنت محلل علاقات عملاء في وكالة تسويق سعودية (Sky Light). قيّم رضا العميل "${client.name}" وجودة التنفيذ من خلال محادثتي واتساب:

1) "مجموعة العميل" — التواصل المباشر مع العميل (هنا يظهر الرضا، الشكاوى، التعديلات، نبرة العميل).
2) "مجموعة الفريق التقني" — التنسيق الداخلي للفريق حول البريف والتنفيذ (منها نقيس مدى الالتزام بالبريف).

التعليمات:
- satisfactionScore (0-100): من نبرة العميل ونتائج التعامل في "مجموعة العميل".
- briefAdherenceScore (0-100): مدى مطابقة التنفيذ لمتطلبات العميل كما يظهر في "مجموعة الفريق التقني". null إن لم تتوفر.
- sentiment, summary (عربي ٢-٤ جمل), highlights (ثناء/شكوى/طلب/تصعيد/إنجاز مع التاريخ)، sentimentTimeline (period مثل 2026-04)، risks (الأهم أولًا).
استند فقط لما ورد في المحادثات.

=== مجموعة العميل ===
${trim(clientBlock)}

=== مجموعة الفريق التقني ===
${trim(technicalBlock)}`,
  });

  // Latest import ids (for provenance), best-effort.
  const { data: imp } = await supabaseAdmin
    .from("client_chat_imports")
    .select("id, group_kind, created_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  const rows = (imp ?? []) as Array<{ id: string; group_kind: string }>;
  const clientImportId = rows.find((r) => r.group_kind === "client")?.id ?? null;
  const technicalImportId = rows.find((r) => r.group_kind === "technical")?.id ?? null;

  await supabaseAdmin
    .from("client_satisfaction_analyses")
    .update({ is_current: false })
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .eq("is_current", true);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("client_satisfaction_analyses")
    .insert({
      organization_id: orgId,
      client_id: clientId,
      satisfaction_score: result.satisfactionScore,
      brief_adherence_score: result.briefAdherenceScore,
      sentiment: result.sentiment,
      summary: result.summary,
      highlights: result.highlights,
      sentiment_timeline: result.sentimentTimeline,
      risks: result.risks,
      model: MODEL,
      client_import_id: clientImportId,
      technical_import_id: technicalImportId,
      is_current: true,
      analyzed_by: actorUserId,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(insErr?.message ?? "تعذر حفظ التحليل");

  await logAudit({
    organizationId: orgId,
    actorUserId,
    action: "client.satisfaction_analyzed",
    entityType: "client",
    entityId: clientId,
    metadata: { score: result.satisfactionScore, sentiment: result.sentiment },
  });
  await logAiEvent({
    organizationId: orgId,
    actorUserId,
    eventType: "CLIENT_SATISFACTION_ANALYZED",
    entityType: "client",
    entityId: clientId,
    payload: {
      satisfactionScore: result.satisfactionScore,
      briefAdherenceScore: result.briefAdherenceScore,
      sentiment: result.sentiment,
    },
    importance: result.satisfactionScore < 50 ? "high" : "normal",
  });

  return { analysisId: inserted.id, result };
}
