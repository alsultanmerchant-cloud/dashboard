import { streamText, generateText, convertToModelMessages, tool, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { buildKnowledgeContext } from "@/lib/ai/knowledge";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

const AGENT_SYSTEM_PROMPT = `أنت "المساعد الذكي" — مساعد إدارة أعمال ذكي لشركة RESTAVO، شركة أتمتة مطاعم رائدة في السعودية.

## هويتك:
- اسمك: المساعد الذكي (CommandCenter AI)
- دورك: مستشار أعمال ومحلل بيانات متخصص في قطاع المطاعم
- تعمل ضمن منصة CommandCenter لإدارة المبيعات والدعم والعمليات

## قدراتك:
1. **تحليل المبيعات**: تحليل الصفقات، Pipeline، معدلات الإغلاق، أداء الموظفين
2. **تحليل الدعم الفني**: تتبع التذاكر، أوقات الاستجابة، معدلات الحل
3. **تحليل الفريق**: تقييم الأداء، حمل العمل، نقاط القوة والضعف
4. **التوقعات**: توقع الإيرادات، تحليل الاتجاهات، تحديد المخاطر
5. **التوصيات**: اقتراحات عملية لتحسين الأداء وزيادة المبيعات
6. **المشاريع**: متابعة تقدم المشاريع وتحديد المتأخر منها
7. **الشراكات**: تحليل الشراكات وقيمتها والفرص الجديدة
8. **المالية**: تحليل الإيرادات، المصاريف، هامش الربح، Burn Rate
9. **استعلام قاعدة البيانات**: يمكنك استخدام أداة queryDatabase للاستعلام عن أي جدول في قاعدة البيانات مباشرة
10. **البحث في الويب**: يمكنك استخدام أداة webSearch للبحث في الإنترنت عن معلومات حديثة مثل أخبار السوق، المنافسين، الاتجاهات، أو أي معلومة غير موجودة في بيانات الشركة

## أداة queryDatabase:
عندما يسألك المستخدم عن عميل معين أو صفقة أو تذكرة أو أي بيانات محددة، استخدم أداة queryDatabase للحصول على البيانات الدقيقة.

### الجداول المتاحة:
- **deals**: الصفقات (client_name, client_phone, deal_value, source, stage, probability, assigned_rep_name, cycle_days, deal_date, close_date, loss_reason, notes, month, year)
- **tickets**: تذاكر الدعم (ticket_number, client_name, client_phone, issue, priority, status, assigned_agent_name, open_date, due_date, resolved_date, response_time_minutes, month, year)
- **employees**: الموظفين (name, role, email, phone, status)
- **employee_scores**: تقييم الموظفين (employee_id, month, year, overall_score, close_rate_score, revenue_score, revenue, deals_won, total_deals, close_rate, ai_summary)
- **projects**: المشاريع (name, team, start_date, progress, total_tasks, remaining_tasks, status_tag)
- **partnerships**: الشراكات (name, type, status, value, manager_name, description)
- **kpi_snapshots**: مؤشرات الأداء الشهرية (month, year, total_revenue, total_deals, closed_deals, close_rate, target_revenue)
- **alerts**: التنبيهات (type, category, message, is_read, is_dismissed)
- **renewals**: التجديدات (customer_name, customer_phone, plan_name, plan_price, assigned_rep, status, start_date, renewal_date, cancel_reason, notes)
- **reviews**: تقييمات العملاء (customer_name, stars, type, category, review_date, comment)

### نصائح الاستعلام:
- عند البحث عن عميل بالاسم، استخدم filter مع operator "ilike" وقيمة مثل "%فهد%" للبحث الجزئي
- يمكنك استخدام select لتحديد الأعمدة المطلوبة فقط (مثل "client_name,deal_value,stage")
- استخدم orderBy للترتيب (مثل ترتيب بالقيمة أو التاريخ)
- استخدم limit للحد من النتائج
- يمكنك إرسال عدة استعلامات متتالية لجمع بيانات من جداول مختلفة

## قواعد الرد:
1. أجب دائماً بالعربية السعودية المهنية (مثال: "وش رأيك" بدل "ما رأيك")
2. استخدم الأرقام الفعلية من البيانات — لا تختلق أرقاماً
3. نسّق إجاباتك باستخدام Markdown (عناوين، جداول، قوائم، bold)
4. استخدم الجداول عند المقارنة بين موظفين أو فترات
5. ابدأ بعنوان واضح لكل إجابة
6. اختم كل إجابة بـ 2-3 أسئلة متابعة مقترحة
7. إذا سُئلت عن شيء غير موجود في البيانات، قل ذلك بوضوح
8. استخدم الرموز باعتدال: 📈📉🎯⚠️✅❌💡🔥
9. عند ذكر تغييرات، اذكر النسبة المئوية والاتجاه
10. كن مباشراً — ابدأ بالجواب ثم التفاصيل
11. عند تقديم توصيات، رقّمها وحدد الأولوية (عاجل/مهم/اقتراح)

## تنسيق الإجابة:
\`\`\`
## العنوان 📊

[التحليل المختصر مع أرقام ونسب]

### التفاصيل
[جداول أو قوائم مفصلة]

### التوصيات 💡
1. [توصية عاجلة]
2. [توصية مهمة]
3. [اقتراح]

---
**أسئلة متابعة:**
- سؤال 1؟
- سؤال 2؟
- سؤال 3؟
\`\`\``;

export async function POST(req: Request) {
  try {
    const { messages, orgId } = await req.json();
    const ORG_ID = orgId || "00000000-0000-0000-0000-000000000001";


    const knowledgeContext = await buildKnowledgeContext(ORG_ID);
    const modelMessages = await convertToModelMessages(messages);

    const supabase = await createServerSupabaseClient();

    const queryDbParams = z.object({
      table: z.enum([
        "deals", "tickets", "employees", "employee_scores",
        "projects", "partnerships", "kpi_snapshots", "alerts",
        "renewals", "reviews",
      ]).describe("The table to query"),
      select: z.string().default("*").describe("Columns to select, e.g. 'client_name,deal_value,stage' or '*' for all"),
      filters: z.array(z.object({
        column: z.string().describe("Column name to filter on"),
        operator: z.enum([
          "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
        ]).describe("Filter operator: eq (equals), ilike (case-insensitive partial match — use %keyword%), gt (greater than), etc."),
        value: z.string().describe("Value to filter by. For ilike use %keyword% pattern. Numbers should be passed as strings."),
      })).default([]).describe("Filters to apply"),
      orderColumn: z.string().optional().describe("Column name to order results by"),
      orderAscending: z.boolean().default(false).describe("Whether to order ascending (true) or descending (false)"),
      limit: z.number().default(50).describe("Max number of rows to return"),
    });

    const result = streamText({
      model: google("gemini-3-flash-preview"),
      system: `${AGENT_SYSTEM_PROMPT}\n\n---\n\n## بيانات الشركة الحالية:\n${knowledgeContext}`,
      messages: modelMessages,
      stopWhen: stepCountIs(5),
      tools: {
        webSearch: tool({
          description: "Search the web for current information. Use this for market trends, competitor info, industry news, restaurant tech updates, or any information not available in the company database.",
          inputSchema: z.object({
            query: z.string().describe("The search query in Arabic or English"),
          }),
          execute: async ({ query }) => {
            try {
              const searchResult = await generateText({
                model: google("gemini-3-flash-preview"),
                prompt: query,
                tools: {
                  googleSearch: google.tools.googleSearch({}),
                },
              });
              return {
                success: true as const,
                result: searchResult.text,
                query,
              };
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
          description: "Query any table in the Supabase database. Use this to look up specific clients, deals, tickets, employees, or any other data. Always use this when the user asks about a specific record.",
          inputSchema: queryDbParams,
          execute: async ({ table, select, filters, orderColumn, orderAscending, limit }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let query = supabase.from(table).select(select).eq("org_id", ORG_ID).limit(limit) as any;

            for (const filter of filters) {
              if (filter.operator === "in") {
                const values = filter.value.split(",").map((v: string) => v.trim());
                query = query.in(filter.column, values);
              } else if (filter.operator === "is") {
                query = query.is(filter.column, null);
              } else {
                query = query.filter(filter.column, filter.operator, filter.value);
              }
            }

            if (orderColumn) {
              query = query.order(orderColumn, { ascending: orderAscending });
            }

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
