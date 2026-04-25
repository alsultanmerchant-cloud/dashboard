# Phase 0 — Foundation reset (report)

## Done
- Wiped previous mr-dashboard scaffold.
- Forked `mahm0udsaad/sales-ar` into `mr-dashboard/`. Reset git history.
- Renamed package to `agency-command-center`.
- Restored our 6 schema migrations into `supabase/migrations/` (already applied to `vghokairfpzxcciwpokp`).
- Restored `.env.local` (real keys) and `.env.example` (placeholders).
- Restored generated TS types at `src/lib/supabase/types.ts` (38KB, matches our agency schema).
- Pruned dead modules from sales-ar that don't appear in MVP spec:
  `sales`, `sales-guide`, `weekly`, `renewals`, `satisfaction`, `support`, `development`, `partnerships`, `marketers`, `upload`.
- Pruned `/api/ai/*` (sales-specific endpoints).
- Kept (will be rewritten in later phases): `dashboard`, `agent`, `team`, `users`, `finance`, `/api/agent`, `/api/users`, `/api/roles`.

## Verified
- `bun install` → 669 packages, OK.
- `bun dev` → Next 16 ready in 2s on :3000.
- `GET /` → 307 redirect to `/login` (middleware works).
- `GET /login` → 200 with `lang="ar" dir="rtl"`, Arabic copy `البريد / كلمة المرور / تسجيل الدخول` rendered.
- Supabase Auth password grant for `alsultain@agency.com / alsultain22` → returns `access_token` (owner exists, password works).

## Known broken (intentional, Phase-2/Phase-6)
- `auth-context.tsx` queries `user_profiles` (table doesn't exist in new schema) — every authenticated page will fail until Phase 2 rewrites this against `employee_profiles + roles + user_roles`.
- `/api/users`, `/api/roles` reference `user_profiles` — same fate, Phase 2.
- `/api/agent` system prompt and tools reference old `deals/tickets/employees/projects/partnerships/kpi_snapshots/alerts/renewals/reviews` tables — Phase 6 rewrites for the new schema.
- `src/lib/demo-data.ts` and `src/lib/ai/{alerts,gemini,knowledge,prompts,scoring}.ts` reference old domain entities — pruned during Phase 6 rewrite.
- Sidebar nav references the deleted modules — Phase 3 replaces nav config.

## Next
**Phase 1 — Design system unification.** Document tokens, branded primitives, add domain components (PageHeader, StatCard, EmptyState, status-badge family, ServiceBadge, DataTableShell, FilterBar). Build `/dev/design-system` showcase as the gate.
