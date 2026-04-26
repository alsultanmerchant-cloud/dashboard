# Agency Command Center

Internal operating system for a Saudi marketing agency (codename **Rawasm**). Replaces a customized Odoo deployment with an AI-ready, Arabic-first dashboard. RTL throughout, dark "command center" aesthetic.

> **Status:** MVP complete (10 phases shipped). Sales handover golden thread end-to-end. RLS verified. Mobile responsive.

---

## Tech stack

- **Next.js 16** (App Router · React 19 · Turbopack) · TypeScript · **Bun**
- **Tailwind 4** · **shadcn** "base-nova" style · `@base-ui/react` primitives · Tajawal Arabic font
- **Supabase** (Postgres 17 + Auth + RLS) · `@supabase/ssr`
- **Vercel AI SDK** + **Google Gemini** for the in-app assistant (`/agent`)
- Recharts · TanStack Table · Zod · sonner · lucide-react

---

## Quick start

```bash
# 1. Install deps
bun install

# 2. Environment — copy and fill
cp .env.example .env.local
# Edit .env.local with the Supabase credentials below.

# 3. Boot
bun dev
# → http://localhost:3000
```

**Owner credentials (test environment):**
- Email: `alsultain@agency.com`
- Password: `alsultain22`

---

## Environment variables (`.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://vghokairfpzxcciwpokp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>
SUPABASE_ACCESS_TOKEN=<personal access token, only for migrations>
SUPABASE_PROJECT_ID=vghokairfpzxcciwpokp

# Optional — enables /agent chat + /api/agent
GEMINI_API_KEY=<your Google AI Studio key>

