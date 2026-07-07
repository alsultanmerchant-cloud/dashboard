import { streamObject } from "ai";
import { getServerSession } from "@/lib/auth-server";
import { aiModel, MODELS } from "@/lib/ai-model";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { getMyFailureDetail } from "@/lib/data/my-performance";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FailureLessonSchema } from "@/lib/my-performance/lesson-schema";
import { buildFailureLessonPrompt } from "@/lib/my-performance/lesson-prompt";
import {
  lessonSignature,
  getCachedLesson,
  saveCachedLesson,
} from "@/lib/my-performance/lesson-cache";

export const runtime = "nodejs";
export const maxDuration = 60;


// Cheap cache check: returns the persisted lesson for one task (or null), so
// the modal renders instantly without a Gemini call when one was generated
// before and is still valid (signature + knowledge fresh).
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const employeeId = session.employeeId;
  const taskId = new URL(request.url).searchParams.get("taskId") ?? "";
  if (!employeeId || !taskId) {
    return Response.json({ lesson: null, generatedAt: null });
  }
  const detail = await getMyFailureDetail(session.orgId, employeeId, taskId);
  if (!detail) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  const cached = await getCachedLesson(
    session.orgId,
    employeeId,
    taskId,
    lessonSignature(detail),
  );
  return Response.json({
    lesson: cached?.lesson ?? null,
    generatedAt: cached?.generatedAt ?? null,
  });
}

// Private per-failure post-mortem for the signed-in specialist. The failure
// detail is loaded from THEIR OWN evidence (authorization: a task that isn't
// one of their measured failures returns 404). Numbers computed server-side;
// the model only writes the lesson. Nothing persisted.
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const employeeId = session.employeeId;
  if (!employeeId) {
    return new Response(JSON.stringify({ error: "No profile" }), { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    taskId?: string;
    locale?: string;
  };
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const locale = body.locale === "en" ? "en" : "ar";
  if (!taskId) {
    return new Response(JSON.stringify({ error: "Missing taskId" }), { status: 400 });
  }

  const detail = await getMyFailureDetail(session.orgId, employeeId, taskId);
  if (!detail) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  // Specialization (department name) makes the coaching technical, not generic.
  const { data: prof } = await supabaseAdmin
    .from("employee_profiles")
    .select("department:departments!employee_profiles_department_id_fkey(name)")
    .eq("organization_id", session.orgId)
    .eq("id", employeeId)
    .maybeSingle();
  const dep = Array.isArray(prof?.department) ? prof?.department[0] : prof?.department;
  const specialization = (dep as { name?: string } | null)?.name ?? "";

  const knowledge = await buildKnowledgeBlock(session.orgId);
  const signature = lessonSignature(detail);

  const result = streamObject({
    model: aiModel("arabicGen"),
    schema: FailureLessonSchema,
    maxRetries: 2,
    prompt: buildFailureLessonPrompt(detail, specialization, knowledge, locale),
    // Persist the finished lesson so the next open is served from cache.
    onFinish: async ({ object }) => {
      if (!object) return;
      try {
        await saveCachedLesson(
          session.orgId,
          employeeId,
          taskId,
          signature,
          MODELS.arabicGen,
          object,
        );
      } catch {
        // Caching is best-effort — never fail the stream over a write error.
      }
    },
  });
  return result.toTextStreamResponse();
}
