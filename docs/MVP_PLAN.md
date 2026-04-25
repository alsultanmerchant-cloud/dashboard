# MVP Master Plan

## North star
End-to-end golden thread: **Sales handover → Client → Project → Auto-generated tasks → Comments/@mentions → Notifications → Dashboard → AI events.** Premium command-center UI. Arabic-only, RTL. Mobile responsive. Skeleton/empty/error states everywhere.

## Design system contract
- Cyan/teal accent over deep navy gradient (inherited from sales-ar)
- Cards on cyan-tinted glass surfaces, generous radii
- Tajawal Arabic + selective English for technical labels (role keys, status enums)
- Single Arabic copy bank in `lib/copy.ts`
- Optimistic updates on status / read / mark-read
- Cmd-K command palette for power actions
- Full mobile breakpoint pass per phase

## Agents
| Role | Owns |
|---|---|
| **Orchestrator** | Master plan, gates, scope, todos |
| **Architect** | Module boundaries, route map, data flow |
| **UI/UX Lead** | Tokens, primitives, wireframes, copy bank |
| **Database Steward** | Migrations, RLS, advisors, seeds |
| **Backend Workflow Eng.** | Server actions, validators, handover engine, audit/event hooks |
| **Frontend App Eng.** | Pages, forms, tables, shell adaptation, AI agent rewire |
| **QA / Smoke Runner** | Scenarios A–E, RLS attack, mobile pass |

## Phases

### Phase 0 — Foundation reset ✅ DONE
Wipe scaffold, fork sales-ar into mr-dashboard, restore migrations & env, prune dead modules, baseline boot.
**Gate:** `bun dev` boots, `/login` renders RTL Arabic, owner credentials authenticate against Supabase. ✅

### Phase 1 — Design system unification
Define tokens; document branded primitives; build `/dev/design-system` showcase. Add new domain components: `PageHeader`, `StatCard`, `EmptyState`, status-badge family, `ServiceBadge`, `DataTableShell`, `FilterBar`, `CommandPaletteStub`.
**Gate:** `/dev/design-system` page renders all primitives + states.

### Phase 2 — Auth & RBAC adaptation
Rewrite `auth-context` against `employee_profiles + roles + permissions + user_roles`. Permission-keyed sidebar nav (replaces `allowedPages`). Owner login → dashboard.
**Gate:** alsultain@agency.com logs in, lands on dashboard, sees only allowed sidebar items.

### Phase 3 — Shell + new sidebar groups
Adapt sidebar to spec groups (لوحة التحكم · المبيعات · العملاء والمشاريع · المنظمة · الإدارة · مراحل لاحقة). Topbar keeps live clock/refresh; adds Cmd-K trigger. Notification bell wired to real `notifications` table. Mobile drawer.
**Gate:** every nav link reaches a stubbed `PageHeader` page.

### Phase 4 — Core CRUD vertical
`/clients` `/projects` `/tasks` `/task-templates` (list + create + detail). Server actions wrap audit + ai_event.
**Gate:** create client → project → tasks generated → status change → comment with @mention writes audit + ai_event row.

### Phase 5 — Sales handover centerpiece
`/handover` form + `submitHandover` engine (upsert client → create project → attach services → generate tasks → notify AM → audit → `ai_event HANDOVER_SUBMITTED`). History list.
**Gate:** Scenario A passes end-to-end.

### Phase 6 — Dashboard + AI insights
8 stat cards, recent handovers, overdue tasks, fused activity feed. Rewire `/agent` system prompt + tools to introspect new tables. `/ai-insights` placeholder cards backed by `ai_events` aggregation.
**Gate:** dashboard shows live numbers; AI assistant correctly answers a query about latest handovers.

### Phase 7 — Organization
`/organization/departments` `/employees` `/roles`. Employee creation provisions `auth.users` + `employee_profiles` + assigns role.
**Gate:** new employee created end-to-end and selectable as account manager in handover.

### Phase 8 — Placeholders + polish
`/reports` `/settings`; "next phase" cards on `/sales` `/hr` `/finance`; full `/notifications`; mobile sweep; 404 + global error boundary.
**Gate:** every sidebar link reaches a finished or intentionally-stubbed page.

### Phase 9 — QA & delivery
Scenarios A–E with screenshots; Supabase advisors clean; README + handoff doc.
**Gate:** single handoff doc explains setup, scenarios, known limits, next phase.

## Risk & decisions
- sales-ar's `users`/`user_profiles` model is incompatible with our RBAC → rewrite auth-context once, sweep usages mechanically.
- AI agent system prompt assumes sales/deals/tickets → rewrite prompt + tool surface to introspect new schema. Keep UI shell.
- RLS write policies are permissive (`has_org_access`); fine-grained gating happens in server actions via `has_permission`. Tightened post-MVP.
- Old API routes (`/api/users`, `/api/roles`) query `user_profiles` — they break until Phase 2 rewires them.
