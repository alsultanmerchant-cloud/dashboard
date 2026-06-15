import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

// =========================================================================
// Shared read-only AI tools.
//
// queryDatabase (declarative row fetch) and runAnalytics (single read-only
// SQL) are the agent's analysis primitives. They're extracted here so the
// /agent route AND the dashboard select-text assistant ("explain more about
// this") expose the exact same, identically-guarded read surface.
//
// Both are auto-scoped to the caller's organization and share an anti-loop
// `seen` map (Gemini occasionally re-fires the same call verbatim — repeats
// abort so the model is forced to change strategy or answer in text).
// =========================================================================

// Allowed tables for queryDatabase — only the agency MVP schema.
export const ALLOWED_TABLES = [
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

/**
 * Build the read-only tool set, scoped to `orgId`. Pass a `seen` map (shared
 * with any other tools in the same turn) so identical re-fires are caught
 * across the whole tool set.
 */
export function buildReadTools(orgId: string, seen: Map<string, number>) {
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
    limit: z.number().default(200).describe("Max rows. Raise it (up to a few thousand) for wide analysis instead of stopping at the first page."),
    includeArchived: z
      .boolean()
      .default(false)
      .describe("tasks table only: when false (default) archived tasks (archived_at not null) are excluded. Set true only if the user explicitly wants historical/archived data."),
  });

  return {
    runAnalytics: tool({
      description:
        "Run a SINGLE read-only SQL query (SELECT / WITH only) against the agency Postgres database and get aggregated JSON rows back. This is the deep-analysis engine — use it for ANY question involving counts, sums, averages, group-by, trends over time, comparisons, or per-employee/per-service/per-stage breakdowns. Do NOT fetch raw rows and tally them by hand. Key tables: tasks, projects, clients, task_assignees, employee_profiles, sales_handover_forms, services, task_timesheets, ai_events, departments. The tasks table is mostly archived rows — add `archived_at is null` unless the user explicitly wants historical data. Examples: monthly throughput `select date_trunc('month',completed_at) m, count(*) n from tasks where stage='done' and archived_at is null group by 1 order by 1`; employee performance `select e.full_name, count(*) total, count(*) filter (where t.is_overdue) overdue, round(avg(t.delay_days),1) avg_delay from task_assignees a join tasks t on t.id=a.task_id join employee_profiles e on e.id=a.employee_id where t.archived_at is null group by 1 order by overdue desc`.",
      inputSchema: z.object({
        sql: z
          .string()
          .describe(
            "A single read-only SQL statement starting with SELECT or WITH. No semicolons, no writes/DDL. Max 2000 rows returned.",
          ),
        purpose: z
          .string()
          .describe("One short sentence (Arabic) describing what this query answers."),
      }),
      execute: async ({ sql }) => {
        const sig = `runAnalytics:${sql.trim()}`;
        const n = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, n);
        if (n > 1) {
          return {
            success: false as const,
            error:
              "نفس استعلام التحليل نُفّذ مسبقًا في هذه الجولة. استخدم النتيجة السابقة أو غيّر الاستعلام، ثم قدّم إجابة نصية.",
            rows: null,
          };
        }
        try {
          const { data, error } = await supabaseAdmin.rpc("agent_run_readonly_sql", { p_sql: sql });
          if (error) {
            return { success: false as const, error: error.message, rows: null };
          }
          const rows = (data ?? []) as unknown[];
          return { success: true as const, rowCount: rows.length, rows };
        } catch (err) {
          return {
            success: false as const,
            error: err instanceof Error ? err.message : "analytics query failed",
            rows: null,
          };
        }
      },
    }),
    queryDatabase: tool({
      description: "Query the agency database (auto-scoped to current organization). Use this to look up clients, projects, tasks, handovers, and ai_events.",
      inputSchema: queryDbParams,
      execute: async ({ table, select, filters, orderColumn, orderAscending, limit, includeArchived }) => {
        const sig = `queryDatabase:${JSON.stringify({ table, select, filters, orderColumn, orderAscending, limit, includeArchived })}`;
        const n = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, n);
        if (n > 1) {
          return {
            success: false as const,
            error:
              "تم استدعاء نفس الاستعلام مسبقًا في هذه الجولة. استخدم النتائج السابقة أو غيّر الاستعلام، ثم قدّم إجابة نصية للمستخدم.",
            data: null,
            count: 0,
          };
        }
        let query = supabaseAdmin
          .from(table)
          .select(select)
          .eq("organization_id", orgId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // Default-hide archived tasks — the tasks table is ~85% archived rows,
        // which otherwise drown out the ~2k active tasks.
        if (table === "tasks" && !includeArchived) {
          query = query.is("archived_at", null);
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
  };
}
