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
Applied directly to the Supabase project via Management API. Source-of-truth files in `supabase/migrations/0001…0011`.

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
