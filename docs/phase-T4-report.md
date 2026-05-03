# Phase T4 — Categories Engine

**Status:** Migration written (not yet applied — orchestrator runs `apply_migration`). Code, UI, importer and tests committed on `main`.

**Goal:** port Odoo's `project.category` + `project.category.task` engine so creating a project + selecting services auto-generates the right tasks with correct deadlines, owners and followers.

## Deliverables

### 1. Migration `supabase/migrations/0024_categories_engine.sql`
Purely additive against the live schema (verified via `mcp__supabase__execute_sql` before authoring):

- `service_categories` (per-org, keyed by `(organization_id, key)`) — service buckets, optionally linked to a `services` row, with `external_source` / `external_id` columns for the Odoo importer.
- `task_templates` extensions: `category_id`, `default_owner_position`, `deadline_offset_days`, `upload_offset_days`, `default_followers_positions text[]`, `depends_on_template_id`, `sla_minutes_new`, `sla_minutes_in_progress`, `sort_order`. All `add column if not exists` so the existing 3 templates keep their data.
- `project_services` extensions: `category_id`, `week_split bool default false`, `weeks int` (1..12 check).
- RLS on `service_categories` using the **1-arg** `has_permission('category.manage_templates')` overload (per dispatch hard rule).
- Permission seed: `category.manage_templates` bound to `owner`, `admin`, `manager`.
- Backfill: creates a `primary:<service-slug>` category per existing service and links the seeded master templates to it so the engine still finds them when a `project_services` row carries no `category_id`.

### 2. Offset engine — `src/lib/projects/offsets.ts`
Pure module (no DB, no `server-only`) so the same code drives the live UI preview AND the server insert. Key functions:

- `computeItemDeadlines({ start, item, templateDeadlineOffsetDays?, templateUploadOffsetDays?, weekIndex })` — single-item deadline + upload-due computation; honours template-level overrides over per-item values.
- `expandTemplate({ template, projectStartDate, weekSplit?, weeks? })` — fan-out for one template.
- `expandTemplates([…])` — multi-template flatten + sort by deadline.

### 3. Tests — `tests/category-engine-offsets.test.mjs`
Pure-JS reimplementation runs against the same offset rules; **16 passed, 0 failed**. Cases cover:
- start + offset + duration arithmetic
- upload-offset clamp before deadline
- PDF §11.1 Social Media writing weeks 1/2/3 (deadline−2, −3, −4) with the +7-day shift per week
- PDF §11.2 SM design weeks 1/2/3 (−3, −4, −5)
- PDF §11 Stories/videos (−4)
- PDF §11.1 Media Buying writing (−2) and §11.2 design (−3)
- PDF §11.2 SEO landing/article banners (−4 / −5)
- Template-level `deadline_offset_days` override
- Template-level `upload_offset_days` override
- Cross-month boundary safety

Run: `bun run tests/category-engine-offsets.test.mjs`.

### 4. Server-action extension — `src/app/(dashboard)/projects/_actions.ts`
- `ProjectCreateSchema` (`src/lib/schemas.ts`) gains a `service_week_splits` array (per-service `{ service_id, week_split, weeks, category_id }`).
- The form posts the array as a JSON blob in a single hidden field; the action `JSON.parse`s and zod-validates before use.
- New helper `src/lib/projects/generate-from-categories.ts` runs the offset engine, inserts tasks + role-slot assignments + per-task `ai_event` rows. The legacy `generateTasksForProjectFromServices` path is preserved untouched and still used when no per-service overrides are present, keeping T2/T3 behaviour intact.
- `project_services` rows now persist `category_id`, `week_split`, `weeks`.
- Audit + AI events: existing `project.create`, `PROJECT_CREATED`, and per-service `PROJECT_SERVICE_ATTACHED` events extended to carry the `week_split` flag.

### 5. UI — `/projects/new`
- Server page `src/app/(dashboard)/projects/new/page.tsx` (gated by `projects.manage`) prefetches clients, services, account managers, categories and active templates.
- Client form `new-project-form.tsx` with two columns at lg+ (RTL-flipped): left = form fields, right = live preview pane.
- Service chips (multi-select). Each selected service exposes a per-service block: optional category dropdown + a "split work across weeks" toggle with weeks input (defaults to 3 for Social Media per PDF §11).
- Preview pane runs the same `expandTemplates` used by the server, re-computing on every change to start_date / category / week-split. Each preview row shows the title, deadline, upload-due, default role, and a "أسبوع N" badge for week-split copies.
- Skeleton/empty/error states handled (server page is force-dynamic, client form shows an inline empty state when no service is picked, plus an amber "no matching templates" panel when category filtering returns nothing).

