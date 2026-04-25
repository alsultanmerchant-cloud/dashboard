# Phase 2 — Auth & RBAC adaptation (report)

## Done
- Rewrote `src/lib/auth-context.tsx` to query the new schema:
  - `auth.users` → identity
  - `employee_profiles` (joined to `organizations`) → profile + org
  - `user_roles` → roles + nested permissions in one PostgREST query
- New `AuthUser` shape includes `employeeId`, `orgId`, `roleKeys`, `roleNames`, `permissions: Set<string>`, `isOwner`, plus profile fields (`departmentId`, `jobTitle`, `avatarUrl`).
- Backward-compat fields kept (`roleName`, `allowedPages`, `isSuperAdmin`) so legacy pages and the existing sidebar still mount without rewriting them now.
- Added `hasPermission(perm)` helper to the context (owner bypasses; others check the resolved Set).
- Trimmed sidebar `NAV_ITEMS` to the 5 routes that still exist (dashboard, agent, team, finance, users) and switched the visibility filter from slug-based `allowedPages.includes` to permission-keyed `isOwner || hasPermission(perm)`.
- Replaced sidebar imports of icons for deleted modules with the lean set we actually use.
- Trimmed `(dashboard)/layout.tsx` `PAGE_SLUG_MAP` to the same 5 routes.
- Stubbed `/api/users`, `/api/users/[id]`, `/api/roles`, `/api/roles/[id]` — they used to crash on the missing `user_profiles` table. Returns `200 []` for GET, `503` for write. Phase 7 replaces these with server actions.

## Verified (browser smoke)
- Hard reload of `/login` → fill `alsultain@agency.com` / `alsultain22` → submit.
- Redirect lands on `/dashboard`.
- Sidebar mounts with 5 nav items: نظرة عامة · المساعد الذكي · الفريق · المالية · إدارة المستخدمين.
- Org name "وكالة رواسم — العرض التجريبي" rendered from DB.
- User name "السلطان" + role "المالك" displayed in sidebar footer.
- Topbar live clock + time filters + refresh + notification bell + AI chat FAB all present.
- Dashboard page itself shows graceful "تعذر تحميل" with retry on the cards backed by missing legacy tables — Phase 6 rewires the dashboard for the new schema.
- Zero browser console errors.
- Zero compile errors.

## Decisions
- **Single-tenant UX, multi-tenant schema preserved.** Org switcher in the sidebar only renders if `orgs.length > 1`; for our seeded org it stays as a static badge. Schema still stores `organization_id` so multi-tenant is a future flip.
- **Permission-keyed nav** chosen over the legacy `allowedPages` slug list. Each nav item declares one `perm`. Owner bypasses. Phase 3 rebuilds nav config into the spec's groups; the filter logic stays.
- **Backward-compat fields** kept on `AuthUser` because rewriting the legacy dashboard / team / finance / users pages is out of scope for Phase 2. They're getting removed/rewritten in Phases 6–7 anyway.
- **API stubs over deletion** — kept the route shells so any code path still calling `/api/users` or `/api/roles` gets a well-formed empty response instead of throwing.

## Known broken (intentional, Phase-6/7)
- `/dashboard` page queries `deals/tickets/projects/kpi_snapshots` which don't exist → cards show "تعذر تحميل" with retry. Phase 6 rebuilds.
- `/team` queries `employees/deals/tickets` → similar empty/error state. Phase 7 rebuilds against `employee_profiles`.
- `/finance` queries `deals/renewals/monthly_expenses` → same. Phase 8 stubs as "Coming next phase".
- `/users` calls our stubs and shows an empty list. Phase 7 rebuilds with role assignment + invite flow.
- `/agent` chat works (Gemini key required) but its system prompt still references old tables. Phase 6 rewires.

## Next
**Phase 3 — Shell + sidebar groups + Cmd-K palette + real notification bell.**
- Replace flat nav with the spec's grouped sidebar (لوحة التحكم · المبيعات · العملاء والمشاريع · المنظمة · الإدارة · مراحل لاحقة).
- Mount `CommandPaletteProvider` globally; topbar shows the trigger.
- Notification bell reads from real `notifications` table (now populated by handover/task workflows in Phase 5).
- Mobile drawer behavior pass.
- Stub each new sidebar route with a `PageHeader` + "Coming next phase" placeholder so every link resolves.
