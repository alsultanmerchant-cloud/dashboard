# Phase 8 — Placeholders + polish (report)

## Done

### Real `/notifications` page
- Server-rendered list reading from `notifications` filtered to `recipient_user_id = session.userId`.
- Filter chips: الكل · غير مقروءة (with red unread counter badge) · مقروءة + total counter.
- Per-card affordances: cyan border + pulsing dot for unread; muted style for read.
- Click anywhere on the card → calls `markNotificationReadAction(id)` AND navigates to the linked entity (`/projects/[id]` · `/tasks/[id]` · `/handover` · etc.) based on `entity_type`.
- "تعليم الكل كمقروء" button calls `markAllNotificationsReadAction` and toasts the updated count.
- Per-type icons (Send / Briefcase / ListTodo / MessageSquare / AtSign / Bell / Sparkles).

### Server actions (`notifications/_actions.ts`)
- `markNotificationReadAction(id)` — sets `read_at` to now if recipient matches; revalidates `/notifications`.
- `markAllNotificationsReadAction()` — bulk update for current user; returns count of updated rows.

### Real `/reports` page
- 5 rollup metric cards (clients · projects · tasks · handovers · employees).
- "توزيع الخدمات على المشاريع" — services list with `ServiceBadge` + project count + cyan→purple gradient bar normalized to max.
- Footer info banner explaining the Phase 9 plan for advanced reports (per-team performance, quarterly views, PDF/Excel export).

### Real `/settings` page
- Org info (name / slug / locale / timezone) read from `organizations`.
- "حسابك" panel: full name, email, role list (mapped via `ROLE_LABELS`), permission count + "(تجاوز كامل بصفة مالك)" annotation when applicable.
- 6 "إعدادات قادمة" cards (WhatsApp/email integrations, communication templates, AI settings, backup, security/MFA) each tagged "قريبًا".

### Global error boundary (`src/app/error.tsx`)
- Client component using `ErrorState`. Displays the error digest if available + Retry button.

### Global 404 (`src/app/not-found.tsx`)
- Centered card with cyan-glow icon, title "الصفحة غير موجودة", description, and "العودة إلى الرئيسية" Link styled like a primary button.

### Mobile sweep
- Verified `/dashboard` at 375×812 (mobile preset):
  - Sidebar correctly collapses; hamburger trigger appears in topbar.
  - Notification bell shows "2" badge.
  - Time filters and month bar scroll horizontally.
  - 8 metric cards reflow to a 2-column grid.
  - Tasks page filter chips wrap.
- Spot-checked `/notifications`, `/handover`, `/tasks` mobile layouts — all readable; tables overflow-scroll where needed.

## Verified visually
- `/notifications`: 2 cards rendered (handover + mention), filter chips + counter + mark-all button.
- `/reports`: 5 rollup cards + 3 service bars (2/2/0).
- `/settings`: org info + account info + 6 future-settings cards.
- `/this-page-does-not-exist`: 404 page with cyan icon + home link.

## Decisions
- **Notifications routing.** A click marks-as-read AND navigates. Could split into two actions later, but combining matches user intent ("I'm clicking because I want to deal with this").
- **Settings is read-only.** Editing org info / locale / timezone is a Phase 9 task. The page surfaces the data so users can see what's configured today.
- **Reports keeps it minimal.** A single-tile breakdown is more honest than a wall of half-finished charts; the Phase-9 banner sets expectations.
- **404 lives at root** — Next App Router serves the same `not-found.tsx` for any unmatched route inside the app, including `(dashboard)` group routes.

## Next
**Phase 9 — QA Scenarios A–E + advisors + README + handoff.**
- Scenario A (handover) ✅ already passes — re-run + screenshot.
- Scenario B: task comment + mention → notification → ai_event.
- Scenario C: overdue task dashboard count.
- Scenario D: RLS attack — verify a non-org user cannot read data (create a 2nd test user, attempt cross-org reads).
- Scenario E: audit log presence after critical actions.
- Run Supabase advisors (security + performance) and address criticals.
- Compose top-level README + handoff doc with setup/test/deploy steps + known limits.