### 6. UI — `/service-categories`
- Admin page gated by `category.manage_templates`.
- List view with up/down reorder buttons (no DnD lib needed — keeps the bundle lean).
- Create/edit dialog covering key, AR/EN names, linked service, description, active toggle.
- Server actions in `service-categories/_actions.ts` write `audit_log` + `ai_event` and revalidate the page.

### 7. Importer — `scripts/import-odoo-categories.ts`
- READ-ONLY against live Odoo via existing `src/lib/odoo/client.ts`.
- Reads `project.category` (~13) and `project.category.task` (~279).
- Default mode is **dry-run**: writes `tmp/categories-diff.csv` and exits. `--commit` flag actually upserts:
  - `service_categories` keyed by `(organization_id, key)` with `external_source='odoo' / external_id`.
  - `task_templates` matched by `(organization_id, name)` (acceptable until Odoo's id is also persisted on the templates table — flagged as future work).
- Failure handling: missing models log + skip; nothing else aborts the run.

### 8. Nav + copy
- `src/lib/nav.ts` adds **«تصنيفات الخدمات»** under «العملاء والمشاريع», gated by `category.manage_templates`, plus `/projects/new` and `/service-categories` to `PAGE_TITLES`.
- `/projects` page now renders a secondary CTA "**مشروع جديد بمعاينة المهام**" linking to `/projects/new`; the existing dialog stays for the legacy path.
- `src/lib/copy.ts` adds an `empty.serviceCategories` entry.

## Schema reality verified before writing
- `task_templates`, `project_services`, `task_template_items` already exist (3 / 4 / 31 rows).
- `services` carries 3 active rows (Social Media, SEO, Media Buying).
- `has_permission(text)` exists as a stable, security-definer 1-arg overload (used by the new RLS).
- `roles.key` includes `manager` (12 perms bound) and `admin` (19 perms bound) — both gain `category.manage_templates` via the seed.

## Files created
- `supabase/migrations/0024_categories_engine.sql`
- `scripts/import-odoo-categories.ts`
- `src/lib/projects/offsets.ts`
- `src/lib/projects/generate-from-categories.ts`
- `src/lib/data/service-categories.ts`
- `src/app/(dashboard)/projects/new/page.tsx`
- `src/app/(dashboard)/projects/new/new-project-form.tsx`
- `src/app/(dashboard)/service-categories/page.tsx`
- `src/app/(dashboard)/service-categories/categories-admin.tsx`
- `src/app/(dashboard)/service-categories/_actions.ts`
- `tests/category-engine-offsets.test.mjs`
- `docs/phase-T4-report.md`

## Files modified
- `src/lib/schemas.ts` (ProjectCreateSchema gains `service_week_splits`)
- `src/lib/nav.ts` (new entry + page titles)
- `src/lib/copy.ts` (empty-state entry)
- `src/app/(dashboard)/projects/_actions.ts` (categories engine path)
- `src/app/(dashboard)/projects/page.tsx` (extra CTA to /projects/new)

## Files deliberately NOT touched
Per dispatch scope: `src/app/(dashboard)/tasks/_actions.ts`, `src/app/(dashboard)/tasks/[id]/...`, any tasks RLS, `src/app/(dashboard)/projects/[id]/...`, `src/lib/supabase/types.ts`, theme/sidebar/topbar/notification-panel/layout/globals.css.

## Acceptance walk
1. Owner opens `/projects/new`.
2. Picks client + name + start_date.
3. Toggles "Social Media" — chip activates, default 3-week split appears.
4. Preview pane immediately lists 8 weekly content items (writing+design weeks 1/2/3) plus once-per-cycle items (strategy, monthly approval, scheduling, report, stories) with computed `deadline` + `upload-due` ISO dates.
5. Adding "SEO" merges its 11 templates into the preview, sorted ascending by deadline.
6. Submit → `createProjectAction` writes `projects` + `project_services` (with `week_split=true, weeks=3` for SM) + tasks via the categories engine + role slots + ai_events. Toast and redirect to the project page.

## Open follow-ups (not in T4 scope)
- The importer would benefit from persisting `task_templates.external_source/external_id` to make the upsert truly idempotent. Adding those columns is a one-line ALTER but it's owner-policy territory (do we duplicate the 0011 pattern on templates?). Surfaced for the orchestrator to decide.
- `default_owner_position` on `task_templates` is now stored but not yet consumed by the assignment resolver; the existing `generate-tasks.ts` continues to fall back to service.default_specialist. T5/T6 will close that gap when they wire SLA-aware ownership rules.
- Drag-and-drop reorder is currently arrow-button reorder. Owner can confirm if a DnD library is desired before T9.
