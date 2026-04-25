# Phase 1 — Design system unification (report)

## Done
- Documented existing tokens (`docs/design-system.md`) — colors, dim variants, radii, surface utilities, fonts.
- Added Arabic copy bank: `src/lib/copy.ts` (actions, states, forms, empty, errors, comingNext).
- Added enum → Arabic label maps: `src/lib/labels.ts` (task, priority, project, handover, urgency, client, employment, role, ai_event).
- Added domain components:
  - `src/components/page-header.tsx`
  - `src/components/section-title.tsx`
  - `src/components/metric-card.tsx` (renamed from stat-card to avoid clash with existing `ui/stat-card.tsx` interactive analytics tile)
  - `src/components/empty-state.tsx`
  - `src/components/error-state.tsx`
  - `src/components/skeletons.tsx` (`PageHeaderSkeleton`, `StatRowSkeleton`, `CardListSkeleton`, `TableSkeleton`)
  - `src/components/kbd.tsx`
  - `src/components/status-badges.tsx` (Task / Priority / Project / Handover / Client / Urgency / Employment / Service)
  - `src/components/filter-bar.tsx`
  - `src/components/data-table-shell.tsx` (RTL-aware table primitives)
  - `src/components/command-palette.tsx` (Cmd-K stub with global keyboard hook)
- Added Sonner Toaster to root layout (top-center, RTL, dark, Tajawal font).
- Updated middleware to allow `/dev/*` without auth.
- Built `/dev/design-system` showcase page covering: tokens, typography, radii, buttons, form controls, all status badges, metric cards, filter bar, loading/empty/error states, page-header & table skeletons, sample data table, card surfaces, dialog + dropdown + toast triggers, command palette, keyboard hints.
- Installed deps: `sonner` 2.0.7, `@tanstack/react-table` 8.21.3.

## Verified
- `bun dev` boots clean.
- `GET /dev/design-system` → 200, 111KB rendered HTML.
- All Arabic copy strings present.
- Zero compile warnings, zero browser console errors.
- Visual capture: header + breadcrumbs + actions; full color palette grid; typography scale; radii row; all 6 button variants × 5 sizes + loading + with-icon; form controls; 8 status-badge categories; 8 metric cards across 6 tones; filter bar; loading/empty/error trio; skeletons; data table with badges; 3 surface variants; overlay trigger row; keyboard hints. Confirmed RTL correct, cyan rim glows, color-coded dot prefixes on badges.

## Decisions
- **Renamed** my `StatCard` → `MetricCard` to avoid clash with the existing rich analytics `ui/StatCard`. Both coexist: `MetricCard` for dashboard headline tiles with optional href/trend; `ui/StatCard` for interactive KPI tiles with progress bars.
- **Kept** the existing `ui/skeleton.tsx` instead of duplicating; my `skeletons.tsx` provides composed loading patterns on top of it.
- **Sonner over toast primitives** — single dep, RTL via `dir="rtl"`, Tajawal applied via inline style on `toastOptions`.

## Next
**Phase 2 — Auth & RBAC adaptation.** Rewrite `src/lib/auth-context.tsx` against `employee_profiles + roles + permissions + user_roles`. Replace `allowedPages` with permission-keyed sidebar nav. Make `alsultain@agency.com` log in successfully and reach the dashboard. Repair `/api/users` and `/api/roles` to use the new schema (or delete and replace with server actions in Phase 7).
