import { streamText, generateText, convertToModelMessages, tool, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// §9.1: cap the function runtime so a hung tool call or stuck Gemini
// stream surfaces as an error to the client instead of spinning forever.
// Vercel ignores this in dev; in prod it bounds the serverless invocation.
export const maxDuration = 60;
import {
  listLiveProjects,
  listLiveClients,
  listLiveTasksWithCount,
  listLiveEmployees,
  getLiveProject,
  getLiveClient,
  getLiveTask,
  getLiveEmployee,
  listLiveTaskMessages,
  computeTaskAnalytics,
} from "@/lib/odoo/live";
import { getTaskTimeline } from "@/lib/data/task-detail";
import { buildKnowledgeBlock } from "@/lib/data/ai-knowledge";
import { buildReadTools } from "@/lib/ai-tools";
import { GEMINI_MODEL } from "@/lib/ai-model";
import { z } from "zod";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

const AGENT_SYSTEM_PROMPT = `أنت "المساعد الذكي" — رئيس الأركان (Chief of Staff) ومحلل أعمال لمالك وكالة تسويق سعودية تستخدم منصة "مركز قيادة الوكالة".

## هويتك ودورك
- اسمك: المساعد الذكي
- أنت تخاطب **المالك / الرئيس التنفيذي** — لا تتحدث بلغة تشغيلية مفصّلة، بل بلغة قرارات وأعمال.
- دورك: تحويل بيانات الوكالة إلى رؤى تنفيذية تساعد الشركة على التحسّن — مخاطر، فرص، أداء، قرارات.
- كل إجابة يجب أن تنتهي بـ **ماذا يعني هذا للأعمال** و**ما القرار المقترح** (من تكلّم، ماذا تنقل، ما المهدد).

## العدسات التنفيذية الثلاث (غطِّها دائمًا حين تكون ذات صلة)
1. **المال والعملاء**: عقود تقترب من التجديد/الانتهاء، عملاء معرضون للفقدان (churn)، خط أنابيب التسليم من المبيعات (هل يدخل عمل جديد؟)، عملاء يحصلون على خدمة أقل/أكثر من اللازم.
2. **موثوقية التسليم**: هل نلتزم بالمواعيد؟ هل الاتجاه يتحسّن أم يسوء مقارنةً بالشهر الماضي؟ أي مشاريع ستفوّت موعدها؟
3. **الأفراد والأداء**: الموظفون الأعلى أداءً، الموظفون المعرضون للخطر، من محمّل فوق طاقته ومن لديه سعة، الإنتاجية ونسبة الالتزام بالمواعيد لكل موظف ودور. **مراقبة أداء الموظفين أولوية دائمة.**

## قدراتك
1. **العملاء والمشاريع**: تحليل قاعدة العملاء، حالة المشاريع، الخدمات المقدمة، حمل فريق العمل
2. **المهام والتسليم**: تتبع المهام، حالات الإنجاز، المهام المتأخرة، توزيع الأعمال على الفرق
3. **التسليم من المبيعات**: متابعة نماذج التسليم الواردة، أوقات الاستجابة، الخدمات الأكثر طلبًا
4. **الأحداث الذكية**: تحليل سير عمل الفريق من خلال جدول ai_events (مهام، تعليقات، إشارات، تنبيهات، تأخيرات)
5. **التنبيهات والإشارات**: تحليل نشاط @mention والتواصل بين الفريق
6. **التوقعات والمخاطر**: استخراج أنماط من البيانات (تأخر متكرر، ضغط على قسم معين، عملاء يحتاجون متابعة)
7. **استعلام قاعدة البيانات**: استخدم queryDatabase لجلب صفوف من أي جدول مسموح
8. **التحليل العميق (runAnalytics)**: استخدم runAnalytics لأي سؤال يتطلب **عدًّا أو تجميعًا أو اتجاهًا أو مقارنة أو متوسطًا** — هذه أهم أداة لديك للتحليل الجاد
9. **البحث في الويب**: استخدم webSearch للمعلومات العامة (اتجاهات السوق، ممارسات الصناعة، أدوات تسويقية حديثة)
10. **بيانات أودو الحية (Rwasem)**: استخدم أدوات odoo* للوصول المباشر إلى نظام أودو (rwasem) — هذه البيانات لحظية وليست منسوخة:
   - \`odooListProjects\` / \`odooGetProject\`: المشاريع في أودو
   - \`odooListClients\` / \`odooGetClient\`: العملاء (شركات customer_rank>0)
   - \`odooListTasks\` / \`odooGetTask\`: المهام مع فلاتر (overdue, stage, projectOdooId, assigneeUserId)
   - \`odooListEmployees\` / \`odooGetEmployee\`: الموظفون مع تحليلات مهامهم
   - \`odooGetTaskMessages\`: محادثات المهمة + إشعارات تتبع التغييرات (مرحلة، أولوية، مُسنَدون)
   - استخدم Odoo حين يسأل المستخدم عن بيانات لحظية أو حالات لم تُستورد بعد، واستخدم queryDatabase حين يحتاج للوحات لوحة التحكم والـ ai_events.
11. **سجل المهمة المُهيكَل (موصى به للأسئلة عن المراحل/التغييرات)**:
   - \`dashboardGetTaskTimeline(taskId)\` — يعيد قائمة زمنية لكل ما حدث للمهمة: تغييرات المراحل (from→to + التواريخ)، تغييرات الأولوية، تغييرات المُسنَدين، الملاحظات.
   - \`dashboardGetProjectStageActivity({ projectId | projectExternalId })\` — نفس الفكرة لكامل مهام المشروع، مرتبة من الأحدث للأقدم.
   - استخدم هاتين الأداتين كلما سأل المستخدم "متى انتقلت المهمة إلى …" أو "تاريخ المراحل" أو "تغييرات المُسنَدين" أو "نشاط المشروع". لا تستخدم \`odooGetTaskMessages\` لهذه الأسئلة — البيانات نفسها متاحة محليًا بشكل أنظف.

## الجداول المتاحة لـ queryDatabase
- **clients**: العملاء (name, contact_name, phone, email, status, source, created_at)
- **projects**: المشاريع (name, description, status, priority, start_date, end_date, client_id, account_manager_employee_id, created_at)
- **project_services**: ربط المشاريع بالخدمات (project_id, service_id, status)
- **project_members**: أعضاء فريق المشروع (project_id, employee_id, role_label)
- **services**: الخدمات المقدمة (name, slug, description, is_active) — slug في {social-media-management, seo, media-buying}
- **tasks**: المهام (title, description, status, priority, due_date, completed_at, project_id, service_id, created_from_template_item_id) — status في {todo, in_progress, review, blocked, done, cancelled}
- **task_assignees**: إسناد المهام (task_id, employee_id)
- **task_comments**: تعليقات المهام (task_id, author_user_id, body, is_internal, created_at)
- **task_mentions**: الإشارات داخل التعليقات (task_comment_id, mentioned_employee_id)
- **task_templates** + **task_template_items**: قوالب توليد المهام لكل خدمة
- **sales_handover_forms**: نماذج التسليم من المبيعات (client_name, urgency_level, status, selected_service_ids, project_id, client_id, created_at) — status في {submitted, in_review, accepted, rejected}
- **notifications**: التنبيهات (recipient_user_id, recipient_employee_id, type, title, body, read_at, entity_type, entity_id)
- **audit_logs**: سجل التدقيق (action, entity_type, entity_id, metadata, actor_user_id)
- **ai_events**: الأحداث الذكية (event_type, entity_type, entity_id, payload, importance) — أنواع: HANDOVER_SUBMITTED, PROJECT_CREATED, TASK_CREATED, TASK_STATUS_CHANGED, TASK_COMMENT_ADDED, MENTION_CREATED, NOTIFICATION_CREATED
- **employee_profiles**: ملفات الموظفين (full_name, email, phone, job_title, department_id, employment_status)
- **departments**: الأقسام (name, slug, description, head_employee_id)
- **roles** + **permissions** + **user_roles** + **role_permissions**: نظام الأدوار والصلاحيات

## نصائح الاستعلام (queryDatabase — لجلب صفوف)
- البحث الجزئي: استخدم operator "ilike" مع value مثل "%رمضان%"
- اقتصر على الأعمدة المطلوبة في select لتقليل الحجم
- استخدم orderColumn + orderAscending=false للترتيب من الأحدث
- limit الافتراضي 200 — ارفعه عند الحاجة لتحليل أوسع، لا تكتفِ بأول دفعة
- النتائج مفلترة تلقائيًا على المنظمة الحالية — لا حاجة لإضافة organization_id كفلتر
- **المهام المؤرشفة:** جدول tasks فيه ~11,800 صف لكن ~2,070 فقط نشطة؛ البقية مؤرشفة (archived_at ليست NULL). افتراضيًا queryDatabase **يستبعد** المؤرشفة. مرّر includeArchived=true فقط إذا طلب المستخدم صراحةً بيانات تاريخية/مؤرشفة.

## التحليل العميق (runAnalytics — أهم أداة لديك)
- أي سؤال فيه "كم / كم عدد / النسبة / الاتجاه / مقارنة / متوسط / الأكثر / الأقل / عبر الوقت / شهريًا / لكل موظف/خدمة/مرحلة" → استخدم **runAnalytics** ولا تجمع الصفوف يدويًا أبدًا.
- runAnalytics ينفّذ استعلام SQL واحد للقراءة فقط (SELECT / WITH) على قاعدة Postgres مباشرة ويعيد نتائج مجمّعة. مسموح GROUP BY و JOIN و date_trunc و AVG/COUNT/SUM و CTE.
- استبعد المؤرشفة بنفسك: أضف \`archived_at is null\` على جدول tasks (إلا إذا طُلب تحليل تاريخي).
- أمثلة:
  - الإنتاجية شهريًا: \`select date_trunc('month', completed_at) m, count(*) n from tasks where stage='done' and archived_at is null group by 1 order by 1\`
  - أداء موظف: \`select e.full_name, count(*) total, count(*) filter (where t.is_overdue) overdue, round(avg(t.delay_days),1) avg_delay from task_assignees a join tasks t on t.id=a.task_id join employee_profiles e on e.id=a.employee_id where t.archived_at is null group by 1 order by overdue desc\`
- جداول مهمة: tasks, projects, clients, task_assignees, employee_profiles, sales_handover_forms, services, task_timesheets, ai_events, departments. أعمدة tasks المفيدة: stage, is_overdue, delay_days, due_date, planned_date, completed_at, actual_done_date, revision_count, working_days_close, archived_at, service_id, project_id.

## سير العمل في رواسم (8 مراحل)
كل مهمة تمر بهذه المراحل بالترتيب — لا يجوز التخطي:
1. **new** (جديدة) — المختص (Specialist) فقط هو من ينقلها بعد كتابة المتطلبات في Log Note وعمل Mention لمدير القسم
2. **in_progress** (قيد التنفيذ) — المنفذ (Agent) يستلمها من المدير ويبدأ التنفيذ
3. **manager_review** (مراجعة المدير) — المدير (Manager) يراجع جودة التنفيذ
4. **specialist_review** (مراجعة المتخصص) — المختص يراجع لأنه هو من حدد المتطلبات
5. **ready_to_send** (جاهزة للإرسال)
6. **sent_to_client** (أُرسلت للعميل) — مدير الحساب (Account Manager) فقط ينقلها هنا
7. **client_changes** (تعديلات العميل) — المنفذ ينفذ التعديل **بدون** تغيير المرحلة، التواصل في Log Note فقط
8. **done** (مكتملة) — بعد اعتماد العميل

## الأدوار الأربعة (TASK_ROLE_TYPES)
- **specialist** (المتخصص — أصفر): يحدد المتطلبات ويراجع العمل النهائي
- **manager** (المدير — أزرق): يوزع المهام ويراجع الجودة
- **agent** (المنفذ — أخضر): ينفذ المهمة، مسؤول عن السرعة والدقة
- **account_manager** (مدير الحساب — أحمر): يتواصل مع العميل ويدير التعديلات والإرسال

## قواعد رفع المهام (Upload Offsets) — مهم للسؤال "ماذا يجب أن أرفع اليوم؟"
الـ Specialist يرفع البيانات الكاملة في Log Note قبل الـ Deadline حسب الخدمة:

**الميديا باينج**:
- كتابة المحتوى: قبل الـ deadline بيومين
- التصميم: قبل الـ deadline بـ 3 أيام

**السوشيال ميديا** (مقسم على 3 أسابيع، الرفع في اليوم التالي للاجتماع مع العميل):
- كتابة الأسبوع 1: قبل الـ deadline بيومين
- كتابة الأسبوع 2: قبل الـ deadline بـ 3 أيام
- كتابة الأسبوع 3: قبل الـ deadline بـ 4 أيام
- تصميم الأسبوع 1: قبل الـ deadline بـ 3 أيام
- تصميم الأسبوع 2: قبل الـ deadline بـ 4 أيام
- تصميم الأسبوع 3: قبل الـ deadline بـ 5 أيام
- استوريز/فيديوهات: قبل الـ deadline بـ 4 أيام

**SEO**:
- محتوى المنتجات والمقالات: في نفس يوم الـ deadline لمهمة الكلمات المفتاحية
- تصميم الواجهة: قبل الـ deadline بـ 4 أيام
- تصميم بنرات المقالات: قبل الـ deadline بـ 5 أيام

## الفرق بين Duration و Deadline
- **Duration** (مدة المرحلة): الوقت اللي قضته المهمة في مرحلة معينة. تأخر هنا = مشكلة تشغيل داخلية.
- **Deadline** (planned_date): الموعد النهائي مع العميل، مرتبط بالعقد. تأخر هنا = مشكلة مع العميل ⚠️
- **progress_slip** = expected_progress - progress_percent. موجب يعني المهمة متأخرة عن الجدول.

## قواعد التواصل
- أي طلب من العميل يُسجَّل في رواسم (في Log Note للمهمة)
- أي تنفيذ يكون داخل رواسم
- WhatsApp فقط للتنسيق السريع، ليس مكان توثيق
- قروب العميل: الأكاونت مانجر هو حلقة الوصل
- قروب داخلي: التنسيق بين الفريق

## قواعد الرد
0. **إلزامي:** بعد كل استدعاء أداة (queryDatabase, odoo*, dashboard*, webSearch) يجب عليك إصدار رسالة نصية ملخّصة باللغة العربية تشرح ما وجدته. لا تنهِ ردك بعد استدعاء أداة دون نص. حتى لو لم تجد بيانات، اكتب صراحة "لم أجد …".
1. أجب بالعربية الفصحى الواضحة
2. استخدم الأرقام الفعلية من البيانات — لا تختلق
3. نسّق بـ Markdown (عناوين، قوائم، جداول)
4. ابدأ بعنوان قصير ثم خلاصة في سطر واحد
5. اختم بـ 2-3 أسئلة متابعة مقترحة
6. إذا لم تجد البيانات في الجداول، قل ذلك صراحة بدلاً من التخمين
7. التوصيات رقّمها وحدد الأولوية: عاجل / مهم / اقتراح
8. استخدم الرموز باعتدال: 📊 📈 📉 🎯 ⚠️ ✅ 💡 🔥
9. **أكمل المهمة في جولة واحدة — لا تسأل المستخدم أن يعيد السؤال.** إذا احتجت بيانات أوسع أو أقدم، ارفع limit أو استخدم runAnalytics أو كرّر الاستعلام بفلتر مختلف بنفسك. لا تردّ أبدًا بـ "حدّد الفترة" أو "اطلب مرة أخرى" قبل أن تكون قد جمعت كل ما تستطيع. لا تكتفِ بآخر شهر من البيانات؛ المستخدم يتوقع تغطية كامل التاريخ المطلوب.
10. **فكّر كرئيس أركان، لا ككاتب تقارير.** كل تحليل: ابدأ بالحقيقة الرقمية، ثم **الأثر على الأعمال** (مال/عميل/تسليم/فريق)، ثم **القرار المقترح**. أبرز التحسّن أو التدهور مقارنةً بالماضي حين تتوفر البيانات.
11. **أداء الموظفين:** حين يُسأل عن الفريق أو فرد، أعطِ أرقامًا فعلية (إنتاجية، نسبة التزام بالموعد، متوسط التأخير، الحمل المفتوح) من runAnalytics، وحدّد بوضوح: من المتميز، من المتعثّر، من المحمّل فوق طاقته.
12. **المهام المتأخرة / الأقدم:** عند السؤال عن "أقدم التاسكات المتأخرة" أو "كل المهام المتأخرة" أو ما شابه، استخدم \`odooListTasks({ overdue: true })\` — النتائج مرتّبة تلقائيًا من الأقدم (الأبعد عن موعدها) إلى الأحدث. اعرضها بهذا الترتيب. إذا كانت قيمة \`truncated\` في النتيجة \`true\` فيجب أن تذكر صراحةً أن القائمة مقتطعة وأنك تعرض \`count\` من أصل \`total\` مهمة، واعرض تضييق الفلتر. لا تخفِ الاقتطاع أبدًا.

## تنسيق الإجابة المثالي
\`\`\`
## العنوان 📊
ملخص في سطر.

### تفاصيل
- نقطة 1
- نقطة 2

### توصيات 💡
1. [عاجل] …
2. [مهم] …

---
**أسئلة متابعة:**
- …؟
- …؟
\`\`\`
`;

async function buildOrgSnapshot(organizationId: string): Promise<string> {
  const [clients, projects, openTasks, doneTasks, handovers, recentEvents] =
    await Promise.all([
      supabaseAdmin.from("clients").select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      supabaseAdmin.from("projects").select("id, name, status, priority", { count: "exact" })
        .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(5),
      supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .not("stage", "eq", "done"),
      supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .eq("stage", "done"),
      supabaseAdmin.from("sales_handover_forms").select("client_name, urgency_level, status, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }).limit(3),
      supabaseAdmin.from("ai_events").select("event_type")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }).limit(50),
    ]);

  const eventTally: Record<string, number> = {};
  for (const e of recentEvents.data ?? []) {
    eventTally[e.event_type] = (eventTally[e.event_type] ?? 0) + 1;
  }
  const eventLines = Object.entries(eventTally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n") || "  (لا توجد أحداث بعد)";

  const handoverLines = (handovers.data ?? [])
    .map((h) => `  - ${h.client_name} · ${h.urgency_level} · ${h.status}`)
    .join("\n") || "  (لا توجد تسليمات بعد)";

  const projectLines = (projects.data ?? [])
    .map((p) => `  - ${p.name} · ${p.status} · ${p.priority}`)
    .join("\n") || "  (لا توجد مشاريع بعد)";

  return `لقطة الحالة الراهنة في الوكالة:
- إجمالي العملاء: ${clients.count ?? 0}
- إجمالي المشاريع: ${projects.count ?? 0}
- مهام مفتوحة: ${openTasks.count ?? 0}
- مهام مكتملة: ${doneTasks.count ?? 0}

أحدث 3 تسليمات من المبيعات:
${handoverLines}

أحدث 5 مشاريع:
${projectLines}

أحداث ذكية مؤخرًا (أعلى 50):
${eventLines}`;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    if (!session.isOwner) {
      return new Response(
        JSON.stringify({ error: "المساعد الذكي متاح للمالك فقط" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const { messages, conversationId } = (await req.json()) as {
      messages: unknown[];
      conversationId?: string | null;
    };
    const orgId = session.orgId;
    const [snapshot, knowledge] = await Promise.all([
      buildOrgSnapshot(orgId),
      buildKnowledgeBlock(orgId),
    ]);
    const modelMessages = await convertToModelMessages(messages);

    // §9.2: persist the latest user message into the DB-backed conversation
    // so threads survive logout / tab close. We only persist when the client
    // passes a conversationId — the page bootstraps one on first send.
    if (conversationId && Array.isArray(messages) && messages.length > 0) {
      const last = messages[messages.length - 1] as {
        role?: string;
        content?: unknown;
      };
      if (last?.role === "user") {
        try {
          // Sanity-check the conversation belongs to the caller before
          // writing — RLS is on but we use the admin client server-side.
          const { data: conv } = await supabaseAdmin
            .from("ai_conversations")
            .select("id, user_id")
            .eq("id", conversationId)
            .maybeSingle();
          if (conv && conv.user_id === session.userId) {
            await supabaseAdmin.from("ai_messages").insert({
              conversation_id: conversationId,
              role: "user",
              content: last as unknown as object,
            });
          }
        } catch (e) {
          console.warn(
            `agent: persist user message failed: ${(e as Error).message}`,
          );
        }
      }
    }

    // Anti-loop guard: Gemini sometimes re-fires the exact same tool call
    // verbatim. We hash each invocation and abort identical repeats so the
    // model is forced to either change strategy or produce a text answer.
    const seenToolCalls = new Map<string, number>();

    const result = streamText({
      model: google(GEMINI_MODEL),
      system: `${AGENT_SYSTEM_PROMPT}\n\n---\n\n${snapshot}${knowledge ? `\n\n---\n\n${knowledge}` : ""}`,
      messages: modelMessages,
      // Fail fast on transient Gemini errors (esp. 429 rate limits) instead
      // of hanging 60-180s on 3 internal retries.
      maxRetries: 0,
      stopWhen: stepCountIs(20),
      // §9.1: surface stream/tool errors instead of letting them deadlock
      // the client. The UI shows a generic toast on stream error.
      onError: ({ error }) => {
        console.error("Agent stream error:", error);
      },
      tools: {
        webSearch: tool({
          description: "Search the web for current information (industry news, competitor info, marketing trends, agency tools).",
          inputSchema: z.object({
            query: z.string().describe("Search query in Arabic or English"),
          }),
          execute: async ({ query }) => {
            try {
              const r = await generateText({
                model: google(GEMINI_MODEL),
                prompt: query,
                tools: { googleSearch: google.tools.googleSearch({}) },
              });
              return { success: true as const, result: r.text, query };
            } catch (err) {
              return {
                success: false as const,
                error: err instanceof Error ? err.message : "Search failed",
                query,
              };
            }
          },
        }),
        odooListProjects: tool({
          description: "List active projects directly from the live Odoo (Rwasem) system. Returns up to 500 projects with client, manager, dates, and task counts.",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const data = await listLiveProjects();
              return { success: true as const, count: data.length, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooGetProject: tool({
          description: "Fetch a single project from live Odoo with its tasks and computed analytics (byStage, overdue, completion %).",
          inputSchema: z.object({
            odooId: z.number().describe("The Odoo project.project id"),
          }),
          execute: async ({ odooId }) => {
            try {
              const data = await getLiveProject(odooId);
              if (!data) return { success: false as const, error: "Project not found in Odoo" };
              return { success: true as const, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooListClients: tool({
          description: "List company clients (customer_rank>0, is_company=true) from live Odoo with project counts.",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const data = await listLiveClients();
              return { success: true as const, count: data.length, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooGetClient: tool({
          description: "Fetch a single client from live Odoo (res.partner) with all their projects.",
          inputSchema: z.object({
            odooId: z.number().describe("The Odoo res.partner id"),
          }),
          execute: async ({ odooId }) => {
            try {
              const data = await getLiveClient(odooId);
              if (!data) return { success: false as const, error: "Client not found in Odoo" };
              return { success: true as const, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooListTasks: tool({
          description: "List tasks from live Odoo with optional filters. Use overdue=true for late tasks, stage to filter by mapped stage keys (new, in_progress, manager_review, specialist_review, ready_to_send, sent_to_client, client_changes, done). Overdue results are ordered oldest-deadline-first, so the most delayed tasks always come back even when capped. Returns `total` (all matching rows in Odoo) and `truncated` — when truncated is true you MUST tell the user the list was capped at `count` of `total` and offer to narrow the filter.",
          inputSchema: z.object({
            overdue: z.boolean().optional().describe("Only past-deadline, non-done tasks"),
            stage: z.array(z.string()).optional().describe("Mapped stage keys to include"),
            projectOdooId: z.number().optional().describe("Filter to a specific Odoo project id"),
            assigneeUserId: z.number().optional().describe("Filter to tasks assigned to this Odoo res.users id"),
            limit: z.number().default(1000).describe("Max rows to return — kept high so full overdue lists come back in one shot"),
          }),
          execute: async ({ overdue, stage, projectOdooId, assigneeUserId, limit }) => {
            try {
              const { rows, total, truncated } = await listLiveTasksWithCount({
                overdue,
                stage,
                projectOdooId,
                assigneeUserId,
                limit,
              });
              const analytics = computeTaskAnalytics(rows);
              return {
                success: true as const,
                count: rows.length,
                total,
                truncated,
                analytics,
                data: rows,
              };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooGetTask: tool({
          description: "Fetch a single task from live Odoo with description, deadlines, assignees, and stage.",
          inputSchema: z.object({
            odooId: z.number().describe("The Odoo project.task id"),
          }),
          execute: async ({ odooId }) => {
            try {
              const data = await getLiveTask(odooId);
              if (!data) return { success: false as const, error: "Task not found in Odoo" };
              return { success: true as const, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooGetTaskMessages: tool({
          description:
            "Fetch the live Odoo chatter for a task: Log Notes, emails, AND tracking notifications (stage changes, priority changes, assignee changes) with timestamps and old → new values. Prefer dashboardGetTaskTimeline when you only need a structured event list — this raw endpoint is for HTML body inspection.",
          inputSchema: z.object({
            odooId: z.number().describe("The Odoo project.task id"),
          }),
          execute: async ({ odooId }) => {
            try {
              const data = await listLiveTaskMessages(odooId);
              return { success: true as const, count: data.length, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        dashboardGetTaskTimeline: tool({
          description:
            "Return a CHRONOLOGICAL timeline of everything that happened to a task: stage changes (with from/to and dates), priority changes, assignee changes, title edits, and user notes. Each event has a structured shape: { kind: 'stage_change' | 'tracking' | 'note', at, ... }. Use this whenever the user asks about a task's or project's history, when stages switched, who moved what when, or any phrasing like 'تاريخ', 'مراحل', 'متى انتقلت', 'تغييرات', 'تحديثات'. Reads the locally synced data so it's fast.",
          inputSchema: z.object({
            taskId: z.string().describe("Supabase tasks.id (uuid)"),
          }),
          execute: async ({ taskId }) => {
            try {
              const events = await getTaskTimeline(orgId, taskId);
              return { success: true as const, count: events.length, events };
            } catch (err) {
              return {
                success: false as const,
                error: err instanceof Error ? err.message : "timeline fetch failed",
              };
            }
          },
        }),
        dashboardGetProjectStageActivity: tool({
          description:
            "Return all stage / priority / assignee transitions for every task in a project, chronologically. Use this when the user asks about a PROJECT'S history of stage changes, who moved what when, or wants a summary of recent activity across the project's tasks. Each event includes which task it belongs to.",
          inputSchema: z.object({
            projectId: z
              .string()
              .optional()
              .describe("Supabase projects.id (uuid). Provide either this or projectExternalId."),
            projectExternalId: z
              .string()
              .optional()
              .describe(
                "Odoo project.project id (numeric, as string). Use when the user references the project by Odoo ID or PRJ-NNNNN code (strip the prefix).",
              ),
            limit: z
              .number()
              .int()
              .min(1)
              .max(500)
              .default(200)
              .describe("Max events to return — newest first."),
          }),
          execute: async ({ projectId, projectExternalId, limit }) => {
            try {
              // Resolve project UUID.
              let pid = projectId ?? null;
              if (!pid && projectExternalId) {
                const { data: p } = await supabaseAdmin
                  .from("projects")
                  .select("id")
                  .eq("organization_id", orgId)
                  .eq("external_source", "odoo")
                  .eq("external_id", projectExternalId)
                  .maybeSingle();
                pid = (p?.id as string | undefined) ?? null;
              }
              if (!pid) {
                return { success: false as const, error: "project not found" };
              }
              // List tasks in the project.
              const { data: ts } = await supabaseAdmin
                .from("tasks")
                .select("id, title, external_id")
                .eq("organization_id", orgId)
                .eq("project_id", pid);
              const tasks = ts ?? [];
              if (tasks.length === 0) {
                return { success: true as const, count: 0, events: [] };
              }
              // Fan out — small loop, cheap with our existing per-task helper.
              const all: Array<
                Awaited<ReturnType<typeof getTaskTimeline>>[number] & {
                  task_id: string;
                  task_title: string;
                }
              > = [];
              for (const t of tasks) {
                const events = await getTaskTimeline(orgId, t.id as string);
                for (const e of events) {
                  // Drop pure notes — caller wants stage/transition activity.
                  if (e.kind === "note") continue;
                  all.push({ ...e, task_id: t.id as string, task_title: t.title as string });
                }
              }
              all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
              return { success: true as const, count: all.length, events: all.slice(0, limit) };
            } catch (err) {
              return {
                success: false as const,
                error: err instanceof Error ? err.message : "stage activity fetch failed",
              };
            }
          },
        }),
        odooListEmployees: tool({
          description: "List active employees from live Odoo (hr.employee) with department and manager.",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const data = await listLiveEmployees();
              return { success: true as const, count: data.length, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        odooGetEmployee: tool({
          description: "Fetch a single employee from live Odoo with their currently-assigned tasks and computed analytics.",
          inputSchema: z.object({
            odooId: z.number().describe("The Odoo hr.employee id"),
          }),
          execute: async ({ odooId }) => {
            try {
              const data = await getLiveEmployee(odooId);
              if (!data) return { success: false as const, error: "Employee not found in Odoo" };
              return { success: true as const, data };
            } catch (err) {
              return { success: false as const, error: err instanceof Error ? err.message : "Odoo fetch failed" };
            }
          },
        }),
        ...buildReadTools(orgId, seenToolCalls),
      },
    });

    return result.toUIMessageStreamResponse({
      // §9.2: tell the SDK what the prior turns were so it knows which
      // message in the onFinish payload is "new". Without this, parts
      // can come back empty because the SDK can't distinguish.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      originalMessages: messages as any,
      // Forward stream errors to the client so useChat.onError fires with
      // a real message instead of swallowing the error silently.
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
          return "تم تجاوز الحد اليومي لطلبات Gemini (الطبقة المجانية: 20 طلب/يوم). يرجى ترقية المفتاح أو المحاولة غدًا.";
        }
        if (/timeout|ETIMEDOUT/i.test(msg)) {
          return "انتهت مهلة الاتصال بالنموذج. حاول مرة أخرى.";
        }
        return `خطأ من المساعد الذكي: ${msg}`;
      },
      // Persist the assistant turn once the UI stream completes. Uses
      // `responseMessage` (the just-generated UIMessage with its full
      // parts array) so tool turns + markdown are preserved verbatim.
      onFinish: async ({ responseMessage }) => {
        if (!conversationId) return;
        try {
          if (!responseMessage || responseMessage.role !== "assistant") return;
          await supabaseAdmin.from("ai_messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: responseMessage as unknown as object,
          });
        } catch (e) {
          console.warn(
            `agent: persist assistant message failed: ${(e as Error).message}`,
          );
        }
      },
    });
  } catch (error) {
    console.error("Agent error:", error);
    return new Response(JSON.stringify({ error: "فشل في الاتصال بالمساعد الذكي" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
