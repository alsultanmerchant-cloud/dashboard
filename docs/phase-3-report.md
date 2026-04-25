# Phase 3 — Shell + sidebar groups + Cmd-K + real notification bell (report)

## Done
- New shared nav config at `src/lib/nav.ts` — single source of truth for sidebar groups, items, permissions, "قريبًا" flags, and topbar page titles.
- Rewrote `src/components/layout/sidebar.tsx` with the spec's grouped nav (لوحة التحكم · المبيعات · العملاء والمشاريع · المنظمة · الإدارة · مراحل لاحقة) — 19 items across 6 groups. Permission-keyed visibility (owner bypasses).
- Topbar now imports `PAGE_TITLES` from `nav.ts` (single map of `{ title, subtitle }`); added a `CommandPaletteTrigger` chip on desktop.
- Notification panel routing updated for new entity types (`handover` · `task` · `project` · `client` · `mention` · `ai_event` · `notification`).
- Heavy refactor of `src/app/(dashboard)/layout.tsx`:
  - Removed all legacy `fetchDeals/fetchTickets/fetchSalesTargets/fetchSalesActivities/fetchMentionNotifications` machinery and the demo-data import.
  - Removed the `AIAlertsBanner` (queries old `alerts` table).
  - Added `NotificationsLoader` that reads from the real `notifications` table for the current user and maps rows → `AppNotification`.
  - Mounted `CommandPaletteProvider` globally so Cmd-K opens the palette anywhere.
- Built `src/components/coming-soon-page.tsx` — shared placeholder pattern with `PageHeader`, "Phase N" badge, `EmptyState`, and optional bullet list of what the module will do.
- Created stub pages for **all 16 new routes**: `/clients`, `/projects`, `/tasks`, `/task-templates`, `/handover`, `/notifications`, `/ai-insights`, `/organization/{departments,employees,roles}`, `/reports`, `/settings`, `/sales`, `/sales/leads`, `/sales/team`, `/hr`.
- Replaced legacy pages with stubs: `/dashboard` (lightweight overview placeholder with 8 metric cards using `—` values), `/finance` (مراحل لاحقة).
- Deleted `/team` and `/users` (replaced by `/organization/employees` and `/organization/roles`).

## Verified (browser smoke)
- Sidebar renders all 6 groups with section headers and 19 items.
- "قريبًا" badges shown on the 5 placeholder modules (`sales/leads`, `sales/team`, `hr`, `finance`, `sales`).
- Cmd-K trigger visible in topbar on desktop; pressing ⌘K / Ctrl+K opens the palette.
- Active nav highlight syncs with route on click (`/handover` → "التسليم من المبيعات" highlighted).
- Topbar title + subtitle update per route from the central `PAGE_TITLES` map.
- Stub page renders correctly: PageHeader + "Phase 5" badge + EmptyState (cyan glow) + bullet panel listing what the module will do.
- Notification bell counter is 0 (no rows yet in `notifications`); panel renders empty state. Phase 5 will fill it via the handover workflow.
- Zero failed network requests (`/api` stubs + new layout no longer queries dead tables).
- Live console errors observed are stale (from previous load before refactor).

## Decisions
- **`coming-soon-page.tsx`** as a reusable component lets every stub be 5–10 lines. Each phase will swap individual stubs for real implementations without touching the surrounding chrome.
- **Removed AIAlertsBanner** — Phase 6 may reintroduce a similar banner driven by `ai_events` aggregation.
- **Old `lib/supabase/db.ts` left untouched** — many of its `fetchXxx` helpers reference deleted tables. They're orphaned now (no callers in the layout). Phase 4–7 will replace what we still need with new helpers in `lib/data/*` and we can delete the legacy file at the end.
- **Org-context preserved** but de-facto a single-org no-op — switcher only renders if multi-org. Phase 9 may delete `OrgProvider` entirely if we don't end up using its localStorage hooks.

## Known broken (intentional, later phases)
- Cmd-K palette is a stub — Phase 4+ wires nav + quick actions.
- Notification bell shows 0 unread until Phase 5's handover engine writes the first rows.
- `/agent` chat shell still works but the system prompt references old `deals/tickets/etc.` (Phase 6 rewrites).
- All Phase 4–8 modules show "قيد الإنشاء" placeholders.

## Next
**Phase 4 — Core CRUD vertical.**
- Build server-side data layer (`lib/data/clients`, `projects`, `tasks`, `task-templates`).
- Build server actions (`createClient`, `createProject`, `attachServicesToProject`, `generateTasksForProject`, `addTaskComment`, `updateTaskStatus`).
- Build the four list/detail screens with skeletons + empty states + filter bars.
- Wire audit/event logging on every mutation.
- Gate: full CRUD chain passes manually — create client → project → tasks generated → status change → comment with @mention → audit + ai_event rows present in DB.
