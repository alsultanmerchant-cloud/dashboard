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
Applied directly to the Supabase project via Management API. Source-of-truth files in `supabase/migrations/0001…0006`.

## Where to look
- `src/lib/supabase/` — server/admin/middleware/browser clients + generated `types.ts`
- `src/lib/supabase/types.ts` — generated TS types for the agency schema
- `supabase/migrations/` — SQL migrations (already applied)
- `docs/MVP_PLAN.md` — 10-phase execution plan with gates
- `src/app/(dashboard)/` — modules (most pages are stubs/inherited; rewrites tracked in plan)
- `src/lib/auth-context.tsx` — **legacy**, queries `user_profiles` (doesn't exist). Phase 2 rewrites this against `employee_profiles + roles + user_roles`.
- `src/app/api/agent/route.ts` — **legacy** AI system prompt referencing old sales/deals tables. Phase 6 rewires.

## Working rules
- Never commit secrets; `.env.local` contains real keys, `.env.example` placeholders
- Every mutation: zod-validate → check user → check org scope → write `audit_log` if material → write `ai_event` if business-relevant
- Every page must implement skeleton + empty + error states; mobile responsive; RTL-correct

## Commands
- `bun install` — install deps
- `bun dev` — dev server on :3000
- `bun run build` — production build
- `bun run lint`
