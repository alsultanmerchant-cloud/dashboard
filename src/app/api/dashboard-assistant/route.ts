import { streamText, convertToModelMessages, tool, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { buildReadTools } from "@/lib/ai-tools";
import { buildKnowledgeBlock, insertKnowledge } from "@/lib/data/ai-knowledge";
import { logAudit, logAiEvent } from "@/lib/audit";
import {
  applyBriefPatch,
  BRIEF_FIELD_RE,
  RISK_IDS,
  type CeoBriefResult,
} from "@/lib/ceo-brief-schema";
import { z } from "zod";

// §9.1: cap runtime so a hung tool/stream surfaces as an error to the client.
export const maxDuration = 60;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });

const SYSTEM_PROMPT = `أنت "مساعد لوحة القيادة" — مساعد تحرير وتعلّم يعمل داخل لوحة قيادة وكالة تسويق سعودية (رواسم).
يحدّد المستخدم نصًّا من أي مكان في لوحة القيادة (الموجز التنفيذي، المؤشرات، صحة العملاء، الخدمات، أداء الفريق، العقود… إلخ) ويطلب أحد ثلاثة أشياء:

١) **التصحيح المباشر للنص**: ممكن **فقط** لنصوص موجز المدير التنفيذي (تُعطى لك مع \`مفتاح الحقل\`). استخدم \`editBriefText\` بتمرير \`field\` و\`newText\`.
   - الحقول القابلة للتعديل: العنوان (headline)، الخلاصة (bottomLine)، نص توصية (rec:N)، تفسير خطر (risk:ID).
   - **بقية أرقام ومؤشرات اللوحة محسوبة آليًا من البيانات ولا يمكن تعديلها كنص.** إذا طلب المستخدم "تصحيح" رقم أو نص خارج الموجز (لا يوجد مفتاح حقل)، فلا تستخدم editBriefText؛ بل افهم التصحيح واحفظه عبر \`saveLesson\`، أو اشرح كيف يُحتسب الرقم.

٢) **إزالة تنبيه/خطر بالكامل**: إذا أوضح المستخدم أنّ خطرًا معيّنًا في «أين الخطر؟» **ليس مشكلة فعلية** (مع سبب)، استخدم \`dismissRisk\` بتمرير \`riskId\` الخاص بذلك الخطر و\`reason\` يلخّص السبب.
   - هذا يحذف التنبيه من الموجز الحالي **ويمنع ظهوره مجددًا** في كل توليد قادم.
   - **لا تستخدم \`editBriefText\` لإفراغ النص بهدف "الحذف"** — التعديل لا يقبل نصًّا فارغًا؛ الإزالة الكاملة تتم عبر \`dismissRisk\` فقط.
   - استخدمها كذلك مع \`saveLesson\` عندما يكون السبب قاعدة عامة مفيدة لاحقًا.

٣) **التعليم / الحفظ الدائم**: إذا علّمك المستخدم حقيقة عن الشركة أو صحّح فهمًا خاطئًا يجب ألّا يتكرر، احفظه باستخدام \`saveLesson\`.
   - صُغ \`instruction\` كقاعدة عامة واضحة (لا ترتبط بهذه الجملة فقط) كي تُطبَّق في كل تحليل قادم (الموجز والمساعد الذكي).
   - اختر \`kind\` المناسب: correction (تصحيح خطأ)، fact (حقيقة)، preference (تفضيل صياغة)، terminology (مصطلح).
   - عند تصحيح نص الموجز بسبب معلومة مغلوطة، استخدم \`saveLesson\` **أيضًا** حتى لا يتكرر الخطأ.

٤) **الشرح والتوضيح**: لأي نص محدد، استخدم أدوات القراءة (\`runAnalytics\`, \`queryDatabase\`) لجلب الأرقام الداعمة ثم اشرح بإيجاز كيف نشأ هذا الرقم/الاستنتاج.

قواعد:
- **اطرح سؤالًا توضيحيًا واحدًا** قبل التصحيح أو الحفظ أو الإزالة إذا كان الطلب غامضًا — هدفك فهم الشركة بدقة قبل الكتابة.
- **ممنوع منعًا باتًا** أن تقول إنك "حفظت" أو "علّمت النظام" أو "صحّحت" أو "أزلت التنبيه" دون أن تكون قد استدعيت الأداة المناسبة فعليًا (\`saveLesson\` للتعليم، \`editBriefText\` للتصحيح، \`dismissRisk\` للإزالة) في نفس الرد. الحفظ والتعديل والإزالة لا تحدث إلا عبر استدعاء الأداة — التأكيد النصّي وحده لا يفعل شيئًا.
- لا تخترع أرقامًا أبدًا. استخدم الأرقام الفعلية من أدوات القراءة.
- ردود قصيرة ومباشرة بالعربية الفصحى. بعد أي استدعاء أداة، اكتب جملة تؤكد ما تم.`;

