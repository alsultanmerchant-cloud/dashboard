# Phase 6 — Live dashboard + AI insights + agent rewire (report)

## Done

### Live dashboard (`/dashboard`)
- New `src/lib/data/dashboard.ts` with: `getDashboardStats`, `getRecentHandovers`, `getOverdueTasks`, `getActivityFeed`, `getAiEventCounts`, `getTeamLoad`.
- Replaced the placeholder dashboard with a real, fully-rendered overview:
  - 8 `MetricCard`s with live numbers from current DB (linked to their respective list pages).
  - "آخر التسليمات" — most recent handovers with status + urgency + "المشروع" link.
  - "مهام متأخرة" — destructive-toned cards or success empty state.
  - "نشاط الفريق" — fused activity feed reading from `ai_events`, with importance highlight.

### AI insights (`/ai-insights`)
- Rewrote the page to mix real `ai_events` aggregation with the spec's placeholder analysis cards:
  - Top row: 3 metrics (total events, high-importance count, distinct event types).
  - 6 insight placeholder cards (المخاطر اليومية · المهام المتأخرة · صحة المشاريع · نشاط الفريق · أنماط متكررة · إجراءات مقترحة) each tagged "Phase 9".
  - Distribution grid showing live counts per event_type.
  - 20-row live feed of recent events with importance highlight.

### Agent rewire (`/api/agent`)
- Replaced the legacy RESTAVO restaurant prompt with a new agency-specific system prompt explaining:
  - Persona: agency operations assistant inside Agency Command Center.
  - Capabilities focused on agency domain (clients/projects/tasks/handovers/ai_events/mentions).
  - Full table listing (21 tables in the new schema) with column hints.
- New `buildOrgSnapshot()` inlined into the route — composes a live "current state" string for system prompt context (counts, recent handovers, recent projects, event tally).
- Authentication now via `getServerSession()` instead of trusting body-supplied `orgId`.
- `queryDatabase` tool now uses `organization_id` (correct column) and filters auto-scope to the current session's org.
- Allowed-tables enum extended to all 21 agency tables.
- Deleted legacy `src/lib/ai/{alerts,gemini,knowledge,prompts,scoring}.ts` (queried sales/deals/tickets) and `src/lib/demo-data.ts` (sales-ar fixtures).

## Verified (browser)

`/dashboard` (live): 2 active clients · 2 projects · 30 open tasks · 0 overdue · 0 new handovers · 0 done this week · 2 unread · 43 ai_events today. Recent handover card shows "بيت الأناقة للأزياء" with `مقبول` + `عالٍ` badges and links to the project. Activity feed renders 11 events (handover · notification · 9× task creations).

`/ai-insights`: 43 total events · 0 high-importance · 9 distinct types. All 6 insight cards rendered with Phase 9 badges. Distribution grid shows correct counts: 30 TASK_CREATED · 4 PROJECT_SERVICE_ATTACHED · 2 CLIENT_CREATED · 2 PROJECT_CREATED · 1 each for HANDOVER_SUBMITTED / TASK_COMMENT_ADDED / MENTION_CREATED / NOTIFICATION_CREATED / TASK_STATUS_CHANGED. Live feed shows 20 items.

## Not verified
- Agent chat itself wasn't pinged because `GEMINI_API_KEY` isn't set in `.env.local` (the user didn't provide one). The route compiles, system prompt + tools are correctly wired to the new schema, and `getServerSession` guards the endpoint. Once the key is added the chat should answer queries against the agency data immediately.

## Decisions logged
- **Agent uses session-scoped admin queries.** RLS isn't applied to admin-client reads, but the route filters by `session.orgId` on every query, so cross-org data leakage is impossible at this layer. If we ever switch the agent to a per-user supabase client we get RLS for free; for now admin gives us reliable reads even when a user's role lacks specific perms.
- **AI insights page does both:** real aggregation (so the user sees value today) + placeholder cards (so the spec's Phase 9 deliverables have a UX home ready). Phase 9 just swaps each placeholder card for a real analysis.
- **Dashboard greeting** uses `session.fullName` ("مرحبًا، السلطان") — a small but warm touch for the executive feel.

## Next
**Phase 7 — Organization (departments, employees, roles).**
- `/organization/departments` real list + create.
- `/organization/employees` real list with department filter, employment status badges.
- Invite flow: server action that creates `auth.users` (via admin SDK) + `employee_profiles` + assigns role; password is auto-generated and shown once.
- `/organization/roles` shows the role × permission matrix (read-only).
- Gate: can invite a new employee end-to-end and see them appear as an option in the handover form's AM picker.