NEXT_PUBLIC_APP_NAME="مركز قيادة الوكالة"
NEXT_PUBLIC_DEFAULT_ORG_SLUG=rawasm-demo
```

> Never commit `.env.local`. `.env.example` only carries placeholders.

---

## Database

The Supabase project is already migrated. To re-apply on a fresh project, run the 6 migrations in `supabase/migrations/` in order:

```
0001_extensions_and_core.sql      # orgs, departments, employees, roles, permissions, helpers
0002_clients_projects.sql         # services, clients, projects, project_services, project_members
0003_tasks.sql                    # task_templates, items, tasks, assignees, comments, mentions
0004_handover_notifications_audit.sql   # sales_handover_forms, notifications, audit_logs, ai_events
0005_rls_policies.sql             # 22 tables RLS-enabled with practical policies
0006_seed.sql                     # 1 org, 10 departments, 3 services, 8 roles, 16 permissions, 22 template items
```

After that create the owner via the Auth admin API:
```bash
curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"alsultain@agency.com","password":"alsultain22","email_confirm":true}'
```
Then link the new user to `employee_profiles` + `user_roles` (see the bootstrap snippet in `docs/phase-0-report.md`).

---

## What's inside

```
src/
├── app/
│   ├── (auth)/login/                       # public login page
│   ├── (dashboard)/                        # authenticated app
│   │   ├── dashboard/                      # live overview (8 metrics + recents + activity feed)
│   │   ├── notifications/                  # filter chips + per-card mark-read + bulk
│   │   ├── ai-insights/                    # AI event aggregation + 6 Phase-9 placeholder cards
│   │   ├── agent/                          # AI chat (rewired to query agency tables)
│   │   ├── handover/                       # ★ centerpiece form + history
│   │   ├── clients/                        # list + create dialog
│   │   ├── projects/                       # list + new-project dialog + detail
│   │   ├── tasks/                          # list with filter chips + detail with status + comments
│   │   ├── task-templates/                 # list + items detail
│   │   ├── organization/                   # departments, employees (+ invite), roles matrix
│   │   ├── reports/                        # rollup metrics + service distribution
│   │   ├── settings/                       # org info + account info
│   │   └── sales/, hr/, finance/           # "مرحلة لاحقة" placeholders
│   ├── api/agent/route.ts                  # streaming AI chat (system prompt + queryDatabase tool)
│   ├── auth/callback/                      # Supabase auth callback
│   ├── dev/design-system/                  # public showcase of the design system
│   ├── error.tsx                           # global error boundary
│   ├── not-found.tsx                       # 404
│   └── layout.tsx                          # RTL · Tajawal · sonner Toaster
├── components/
│   ├── ui/                                 # shadcn primitives on @base-ui/react
│   ├── layout/                             # sidebar, topbar, notification panel
│   └── ...                                 # PageHeader, MetricCard, EmptyState, ErrorState, status-badges, FilterBar, DataTableShell, CommandPalette, etc.
├── lib/
│   ├── supabase/{client,server,admin,middleware,types}.ts
│   ├── auth-context.tsx                    # client-side auth (employee_profiles + roles + perms)
│   ├── auth-server.ts                      # server-only: requireSession, requirePermission
│   ├── audit.ts                            # logAudit, logAiEvent, createNotification
│   ├── data/                               # clients, projects, tasks, templates, employees, handover, dashboard, organization
│   ├── workflows/                          # generate-tasks, mentions
│   ├── nav.ts                              # single source of truth for nav groups + page titles
│   ├── schemas.ts, labels.ts, copy.ts, utils-format.ts, constants.ts
│   └── utils.ts
├── middleware.ts                           # Supabase session refresh + login redirect
└── types/                                  # AppNotification etc.
supabase/migrations/                        # 6 SQL migrations (already applied)
docs/                                       # phase-0…phase-9 reports + design-system + MVP_PLAN + HANDOFF
```

---

## Test scenarios (all green)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| **A** | Sales handover end-to-end | ✅ | 1 handover row · 1 client · 1 project · 2 services · **15 tasks generated** · 1 notification · `HANDOVER_SUBMITTED` ai_event |
| **B** | Task comment + `@mention` | ✅ | 1 task_comment · 1 task_mention · 1 notification · `TASK_COMMENT_ADDED` + `MENTION_CREATED` ai_events |
| **C** | Overdue task on dashboard | ✅ | Backdate any open task → dashboard "مهام متأخرة" tile shows count + destructive tone |
| **D** | RLS attack from non-org user | ✅ | Rogue user with valid JWT but no `employee_profiles`/`user_roles` row gets `[]` on every SELECT and `42501` on INSERT |
| **E** | Audit log presence | ✅ | 6 distinct actions: `client.create` · `project.create` · `task.status_change` · `task.comment_add` · `handover.submit` · `employee.invite` |

Reproduce manually:
1. **Handover** form (`/handover`) → fill client + 2 services + AM + urgency → submit.
2. **Tasks** (`/tasks?filter=open`) → open any task → change status → add comment with `@السلطان`.
3. Backdate a task in DB to verify Scenario C, then refresh `/dashboard`.
4. RLS test snippet is in `docs/phase-9-report.md`.

---

## Security posture

- **22 tables, RLS enabled on all 22.** Every table has at least 1 policy (most have 2-3).
- **`current_user_organization_ids()`, `has_org_access(uuid)`, `has_permission(uuid, text)`** are all `SECURITY DEFINER` with `search_path=public`.
- **Org isolation verified** via Scenario D (cross-org SELECTs return `[]`, INSERTs raise `42501`).
- **Server actions** use `requireSession` / `requirePermission` and write through `supabaseAdmin` (service role) inside `"use server"` modules. Never imported into client components.
- **`.env.local`** is gitignored. The keys provided in this repo are for the test project only.

---

## Known limitations

- **Single-tenant UI.** Schema is multi-tenant (every domain table carries `organization_id`); the sidebar/forms assume one org. Phase 10 adds an org switcher.
- **Mention parsing is single-token prefix-match** against `employee_profiles.full_name`. Multi-word names use a longer-match fallback. A real picker UI is a follow-up.
- **AI agent system prompt** is wired to the new schema but the chat itself only works with `GEMINI_API_KEY` set.
- **Reports / Settings / `/ai-insights`** ship as **honest placeholders** with one functional tile each. Heavy reporting + per-team analysis is the Phase 9 plan in the spec.
- **`/sales`, `/hr`, `/finance`** are intentional "مرحلة لاحقة" stubs.
- **No password reset email** — invite flow generates a password and shows it once. Phase 10 wires Supabase invitations.
- **`uuidLoose` validator** — relaxed UUID regex to accept the seed-fixture UUIDs whose variant nibbles aren't RFC-compliant. DB-level UUID type still enforces parseability.

---

## Architecture rules

- Every mutation: zod-validate → `requirePermission` → `supabaseAdmin` insert → `audit_logs` row → `ai_events` row → `revalidatePath`.
- Every page: skeleton + empty + error states; mobile responsive; RTL-correct via logical CSS properties.
- Every nav item declares a `perm` (or none = available to all org members). Owner bypasses all perm checks.
- AI events are the substrate for future analysis: 10 distinct types covering the full domain lifecycle.

---

## Useful commands

```bash
bun dev                  # dev server :3000 (Turbopack)
bun run build            # production build
bun run lint             # eslint
```

```bash
# Apply a migration to the live Supabase project
curl -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs '{query: .}' < supabase/migrations/000X_name.sql)"
```

---

## Roadmap

- **Phase 10 — Multi-tenant UI** + org switcher
- **Phase 11 — Advanced AI insights** wired to a real LLM (risks, delays, project-health scoring)
- **Phase 12 — HR / Finance / Sales CRM** modules
- **Phase 13 — Email + WhatsApp integrations** for invitations and external comms
- Edit affordances across `/clients/[id]`, `/projects/[id]`, role-permission matrix
- Real-time updates via Supabase Realtime channels (notifications, task status, mention bell)

---

## Credits

- Forked from [`mahm0udsaad/sales-ar`](https://github.com/mahm0udsaad/sales-ar) (CommandCenter shell, RTL fonts, agent UI shell).
- Built phase-by-phase with documented gates — see [docs/MVP_PLAN.md](docs/MVP_PLAN.md), [docs/HANDOFF.md](docs/HANDOFF.md), and `docs/phase-N-report.md`.
