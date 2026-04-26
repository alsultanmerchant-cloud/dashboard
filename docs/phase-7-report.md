# Phase 7 — Organization (departments, employees, roles + invite flow) (report)

## Done
- Schemas: `DepartmentCreateSchema` + `EmployeeInviteSchema` (extends `lib/schemas.ts` with slug regex and email/role validation).
- Data layer: `lib/data/organization.ts` — `listRolesWithPermissions`, `listAllPermissions`, `listOrgRoleOptions`, `getEmployeeRoleAssignments`. Disambiguated `employee_profiles → departments` join in `lib/data/employees.ts` to use `employee_profiles_department_id_fkey` (PostgREST was confused by the back-reference `departments.head_employee_id`).
- Server actions:
  - `organization/departments/_actions.ts`: `createDepartmentAction` (zod-validated, audit + revalidate).
  - `organization/employees/_actions.ts`: `inviteEmployeeAction` — generates a 12-char `randomBytes(9).toString("base64url")` password → creates `auth.users` via `supabaseAdmin.auth.admin.createUser` (or reuses if email already exists) → upserts `employee_profiles` → upserts `user_roles` → audit + `EMPLOYEE_INVITED` ai_event → returns the password once for display.
- Pages:
  - `/organization/departments` — table with employee counts per department + `NewDepartmentDialog`.
  - `/organization/employees` — table with avatar + contact + assigned roles (Badge per role) + employment status. `InviteEmployeeDialog` opens the form, then on success a SECOND dialog reveals the generated credentials (email + password highlighted in cyan + copy button).
  - `/organization/roles` — full **8-role × 16-permission matrix** with sticky header + sticky leading column + per-role summary cards underneath (count of permissions, system-vs-custom badge).

## Verified — full invite chain via the UI
Test: invited "نورة المالكي" with email `nora.malki@agency.com`, department "إدارة الحسابات", role "مدير حساب".

| Check | Result |
|---|---|
| `auth.users` row created with `email_confirmed_at` set | ✅ |
| `employee_profiles` row created (department + job_title + active status) | ✅ |
| `user_roles` row links the new user to `account_manager` role | ✅ |
| `EMPLOYEE_INVITED` ai_event written | ✅ |
| Credentials dialog appears with the generated password "RS4Txi8UqgKp" + copy button | ✅ |
| **Nora appears in /handover AM picker** as "نورة المالكي — مدير حساب أول" | ✅ |
| Roles matrix page renders correctly: 8 columns × 16 rows + 8 summary cards | ✅ |

## Decisions
- **Password generation server-side, displayed once.** No password reset email yet — the admin physically copies the password from the modal and sends it to the new user via a secure channel. Phase 9 can wire in Supabase's invitation/password-reset email.
- **Admin SDK for user creation.** Uses `supabase.auth.admin.createUser({ email_confirm: true })` so the new user can log in immediately without an email verification roundtrip.
- **Single role per invite for MVP.** Multi-role assignment can be added by extending the form to a multi-select; the schema already supports many `user_roles` rows per (org, user).
- **Role × permission matrix is read-only.** Editing role permissions inline is a Phase 9 enhancement; for MVP the seeded roles cover the spec's 8 roles.
- **Used native `<select>`** (same pattern as the handover form) for department + role pickers — Base UI Select isn't drivable from automation and re-renders can clobber controlled hidden inputs.

## Fixes shipped during integration
- **PostgREST disambiguation.** `select: "*, department:departments(...)"` failed with `PGRST201` because of the circular FK between `employee_profiles.department_id → departments.id` and `departments.head_employee_id → employee_profiles.id`. Updated to `department:departments!employee_profiles_department_id_fkey(...)` to pin the join.
- **Schema revert recovery.** First Edit to `lib/schemas.ts` adding the new schemas was silently reverted (linter or watcher); reapplied successfully on the second pass.

## Next
**Phase 8 — Placeholders + polish.**
- `/notifications` page: real list with filters + mark-all-read action.
- Mobile sweep across all modules (verify drawers, table → card collapse, filter chips wrap).
- Global `error.tsx` + `not-found.tsx` boundaries.
- `/reports` and `/settings` with at least one functional tile each.
- Sweep stale `/sales`, `/hr`, `/finance` placeholder copy.
