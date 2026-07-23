import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { autoResolveOpenQuestions } from "@/lib/satisfaction-questions";

// Answer a satisfaction question. The answer is documented ground truth for
// the AI passes; outcome=resolved ALSO writes the standard issue-keyed overlay
// ai_event so /satisfaction and /accountability close the issue everywhere.

const AnswerSchema = z.object({
  outcome: z.enum(["resolved", "still_open"]),
  answer: z.string().trim().min(3, "اكتب إجابة من 3 أحرف على الأقل").max(4_000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requirePermission("clients.manage");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }

  const { id } = await params;
  // Fail fast on a non-uuid path segment: `.eq("id", id)` on a uuid column would
  // otherwise surface as a 500 (invalid input syntax) instead of a 404.
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "السؤال غير موجود" }, { status: 404 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const parsed = AnswerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
      { status: 400 },
    );
  }
  const { outcome, answer } = parsed.data;

  const { data: question, error: questionError } = await supabaseAdmin
    .from("satisfaction_questions")
    .select("id, client_id, analysis_id, kind, issue, status")
    .eq("organization_id", session.orgId)
    .eq("id", id)
    .maybeSingle();
  if (questionError) {
    return Response.json({ error: questionError.message }, { status: 500 });
  }
  if (!question) {
    return Response.json({ error: "السؤال غير موجود" }, { status: 404 });
  }
  if (question.status !== "open") {
    return Response.json({ error: "تمت الإجابة على هذا السؤال بالفعل" }, { status: 409 });
  }

  // `.eq("status","open") + select` makes the update race-safe: a concurrent
  // answer (or an auto_resolve) leaves zero rows and we report the conflict.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("satisfaction_questions")
    .update({
      status: "answered",
      answer,
      answer_outcome: outcome,
      answered_by: session.userId,
      answered_at: new Date().toISOString(),
    })
    .eq("organization_id", session.orgId)
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return Response.json({ error: "تمت الإجابة على هذا السؤال بالفعل" }, { status: 409 });
  }

  if (outcome === "resolved") {
    // The read sides (/satisfaction, /accountability) fold the overlay only for
    // the client's CURRENT analysis. The daily re-analysis rotates is_current to
    // a new row, so a question created against an older analysis would close a
    // superseded snapshot and stay open everywhere. Anchor the event on the
    // current analysis (if the issue still lives there) AND the question's
    // original analysis, so the closure lands wherever the issue is shown.
    const { data: current } = await supabaseAdmin
      .from("client_satisfaction_analyses")
      .select("id")
      .eq("organization_id", session.orgId)
      .eq("client_id", question.client_id)
      .eq("is_current", true)
      .maybeSingle();
    const targetIds = [...new Set([current?.id, question.analysis_id].filter(Boolean))] as string[];
    if (targetIds.length > 0) {
      // Same payload shape the refresh pass writes. recommendationIndex is
      // informational (the read side keys by issue text) and unknown here.
      const events = targetIds.map((analysisId) => ({
        organization_id: session.orgId,
        actor_user_id: session.userId,
        event_type: "SATISFACTION_RECOMMENDATION_STATUS_CHANGED",
        entity_type: "satisfaction_analysis",
        entity_id: analysisId,
        importance: "normal",
        payload: {
          clientId: question.client_id,
          recommendationIndex: null,
          issue: question.issue,
          state: "resolved",
          source: "human_answer",
          kind: question.kind,
          evidence: answer,
        },
      }));
      const { error: eventError } = await supabaseAdmin.from("ai_events").insert(events);
      if (eventError) {
        return Response.json({ error: eventError.message }, { status: 500 });
      }
    }
    // The issue is overlay-resolved now — close any other open question rows
    // still keyed to it (defensive; the partial unique index allows only one).
    await autoResolveOpenQuestions(session.orgId, question.client_id, [question.issue]);
  }

  await logAudit({
    organizationId: session.orgId,
    actorUserId: session.userId,
    action: "satisfaction.question_answered",
    entityType: "satisfaction_question",
    entityId: id,
    metadata: {
      clientId: question.client_id,
      analysisId: question.analysis_id,
      issue: question.issue,
      outcome,
    },
  });

  revalidatePath("/satisfaction");
  revalidatePath("/satisfaction/questions");
  return Response.json({ ok: true });
}
