import { streamText, generateText, convertToModelMessages, tool, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerSession } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

// Allowed tables for the agent's queryDatabase tool — only the agency MVP schema.
const ALLOWED_TABLES = [
  "clients",
  "projects",
  "project_services",
  "project_members",
  "services",
  "tasks",
  "task_assignees",
  "task_comments",
  "task_mentions",
  "task_templates",
  "task_template_items",
  "sales_handover_forms",
  "notifications",
  "audit_logs",
  "ai_events",
  "departments",
  "employee_profiles",
  "roles",
  "permissions",
  "user_roles",
  "role_permissions",
] as const;

const AGENT_SYSTEM_PROMPT = `أنت "المساعد الذكي" — مساعد إدارة العمليات لوكالة تسويق سعودية تستخدم منصة "مركز قيادة الوكالة".

## هويتك
- اسمك: المساعد الذكي
- دورك: مستشار عمليات ومحلل بيانات داخل الوكالة
- تعمل ضمن منصة Agency Command Center لإدارة العملاء والمشاريع والمهام والتسليم من المبيعات

## قدراتك
1. **العملاء والمشاريع**: تحليل قاعدة العملاء، حالة المشاريع، الخدمات المقدمة، حمل فريق العمل
2. **المهام والتسليم**: تتبع المهام، حالات الإنجاز، المهام المتأخرة، توزيع الأعمال على الفرق
3. **التسليم من المبيعات**: متابعة نماذج التسليم الواردة، أوقات الاستجابة، الخدمات الأكثر طلبًا
4. **الأحداث الذكية**: تحليل سير عمل الفريق من خلال جدول ai_events (مهام، تعليقات، إشارات، تنبيهات، تأخيرات)
5. **التنبيهات والإشارات**: تحليل نشاط @mention والتواصل بين الفريق
6. **التوقعات والمخاطر**: استخراج أنماط من البيانات (تأخر متكرر، ضغط على قسم معين، عملاء يحتاجون متابعة)
7. **استعلام قاعدة البيانات**: استخدم queryDatabase للاستعلام عن أي جدول من الجداول المسموحة
8. **البحث في الويب**: استخدم webSearch للمعلومات العامة (اتجاهات السوق، ممارسات الصناعة، أدوات تسويقية حديثة)

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

## نصائح الاستعلام
- البحث الجزئي: استخدم operator "ilike" مع value مثل "%رمضان%"
- اقتصر على الأعمدة المطلوبة في select لتقليل الحجم
- استخدم orderColumn + orderAscending=false للترتيب من الأحدث
- limit الافتراضي 50 — ارفعه عند الحاجة لتحليل أوسع
- النتائج مفلترة تلقائيًا على المنظمة الحالية — لا حاجة لإضافة organization_id كفلتر

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
1. أجب بالعربية الفصحى الواضحة
2. استخدم الأرقام الفعلية من البيانات — لا تختلق
3. نسّق بـ Markdown (عناوين، قوائم، جداول)
4. ابدأ بعنوان قصير ثم خلاصة في سطر واحد
5. اختم بـ 2-3 أسئلة متابعة مقترحة
6. إذا لم تجد البيانات في الجداول، قل ذلك صراحة بدلاً من التخمين
7. التوصيات رقّمها وحدد الأولوية: عاجل / مهم / اقتراح
8. استخدم الرموز باعتدال: 📊 📈 📉 🎯 ⚠️ ✅ 💡 🔥

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
        .in("status", ["todo", "in_progress", "review", "blocked"]),
      supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId).eq("status", "done"),
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

    const { messages } = await req.json();
    const orgId = session.orgId;
    const snapshot = await buildOrgSnapshot(orgId);
    const modelMessages = await convertToModelMessages(messages);

    const queryDbParams = z.object({
      table: z.enum(ALLOWED_TABLES).describe("The table to query (auto-scoped to current organization)"),
      select: z.string().default("*").describe("Columns to select, e.g. 'name,status' or '*'"),
      filters: z.array(z.object({
        column: z.string().describe("Column name to filter on"),
        operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"])
          .describe("Filter operator. Use ilike with %keyword% for partial matches."),
        value: z.string().describe("Value to filter by. Numbers as strings."),
      })).default([]),
      orderColumn: z.string().optional().describe("Column to order by"),
      orderAscending: z.boolean().default(false),
      limit: z.number().default(50),
    });

    const result = streamText({
      model: google("gemini-3-flash-preview"),
      system: `${AGENT_SYSTEM_PROMPT}\n\n---\n\n${snapshot}`,
      messages: modelMessages,
      stopWhen: stepCountIs(5),
      tools: {
        webSearch: tool({
          description: "Search the web for current information (industry news, competitor info, marketing trends, agency tools).",
          inputSchema: z.object({
            query: z.string().describe("Search query in Arabic or English"),
          }),
          execute: async ({ query }) => {
            try {
              const r = await generateText({
                model: google("gemini-3-flash-preview"),
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
        queryDatabase: tool({
          description: "Query the agency database (auto-scoped to current organization). Use this to look up clients, projects, tasks, handovers, and ai_events.",
          inputSchema: queryDbParams,
          execute: async ({ table, select, filters, orderColumn, orderAscending, limit }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let query = supabaseAdmin
              .from(table)
              .select(select)
              .eq("organization_id", orgId)
              .limit(limit) as any;

            for (const f of filters) {
              if (f.operator === "in") {
                query = query.in(f.column, f.value.split(",").map((v: string) => v.trim()));
              } else if (f.operator === "is") {
                query = query.is(f.column, null);
              } else {
                query = query.filter(f.column, f.operator, f.value);
              }
            }
            if (orderColumn) query = query.order(orderColumn, { ascending: orderAscending });

            const { data, error } = await query;
            if (error) {
              return { success: false as const, error: error.message, data: null, count: 0 };
            }
            return {
              success: true as const,
              data: data ?? [],
              count: (data as unknown[])?.length ?? 0,
              table,
            };
          },
        }),
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("Agent error:", error);
    return new Response(JSON.stringify({ error: "فشل في الاتصال بالمساعد الذكي" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
