# Phase 4 — Core CRUD vertical (report)

## Done

### Server-side foundation
- `src/lib/auth-server.ts` — `getServerSession` (cached), `requireSession`, `requirePermission`, `hasPermission`. Reads from `auth.users` + `employee_profiles` + `user_roles` + permissions.
- `src/lib/audit.ts` — `logAudit`, `logAiEvent`, `createNotification` (also writes a `NOTIFICATION_CREATED` ai_event automatically).
- `src/lib/schemas.ts` — Zod schemas for client/project/task forms.
- `src/lib/utils-format.ts` — Arabic date formatters (`formatArabicDate`, `formatArabicShortDate`, `formatArabicDateTime`, `relativeTimeAr`, `isOverdue`).
- Data layer:
  - `src/lib/data/clients.ts` — `listClients`, `getClient`
  - `src/lib/data/projects.ts` — `listProjects`, `getProject`, `getProjectTaskSummary`
  - `src/lib/data/tasks.ts` — `listTasks(filters)`, `getTask`, `listTaskComments` (joins author display name)
  - `src/lib/data/templates.ts` — `listTaskTemplates`, `getTaskTemplate`
  - `src/lib/data/employees.ts` — `listEmployees`, `listAccountManagers`, `listServices`, `listDepartments`
- Workflows:
  - `src/lib/workflows/generate-tasks.ts` — `generateTasksForProjectFromServices` (queries active templates, expands items, computes due_date from offset, inserts tasks, logs `TASK_CREATED` ai_events)
  - `src/lib/workflows/mentions.ts` — `extractMentions` (regex over `@` tokens) + `resolveMentions` (ILIKE prefix match against `employee_profiles.full_name`)
- Server actions:
  - `app/(dashboard)/clients/_actions.ts` — `createClientAction` (zod-validated, writes audit + `CLIENT_CREATED` ai_event, revalidatePath)
  - `app/(dashboard)/projects/_actions.ts` — `createProjectAction` (validates → inserts project → attaches services + `PROJECT_SERVICE_ATTACHED` events → adds AM as project_member → calls task generator → revalidates)
  - `app/(dashboard)/tasks/_actions.ts` — `updateTaskStatusAction` (audit + `TASK_STATUS_CHANGED`, sets `completed_at` for done) + `addTaskCommentAction` (parses @mentions → resolves to employees → inserts task_mentions + notifications + `MENTION_CREATED` ai_events + `TASK_COMMENT_ADDED` audit/event)

### UI pages
- `/clients` — server-rendered list with status/projects-count/contact columns. `NewClientDialog` (client) wired to action via `useActionState`.
- `/projects` — server-rendered list with services chips, AM, task count. `NewProjectDialog` with multi-select service toggles, AM picker, priority, dates, generate-tasks checkbox.
- `/projects/[id]` — detail with 4 metric cards (total/in-progress/done/pending), client card, timeline card, AM card, services row, team members grid, project tasks table.
- `/tasks` — list with status filter chips (all/open/overdue/done) and counter. Each row shows task, project + client, service badge, status, priority, due date with overdue highlight.
- `/tasks/[id]` — detail with `TaskStatusSelect` (live status change), 4 metric cards, service ribbon, comments thread with `@mention` highlight, `CommentComposer` (with ⌘+Enter shortcut, mention parsing).
- `/task-templates` — grid of seeded templates, each card linked to detail.
- `/task-templates/[id]` — full items table with role/department/offset/duration/priority columns.

## Verified

### UI smoke (browser)
- `/clients` empty state → "إضافة عميل" dialog opens → form fills → server action runs → row inserted in DB → toast "تم إنشاء العميل" → list refreshes (driven via the preview MCP).
- `/projects` page renders with the seeded clients dropdown.
- `/tasks` shows 15 tasks with correct service badges, status badges, priority badges, due dates, and filter chips.
- `/task-templates` shows all 3 seeded templates with item counts.
- Active sidebar item syncs on every navigation.
- Notification bell shows 1 unread (the @mention from the workflow run).
- Zero browser console errors.

### Data layer (Supabase via Management API)
End-to-end workflow validated at the DB level — counts after running the chain:
| Table | Count | What it proves |
|---|---|---|
| `clients` | 1 | UI client creation succeeded |
| `projects` | 1 | Project created |
| `project_services` | 2 | Services attached (Social Media + SEO) |
| `project_members` | 1 | Account manager added |
| `tasks` | **15** | Templates expanded (8 SMM + 7 SEO) with correct due-date offsets |
| `task_comments` | 1 | Comment with `@السلطان` body |
| `task_mentions` | 1 | Mention resolved to employee + user |
| `notifications` | 1 | Recipient gets the bell ping |
| `audit_logs` | 4 | client.create + project.create + task.status_change + task.comment_add |
| `ai_events` | **22** | CLIENT_CREATED + PROJECT_CREATED + 2× PROJECT_SERVICE_ATTACHED + 15× TASK_CREATED + TASK_STATUS_CHANGED + TASK_COMMENT_ADDED + MENTION_CREATED + NOTIFICATION_CREATED |

## Decisions
- **Server actions on the admin client.** All writes use `supabaseAdmin` (service role) inside server-only actions. RLS policies still enforce reads. This unblocks tight transactions without per-action client-side auth round-trips.
- **Mention parsing — Arabic-aware regex.** `/@([\p{L}\p{N}_]+)/gu` captures Unicode tokens. Resolution: `full_name ILIKE token%` first, fallback to `ILIKE %token%`. Works with single-token names like "السلطان" but will need refinement for multi-word names (e.g. "أحمد السيد").
- **Action state via `useActionState`.** Fields-level errors surface inline below the input; top-level errors via sonner toast.
- **`MetricCard` reused** in the project detail summary; consistent visual treatment with the dashboard.

## Known gaps (deliberate)
- Client/project/task detail pages don't yet support edit. Phase 5/7 will add inline edits where it matters most.
- `/tasks/[id]` mention rendering is currently a CSS highlight; clicking a `@mention` doesn't yet jump to the employee profile (Phase 7 once `/organization/employees/[id]` exists).
- Task assignment UI not yet built — `task_assignees` rows can be inserted via SQL or by Phase 5/7's flows. Generated tasks don't auto-assign (default_role_key is captured for use later).
- Filters on `/tasks` are deliberately simple (chips only). Multi-faceted filter bar (priority, project, assignee, search) is a small follow-up.
- The Phase 4 server actions write everything via the admin client; we should still add RLS-aware paths for extra defense in Phase 9 hardening.

## Next
**Phase 5 — Sales handover centerpiece.**
Build the `/handover` form + history list + `submitHandover` action that orchestrates the whole golden thread from a single click:
1. Validate input (client info, services, urgency, AM)
2. Upsert client
3. Create project
4. Attach services
5. Add AM as project member
6. Generate tasks via the existing workflow
7. Send notification to AM (`HANDOVER_SUBMITTED`)
8. Log audit + ai_event
**Gate:** Scenario A passes end-to-end through the UI form.