const briefField = z
  .string()
  .regex(BRIEF_FIELD_RE)
  .describe("مفتاح الحقل: headline | bottomLine | rec:<رقم> | risk:<معرّف>");

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    // NOTE: unlike /api/agent (owner-only), this assistant is open to any
    // authenticated dashboard user — the "teach the AI" loop is collaborative,
    // team-authored knowledge. Do NOT reintroduce an isOwner gate here.
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { messages, selection, field, context, page } = (await req.json()) as {
      messages: unknown[];
      briefRunId?: string | null;
      selection?: string | null;
      field?: string | null;
      context?: string | null;
      page?: string | null;
    };
    const orgId = session.orgId;
    const userId = session.userId;

    const knowledge = await buildKnowledgeBlock(orgId);
    const modelMessages = await convertToModelMessages(messages);

    const selectionContext = selection
      ? `\n\n---\nالنص المحدّد حاليًا في اللوحة: "${selection}"${page ? `\nالصفحة الحالية: ${page}` : ""}${context ? `\nالقسم/العنوان: ${context}` : ""}${field ? `\nمفتاح الحقل القابل للتعديل: ${field}` : "\n(لا يوجد حقل قابل للتعديل — هذا النص خارج موجز المدير التنفيذي، فلا تستخدم editBriefText؛ اشرح أو احفظ تعليمة بدلًا من ذلك.)"}`
      : "";

    // Shared anti-loop guard for the read tools.
    const seenToolCalls = new Map<string, number>();

    const result = streamText({
      model: google(GEMINI_MODEL),
      system: `${SYSTEM_PROMPT}${knowledge ? `\n\n---\n\n${knowledge}` : ""}${selectionContext}`,
      messages: modelMessages,
      maxRetries: 0,
      stopWhen: stepCountIs(8),
      onError: ({ error }) => {
        console.error("Dashboard assistant stream error:", error);
      },
      tools: {
        editBriefText: tool({
          description:
            "تعديل حقل نصّي واحد في موجز المدير التنفيذي الحالي للمنظمة. الحقول المسموحة فقط: headline, bottomLine, rec:<رقم التوصية>, risk:<معرّف الخطر>. لا يمكن تعديل الأرقام أو المؤشرات.",
          inputSchema: z.object({
            field: briefField,
            newText: z.string().min(1).describe("النص الجديد بعد التصحيح، بنفس لغة ونبرة الموجز"),
          }),
          execute: async ({ field: targetField, newText }) => {
            // Always patch the live current brief row, resolved server-side
            // (ignore any client-passed briefRunId for the write target).
            const { data: row } = await supabaseAdmin
              .from("ceo_brief_runs")
              .select("id, result_json")
              .eq("organization_id", orgId)
              .eq("is_current", true)
              .eq("status", "ready")
              .maybeSingle();
            const current = (row?.result_json ?? null) as CeoBriefResult | null;
            if (!row || !current) {
              return { success: false as const, error: "لا يوجد موجز حالي للتعديل عليه" };
            }
            const patch = applyBriefPatch(current, targetField, newText);
            if (!patch.ok) {
              return { success: false as const, error: patch.error };
            }
            const { error: updateError } = await supabaseAdmin
              .from("ceo_brief_runs")
              .update({ result_json: patch.next })
              .eq("id", row.id as string);
            if (updateError) {
              return { success: false as const, error: updateError.message };
            }
            await logAudit({
              organizationId: orgId,
              actorUserId: userId,
              action: "ceo_brief.text_edit",
              entityType: "ceo_brief_runs",
              entityId: row.id as string,
              metadata: { field: targetField, before: patch.oldValue, after: newText },
            });
            await logAiEvent({
              organizationId: orgId,
              actorUserId: userId,
              eventType: "CEO_BRIEF_EDITED",
              entityType: "ceo_brief_runs",
              entityId: row.id as string,
              payload: { field: targetField },
              importance: "low",
            });
            return { success: true as const, field: targetField, newText };
          },
        }),
        dismissRisk: tool({
          description:
            "إزالة خطر/تنبيه بالكامل من «أين الخطر؟» في موجز المدير التنفيذي بعد أن يوضّح المستخدم أنّه ليس مشكلة فعلية. يحذفه من الموجز الحالي ويمنع ظهوره في كل توليد قادم. استخدمه بدل تفريغ النص.",
          inputSchema: z.object({
            riskId: z
              .enum(RISK_IDS)
              .describe("معرّف الخطر المراد إزالته — يطابق أحد المخاطر المعروضة"),
            reason: z
              .string()
              .min(3)
              .describe("سبب اعتبار هذا التنبيه ليس مشكلة (للتوثيق ولمنع تكراره)"),
          }),
          execute: async ({ riskId, reason }) => {
            const { data: row } = await supabaseAdmin
              .from("ceo_brief_runs")
              .select("id, result_json")
              .eq("organization_id", orgId)
              .eq("is_current", true)
              .eq("status", "ready")
              .maybeSingle();
            const current = (row?.result_json ?? null) as CeoBriefResult | null;
            if (!row || !current) {
              return { success: false as const, error: "لا يوجد موجز حالي" };
            }
            const target = current.risks?.find((r) => r.id === riskId);
            if (!target) {
              return { success: false as const, error: "هذا الخطر غير موجود في الموجز الحالي" };
            }
            // entity_id scopes the suppression: a specific project/client is
            // suppressed per-instance; a kind-level risk suppresses the whole kind.
            const entityId = target.entityId ?? null;

            // Durable suppression — survives every future generation. Idempotent
            // on the (org, risk_id, entity_id) unique index.
            const { error: insertError } = await supabaseAdmin
              .from("ceo_brief_dismissed_risks")
              .upsert(
                {
                  organization_id: orgId,
                  risk_id: riskId,
                  entity_id: entityId,
                  reason,
                  dismissed_by: userId,
                  is_active: true,
                },
                { onConflict: "organization_id,risk_id,entity_id", ignoreDuplicates: false },
              );
            if (insertError) {
              return { success: false as const, error: insertError.message };
            }

            // Remove it from the live brief immediately (risks + any events the
            // signal builder synthesized from this risk: id `risk-<id>-<n>`).
            const next: CeoBriefResult = structuredClone(current);
            next.risks = (next.risks ?? []).filter((r) => r.id !== riskId);
            const dropEvent = (id: string) => id.startsWith(`risk-${riskId}-`);
            next.criticalEvents = (next.criticalEvents ?? []).filter((e) => !dropEvent(e.id));
            next.timelineEvents = (next.timelineEvents ?? []).filter((e) => !dropEvent(e.id));

            const { error: updateError } = await supabaseAdmin
              .from("ceo_brief_runs")
              .update({ result_json: next })
              .eq("id", row.id as string);
            if (updateError) {
              return { success: false as const, error: updateError.message };
            }
            await logAudit({
              organizationId: orgId,
              actorUserId: userId,
              action: "ceo_brief.risk_dismiss",
              entityType: "ceo_brief_runs",
              entityId: row.id as string,
              metadata: { riskId, scopedEntityId: entityId, reason },
            });
            await logAiEvent({
              organizationId: orgId,
              actorUserId: userId,
              eventType: "CEO_BRIEF_RISK_DISMISSED",
              entityType: "ceo_brief_runs",
              entityId: row.id as string,
              payload: { riskId, entityId },
              importance: "normal",
            });
            return { success: true as const, riskId };
          },
        }),
        saveLesson: tool({
          description:
            "حفظ تعليمة دائمة عن الشركة كي يتجنّب النظام تكرار الخطأ في كل توليد قادم (موجز المدير التنفيذي والمساعد الذكي). استخدمها حين يصحّح المستخدم معلومة أو يعلّمك حقيقة/تفضيلًا/مصطلحًا.",
          inputSchema: z.object({
            instruction: z
              .string()
              .min(3)
              .describe("التعليمة الدائمة بصياغة عامة واضحة قابلة للتطبيق مستقبلًا"),
            kind: z
              .enum(["correction", "fact", "preference", "terminology"])
              .default("correction")
              .describe("نوع التعليمة"),
            sourceField: briefField.optional().describe("الحقل المرتبط إن وُجد"),
            wrongText: z.string().optional().describe("النص الخاطئ الأصلي إن كان تصحيحًا"),
            correctedText: z.string().optional().describe("النص الصحيح إن كان تصحيحًا"),
          }),
          execute: async ({ instruction, kind, sourceField, wrongText, correctedText }) => {
            const id = await insertKnowledge({
              orgId,
              createdBy: userId,
              kind,
              instruction,
              sourceField: sourceField ?? field ?? null,
              wrongText: wrongText ?? null,
              correctedText: correctedText ?? null,
            });
            if (!id) {
              return { success: false as const, error: "تعذّر حفظ التعليمة" };
            }
            await logAudit({
              organizationId: orgId,
              actorUserId: userId,
              action: "ai_knowledge.create",
              entityType: "ai_company_knowledge",
              entityId: id,
              metadata: { kind },
            });
            await logAiEvent({
              organizationId: orgId,
              actorUserId: userId,
              eventType: "AI_KNOWLEDGE_TAUGHT",
              entityType: "ai_company_knowledge",
              entityId: id,
              payload: { kind },
              importance: "normal",
            });
            return { success: true as const, id, kind, instruction };
          },
        }),
        ...buildReadTools(orgId, seenToolCalls),
      },
    });

    return result.toUIMessageStreamResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      originalMessages: messages as any,
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
          return "تم تجاوز الحد اليومي لطلبات Gemini. حاول لاحقًا.";
        }
        if (/timeout|ETIMEDOUT/i.test(msg)) {
          return "انتهت مهلة الاتصال بالنموذج. حاول مرة أخرى.";
        }
        return `خطأ من المساعد: ${msg}`;
      },
    });
  } catch (error) {
    console.error("Dashboard assistant error:", error);
    return new Response(JSON.stringify({ error: "فشل في الاتصال بالمساعد" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
