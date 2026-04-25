# Phase 5 — Sales handover centerpiece (report)

## Done
- `HandoverSubmitSchema` in `src/lib/schemas.ts` — validates client info, services array, urgency, AM (all optional except client_name + at least one service).
- `submitHandoverAction` in `src/app/(dashboard)/handover/_actions.ts` orchestrates the full chain in one server call:
  1. Insert handover row first (status `submitted`) — leaves an audit trail even on partial failure.
  2. Look up an existing client by phone OR email; if none, create one (source `sales_handover`) + `CLIENT_CREATED` ai_event.
  3. Map urgency → project priority.
  4. Create project (auto-named `"<client> — <Arabic month + year>"`).
  5. Insert `project_services` rows + `PROJECT_SERVICE_ATTACHED` events.
  6. Add AM as `project_member` (role label "مدير الحساب").
  7. Run `generateTasksForProjectFromServices` (the same engine used in Phase 4).
  8. Update handover with `client_id` + `project_id` + status `accepted`.
  9. Resolve AM's `auth.users.id` and `createNotification("HANDOVER_SUBMITTED", …)`.
  10. `audit_logs` row `handover.submit` + `ai_events` row `HANDOVER_SUBMITTED` (importance bumps to `high` for urgency `critical`).
- `HandoverForm` client component with three logical cards:
  1. **بيانات العميل** — name (required), contact, phone, email
  2. **الخدمات المتفق عليها** — toggleable service tiles (custom multi-select with checks)
  3. **تفاصيل التسليم** — start date, AM (native `<select>`), urgency (4-tile chooser), package details, sales notes
- Bottom CTA bar with sparkle hint listing what happens on submit.
- `/handover` page renders the form + a "آخر التسليمات" feed below using `listHandovers` data helper. Each card shows client/status/urgency/services/AM/notes/timestamp + "عرض المشروع" link.

## Fixes shipped during integration
- **Removed lingering `<Button asChild render={<Link/>}>` patterns** in /tasks, /projects, /projects/[id], /task-templates pages. `@base-ui/react` Button doesn't accept `asChild`; the prop was leaking to the DOM and Base UI was complaining about non-button render nodes. Replaced with raw `<Link>` styled inline.
- **Replaced Base UI `Select` with native `<select>`** in the AM picker. Base UI Select stores its value internally and doesn't sync via standard DOM events, so it was both hard to drive in automation AND the React-controlled hidden input would lose the value on form re-render. Native select is uncontrolled, simple, and a11y-correct.
- **Relaxed `.uuid()` validation to `uuidLoose` regex.** Our seeded fixture UUIDs (e.g. `22222222-1111-1111-1111-000000000001`) don't have RFC-compliant variant nibbles (`8/9/a/b`). zod's strict `.uuid()` rejected them, blocking form submission entirely. The new `uuidLoose` regex accepts any 36-char hex+hyphen pattern; DB-level UUID type still enforces parseability.

## Verified — Scenario A end-to-end via the form

Filled "بيت الأناقة للأزياء" + 2 services + AM + urgency `high` + start `2026-05-01` → submitted via the actual UI form → server action ran cleanly. DB state after:

| Table | Row count delta | Detail |
|---|---|---|
| `sales_handover_forms` | +1 | status `accepted`, client_id + project_id linked back |
| `clients` | +1 | new client "بيت الأناقة للأزياء", source `sales_handover` |
| `projects` | +1 | auto-named "بيت الأناقة للأزياء — مايو ٢٠٢٦", priority `high` (mapped from urgency) |
| `project_services` | +2 | Social Media + SEO attached |
| `project_members` | +1 | AM السلطان added as "مدير الحساب" |
| `tasks` | +15 | 8 SMM template items + 7 SEO template items expanded |
| `notifications` | +1 | type `HANDOVER_SUBMITTED`, title `"تسليم جديد من المبيعات — بيت الأناقة للأزياء"`, body `"2 خدمة · 15 مهمة جاهزة"` |
| `audit_logs` | +1 | `handover.submit` action with metadata (services, tasks_generated, urgency) |
| `ai_events` | +21 | CLIENT_CREATED + PROJECT_CREATED + 2× PROJECT_SERVICE_ATTACHED + 15× TASK_CREATED + HANDOVER_SUBMITTED + NOTIFICATION_CREATED |

UI feedback:
- Sonner toast "تم إرسال التسليم — 15 مهمة تم توليدها" with description "تم إنشاء المشروع وتنبيه مدير الحساب"
- Form resets to clean state
- Handover appears immediately in the "آخر التسليمات" feed with `HandoverStatusBadge="مقبول"` and `UrgencyBadge="عالٍ"`
- Notification bell counter increments

## Decisions logged
- **Project name auto-generation** — `"<client> — <Arabic month + year>"` from `Intl.DateTimeFormat("ar-SA")`. Phase 6 may add a "rename" affordance once project edit lands.
- **Single transaction-ish chain** — each step is its own SQL call; we don't wrap in an explicit Postgres transaction. If a later step fails the handover row stays around in `submitted` state (vs `accepted`). Phase 9 hardening could wrap in a stored proc.
- **AM lookup uses `auth.users.id` for `recipient_user_id`** — this routes the bell badge correctly. If the AM doesn't have a linked auth user (e.g. profile imported without invite), only `recipient_employee_id` is set; UI still shows it via the employee_profiles join in `NotificationsLoader`.
- **`uuidLoose`** — relaxed UUID validation kept us shipping. We can tighten later if/when seeds get rewritten with RFC-compliant UUIDs.

## Next
**Phase 6 — Dashboard + AI insights.**
- Replace the dashboard placeholder with real metrics from `lib/data/dashboard.ts` (8 cards from spec).
- Recent handovers card · overdue tasks list · fused activity feed (audit + ai_events grouped by time).
- `/ai-insights` placeholder cards backed by `ai_events` aggregation.
- Rewire `/api/agent` system prompt + tools to introspect new schema (clients, projects, tasks, handovers, ai_events) instead of the old sales/deals/tickets.
- Gate: dashboard shows live numbers from current DB; AI assistant correctly answers "ما هي آخر التسليمات هذا الأسبوع؟"
