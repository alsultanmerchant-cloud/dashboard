# Phase Operator-UX — off-plan UX pass (2026-05-04)

**Status:** ✅ shipped in commits `a718654` + `b678073` on `main`.

This wasn't on the engineering plan — it came out of an audit conversation
where the user asked whether the dashboard was ready for Sky Light operators
to actually use day-to-day. The audit (in conversation, not committed) found
that 5 of 7 roles landed on a CEO-style page that wasn't designed for them,
the sidebar had coming-soon noise, the role-permission editor was read-only,
and `/dashboard` was an 11-tile data dump. This phase fixes those.

## What shipped

### Role-based landing
- New helper `landingPathFor(session)` in `src/lib/auth-server.ts`.
- `/` (`src/app/page.tsx`) and `/auth/callback/route.ts` now route per role:
  - owner / admin / manager → `/dashboard`
  - account_manager → `/am/<employeeId>/dashboard` (was completely hidden — no nav entry)
  - specialist → `/uploads` (their PDF §11 upload-deadline queue)
  - team_lead / agent → `/tasks` (defaults to "مهامي")
- `src/app/login/page.tsx` now pushes `/` after sign-in instead of `/dashboard`.

### Sidebar trim (`src/lib/nav.ts`)
- New "لوحتي" item at slot #1 — links to `/`, resolves per role server-side.
- Hoisted "اليوم — رفع المهام" above "نظرة عامة".
- Dropped the "مراحل لاحقة" coming-soon group (HR / Finance / Sales-CRM).
- Dropped two coming-soon items in المبيعات (`/sales/leads`, `/sales/team`).
- Result: 7 groups, ~21 items (was 8 groups, ~25).

### Agent default queue (`src/app/(dashboard)/tasks/page.tsx`)
- Added "مهامي" filter chip (slot #1).
- When caller has an employee profile, default filter is "mine" (was "open").
- Powers the team_lead / agent landing.

### Working role-permission editor (`/organization/roles`)
- `_actions.ts`: `toggleRolePermissionAction` (perm-checked + audit-logged + org-scoped + owner-role-protected).
- `permission-toggle.tsx`: optimistic-toggle client component.
- Replaces the read-only matrix that said "للتعديل قريبًا".
- 259 toggleable cells (roles × permissions). Owner role renders as always-on but is non-interactive (the `isOwner` shortcut bypasses `role_permissions` entirely).

### CEO `/dashboard` redesign
- Collapsed 11 vanity tiles to **4 hero KPIs**: إيرادات الشهر · مهام متأخرة · مخالفات حوكمة · تجديدات الشهر.
- Kept the commercial mix card.
- 3 watch-lists in a grid: تصعيدات · مهام متأخرة · تسليمات (was a vertical stack of 2 cards).
- Activity feed at the bottom unchanged.
- Removed unused imports (`Briefcase`, `Inbox`, `Target`, `Bell`, `Users` from the page header — many are still used inside cards).

### Functional command palette (`src/components/command-palette.tsx`)
- Was a "coming soon" stub. Now searches every nav item the caller can see (perm-filtered), plus 4 quick-create actions: مشروع جديد · تسليم جديد · قالب مهمة · تصنيف خدمة.
- Keyboard nav (↑/↓/Enter/Esc), live filtering, grouped display.
- Shared open-state via a `command-palette:open` custom event so multiple triggers stay in sync.

### Topbar `+جديد` button
- New `QuickCreateTrigger` component — visible on desktop and mobile, opens the palette.
- The existing Cmd-K search trigger is preserved on desktop.

### `/contracts` "عقودي" filter
- New chip with `?am=me` sentinel that resolves to the caller's `employee_id` server-side.
- The DB-layer per-AM RLS in `0028` already restricts non-privileged callers; this exposes the toggle for heads/admins to switch between "all contracts" and "my book".

## Files written / edited

```
NEW:
  src/app/(dashboard)/organization/roles/_actions.ts
  src/app/(dashboard)/organization/roles/permission-toggle.tsx
  docs/phase-operator-ux-report.md

EDITED:
  src/app/page.tsx
  src/app/login/page.tsx
  src/app/auth/callback/route.ts
  src/app/(dashboard)/dashboard/page.tsx        (full rewrite)
  src/app/(dashboard)/organization/roles/page.tsx
  src/app/(dashboard)/tasks/page.tsx
  src/app/(dashboard)/contracts/page.tsx
  src/lib/auth-server.ts                        (added landingPathFor)
  src/lib/nav.ts
  src/components/layout/topbar.tsx
  src/components/command-palette.tsx            (full rewrite)
```

## What was deferred

- **T3.5 head per-employee filters**: genuinely its own phase (5 sub-filters
  + small schema add for forward-looking delays + recurring-without-deadline).
  Spec already at `docs/phase-T3.5-filters.md`.
- **Explicit role-aware sidebar reordering**: sidebar already permission-filters
  and `لوحتي` resolves per role — hard-coding role-specific orderings was
  judged over-engineering for a single-tenant UI.

## Lessons added to the road

1. **`preview_click` doesn't reliably trigger React `onClick` handlers** on
   button elements — synthetic mouse events from the test tool sometimes fail
   to dispatch through React's event system. Verify behavior via direct DOM
   `.click()` (`preview_eval`) or the actual browser, not via `preview_click`.
2. **HMR in Turbopack accumulates duplicate listeners** when components mount
   multiple times during fast refresh. Custom-event APIs (`window.dispatchEvent`
   + `window.addEventListener`) survive HMR cleanly; synthesized
   `KeyboardEvent` dispatches do not. Prefer custom events for cross-component
   open/close coordination.

## Verified

- Owner login → redirected to `/dashboard` (correct for their role)
- `/dashboard` renders 4 hero KPIs + commercial card + 3 watchlists + activity, no errors
- `/organization/roles` shows 259 interactive toggle cells
- `/tasks` shows "مهامي" as slot #1 filter
- `/contracts` shows "عقودي" chip with `?am=me`
- Command palette opens on direct dispatch and renders quick-create + nav items
- `bun run build` clean (35 routes); 11/11 tests pass
