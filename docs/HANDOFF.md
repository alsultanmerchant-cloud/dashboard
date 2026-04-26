# Handoff — Agency Command Center MVP

**Date:** 2026-04-26
**Project:** Agency Command Center (codename "Rawasm")
**Phases shipped:** 0–9 (10 phases · 10 commits on `main`)
**Supabase project:** `vghokairfpzxcciwpokp` (region ap-southeast-1, Postgres 17)
**Owner test account:** `alsultain@agency.com` / `alsultain22`

## What's done

A polished MVP for an internal Saudi marketing agency operating system. **Single-tenant UI** on a **multi-tenant schema**. Arabic-first, RTL throughout, premium dark "command center" aesthetic.

The golden thread works end-to-end via the actual UI:
**Sales handover form → client upserted → project created → services attached → 15 tasks generated → AM notified → audit + ai_event logged.**

### Modules
| Module | State |
|---|---|
| Auth (login + session + RBAC) | ✅ owner logs in, permission-keyed nav |
| `/dashboard` | ✅ live (8 metric cards · recent handovers · overdue tasks · fused activity feed) |
| `/notifications` | ✅ filters + per-card mark-read + bulk + entity routing |
| `/ai-insights` | ✅ event aggregation + 6 Phase-9 placeholder cards |
| `/agent` (AI chat) | ✅ wired (chat itself needs `GEMINI_API_KEY`) |
| `/handover` | ✅ centerpiece form + history list (Scenario A green) |
| `/clients` | ✅ list + create dialog |
| `/projects` (+ detail) | ✅ list + create with services + member + detail page |
| `/tasks` (+ detail) | ✅ list with filter chips + detail with status select + comments + `@mention` highlight |
| `/task-templates` (+ detail) | ✅ list + full items table |
| `/organization/departments` | ✅ list + create |
| `/organization/employees` | ✅ list + invite flow (auto-creates auth user, shows generated password once) |
| `/organization/roles` | ✅ 8×16 role × permission matrix |
| `/reports` | ✅ rollup metrics + service distribution |
| `/settings` | ✅ org info + account info |
| `/sales`, `/hr`, `/finance`, `/sales/leads`, `/sales/team` | ✅ "مرحلة لاحقة" placeholders |
| Global `error.tsx` + `not-found.tsx` | ✅ |
| `/dev/design-system` | ✅ public design-system showcase |

## QA Scenarios (all green)

| # | Scenario | Result |
|---|---|---|
| A | Handover end-to-end via UI | ✅ 1 handover · 1 client · 1 project · 2 services · 15 tasks · 1 notification · `HANDOVER_SUBMITTED` ai_event |
| B | Task comment with `@mention` | ✅ comment + mention + notification + `TASK_COMMENT_ADDED` + `MENTION_CREATED` events |
| C | Overdue dashboard count | ✅ backdating a task surfaces in the "مهام متأخرة" metric (destructive-toned) |
| D | RLS attack from non-org user | ✅ rogue JWT user gets `[]` on every SELECT, `42501` on INSERT |
| E | Audit log coverage | ✅ 6 distinct actions: `client.create` / `project.create` / `task.status_change` / `task.comment_add` / `handover.submit` / `employee.invite` |

## DB state at handoff

| Table | Rows |
|---|---|
| `organizations` | 1 (`rawasm-demo`) |
| `departments` | 10 |
| `services` | 3 (Social Media · SEO · Media Buying) |
| `roles` | 8 (owner · admin · manager · sales · account_manager · specialist · designer · viewer) |
| `permissions` | 16 |
| `role_permissions` | 71 |
| `task_templates` | 3 |
| `task_template_items` | 22 |
| `employee_profiles` | 2 (السلطان, نورة المالكي) |
| `auth.users` | 2 |
| `user_roles` | 2 |
| `clients` | 2 |
| `projects` | 2 |
| `project_services` | 4 |
| `project_members` | 2 |
| `tasks` | 30 |
| `task_comments` | 1 |
| `task_mentions` | 1 |
| `sales_handover_forms` | 1 |
| `notifications` | 2 |
| `audit_logs` | 6 |
| `ai_events` | 44 |

## Security audit

- **22 tables, RLS on all 22**, no missing policies.
- 3 helper functions (`current_user_organization_ids`, `has_org_access`, `has_permission`) all `SECURITY DEFINER` with `search_path=public`.
- All FK columns + status + due_date + read_at have backing indexes.
- Server actions write through `supabaseAdmin` (service role) but only after `requireSession`/`requirePermission`. Never imported by client components.

## How to run / test locally

```bash
bun install
cp .env.example .env.local
# fill in the keys (Supabase URL, anon, service role, access token)
bun dev
# open http://localhost:3000 → log in alsultain@agency.com / alsultain22
```

To re-run the QA scenarios manually:
1. **A:** open `/handover` → fill the form → submit (verify the toast and the new card in the history).
2. **B:** click any task in `/tasks` → change status → add a comment containing `@السلطان` → see the bell counter increment.
3. **C:** in Supabase SQL editor, run `update tasks set due_date = current_date - interval '3 days' where id = (select id from tasks where status='todo' limit 1);` → reload `/dashboard` → "مهام متأخرة" goes up by 1.
4. **D:** see the curl snippet in `docs/phase-9-report.md` (creates a rogue user, verifies they get `[]`, deletes them).
5. **E:** SQL: `select action, count(*) from audit_logs group by action`.

## Known limitations

- Mention parser is single-token prefix-match; multi-word names use longer-match fallback.
- Invite flow shows the generated password once in a dialog; no email sending yet.
- AI chat needs `GEMINI_API_KEY` to work end-to-end. The system prompt + `queryDatabase` tool are correctly wired to the agency schema.
- Reports / Settings / AI insights are honest placeholders with one functional tile each.
- Single-tenant UI on a multi-tenant schema (intentional MVP simplification).
- `uuidLoose` regex used in zod schemas because seed fixture UUIDs (`22222222-1111-…`) aren't RFC-variant-compliant.

## Recommended next phases

1. **Multi-tenant UI** — org switcher in sidebar, RLS-aware admin client paths, invitation flow per-org.
2. **AI insights with a real model** — wire Gemini (or Claude / GPT) into `/ai-insights` for the 6 placeholder cards. The `ai_events` table is the substrate.
3. **Edit affordances** — inline edits on `/clients/[id]`, `/projects/[id]`, role-permission matrix toggles.
4. **Email + WhatsApp integrations** — invite emails, handover notifications, mention alerts.
5. **Real-time** — Supabase Realtime channels for notifications, task status, comment mentions.
6. **HR / Finance / Sales CRM modules** — replace the placeholders with real implementations.
7. **Hardening** — switch server actions to per-user supabase clients (RLS coverage at write time too); rotate the test credentials.

## Repository

Phase commits on `main`:
```
90b4578 phase-8: placeholders + polish (notifications, reports, settings, 404, error)
8bb5e5a phase-7: organization (departments, employees, roles) + invite flow
0749447 phase-6: live dashboard + AI insights + agent rewire
708850e phase-5: sales handover centerpiece — Scenario A green
595681f phase-4: core CRUD vertical (clients, projects, tasks, task-templates)
7e343cc phase-3: shell + sidebar groups + Cmd-K + real notification bell
fb85609 phase-2: auth + RBAC adaptation
c5803af phase-1: design system unification
86ce327 phase-0: foundation reset (forked from sales-ar)
```
Each phase has a report under `docs/phase-N-report.md` with what was done, what was verified, decisions logged, and what's next.
