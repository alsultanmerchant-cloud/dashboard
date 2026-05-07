# Agency Command Center — Project Context

Internal operating system for a Saudi marketing agency (codename **Rawasm**), gradually replacing a customized Odoo deployment. Arabic-first, RTL, dark "command-center" aesthetic.

## Stack
- Next.js 16 App Router · React 19 · TypeScript · Bun
- Tailwind 4 · shadcn ("base-nova" style) · `@base-ui/react` primitives · Tajawal font
- Supabase (Postgres 17 + Auth + RLS) — project ref `vghokairfpzxcciwpokp`
- Vercel AI SDK + Google Gemini for the in-app assistant

## How this codebase came to be
Forked from `mahm0udsaad/sales-ar` (a polished CommandCenter the client liked).
Original schema and dead modules pruned. New agency MVP schema layered in.

## Single-tenant
The seeded organization slug is **`rawasm-demo`**. All UI assumes one org; the schema keeps `organization_id` everywhere for future multi-tenant growth.

## Owner account (test)
- Email: `alsultain@agency.com`
- Password: `alsultain22`
- Role: `owner` (full permissions)

## Domain (the MVP golden thread)
**Sales Handover → Client → Project → Auto-generated Tasks → Comments/@mentions → Notifications → Dashboard → AI events**

Departments · Employees · Roles & Permissions · Services (Social Media · SEO · Media Buying) · Task Templates with default offsets · Audit logs · AI events foundation.

## Migrations
Applied directly to the Supabase project via Management API. Source-of-truth files in `supabase/migrations/`. Pattern: apply via `mcp__supabase__apply_migration` first, then mirror identical SQL to `supabase/migrations/NNNN_<snake_name>.sql`. Idempotent (`if not exists`, `do $$ ... $$`, `or replace`). Triggers/RPCs use `security definer set search_path = public`. RLS read via `public.has_org_access(...)`, write via `public.has_permission(org, '<perm_key>')`.

### Recent migrations (Sky Light parity)
- **0048** Approval gates (enum `task_approval_status`, RPCs, `TaskApprovalPanel`)
- **0049** Project specialist slots (social/media/seo on `projects`)
- **0050** Human-readable codes (`projects.project_code` PRJ-007, `tasks.task_code` PRJ-007-014)
- **0051** Task dependencies (FS/SS/FF/SF, cycle prevention, `recalculate_project_task_dates`, SVG Gantt at `/projects/[id]/gantt`)
- **0052** Saved per-user filters + 3 hardcoded filters (Due Today / Behind Schedule / Critical Delay)
- **0053** Daily overdue cron (`notify_overdue_tasks` 06:00 UTC)
- **0054** 4-value `task_state` enum (derived from stage)
- **0055** Saudi working calendar (`holidays`, `is_working_day`, `working_days_between`, `add_working_days`) — admin UI at `/settings/holidays`
- **0056** Sub-tasks (`tasks.parent_task_id`) + `task_timesheets`
- **0057** `tasks.delay_days` uses `working_days_between` via trigger
- **0058** `tasks.is_overdue` trigger-maintained boolean (overnight refresh in 0053 cron)
- **0059** `tasks.actual_done_date` (date) distinct from `completed_at` (timestamptz)
- **0060** `task_activities` (mail.activity-style scheduled to-dos) + cron `notify_overdue_activities` 06:05 UTC
- **0061** `tasks.search_tsv` tsvector (title + description, `arabic` config) + GIN index → `listTasks()` uses `websearch_to_tsquery`
- **0062** `projects.gantt_prefs jsonb` — per-project Gantt rendering toggles

## Key UI surfaces
- `/tasks?view=<kanban|list|calendar|pivot>` — view-switcher; list view has cross-task bulk-ops toolbar (stage / priority / shift_deadline; per-task moves so DB transition guards fire)
- `/tasks/[id]` — 7-tab form: سجل النشاط · الوصف · مهام فرعية · ربط المهام · السجل الزمني · أنشطة مجدولة · تاريخ المراحل. Header has smart-button stat pills (subtasks/links/hours/comments/activities) that scroll the matching tab into view.
- `/projects/[id]/gantt` — SVG Gantt with two tabs: المخطط (chart) and الإعدادات (per-project toggles persisted to `projects.gantt_prefs`)
- `/settings/holidays` — Saudi working calendar admin (writes auto-trigger `recompute_task_delay_days`)
- `/reports` — Odoo-live KPIs + 3 Supabase-native recharts (stage dwell, specialist load, slip-bucket heatmap) + renewal forecast + weekly digest

## Odoo (Rwasem) integration
The Skylight team runs on a customized Odoo 17 deployment (addons mirrored at `/Users/mahmoudmac/Documents/projects/skylight_addons-master`). The dashboard is the operator UI + AI layer on top of that system, not a replacement.
- `src/lib/odoo/` — typed JSON-RPC client + idempotent importer (employees → clients → projects → tasks). Run with `bun run sync:odoo`.
- Migration `0011_odoo_external_ref.sql` adds `external_source` + `external_id` to clients/projects/tasks/employee_profiles so re-runs upsert in place.
- Writeback (dashboard → Odoo) not yet built — will live in a custom Odoo addon `mr_dashboard_sync`.

## Where to look
- `src/lib/supabase/` — server/admin/middleware/browser clients + generated `types.ts`
- `src/lib/supabase/types.ts` — generated TS types for the agency schema
- `supabase/migrations/` — SQL migrations (already applied)
- `docs/MVP_PLAN.md` — 10-phase execution plan with gates
- `src/app/(dashboard)/` — modules
- `src/app/api/agent/route.ts` — AI assistant (Gemini via @ai-sdk/google, model `gemini-3-flash-preview`). System prompt is grounded on the Rwasem schema + the Sky Light operations PDF workflow rules.

## Working rules
- Never commit secrets; `.env.local` contains real keys, `.env.example` placeholders
- Every mutation: zod-validate → check user → check org scope → write `audit_log` if material → write `ai_event` if business-relevant
- Every page must implement skeleton + empty + error states; mobile responsive; RTL-correct

## Commands
- `bun install` — install deps
- `bun dev` — dev server on :3000
- `bun run build` — production build
- `bun run lint`
