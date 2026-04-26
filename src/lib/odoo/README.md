# Odoo (Rwasem) ↔ Dashboard sync

The dashboard uses **Odoo as the canonical source of truth** for projects,
tasks, employees and clients (partners). This module is the read path —
a typed JSON-RPC client plus an idempotent importer that pulls Odoo
data into the existing Supabase schema.

## Files

- `client.ts` — minimal JSON-RPC client around `execute_kw`. Authenticates
  once, caches the uid, exposes `searchRead` and `read` shorthands.
- `types.ts` — Odoo record shapes (only the fields we read) plus the
  Odoo-stage-name → dashboard-stage-enum map.
- `importer.ts` — runs `employees → clients → projects → tasks` in order.
  Every upsert is keyed on `(organization_id, external_source='odoo', external_id)`.
- `../../scripts/sync-odoo.ts` — CLI entry, `bun run sync:odoo`.

## Configuration

Required env vars (see `.env.example`):

```
ODOO_URL=https://odoo.skylight.example
ODOO_DB=skylight
ODOO_USERNAME=sync@skylight.example
ODOO_PASSWORD=...           # API key from /odoo/my/security preferred
SUPABASE_SERVICE_ROLE_KEY=... # admin client uses this
```

## Running

```bash
bun run sync:odoo               # uses NEXT_PUBLIC_DEFAULT_ORG_SLUG
bun run sync:odoo other-org     # explicit org slug
```

The script is **safe to re-run** — every entity has a unique
`(org, external_source, external_id)` index added in migration
`0011_odoo_external_ref.sql`, so subsequent runs upsert in place.

## Stage mapping

The PDF guarantees these eight stage names live on `project.task.type`:

| Odoo stage name      | Dashboard `task_stage` |
|----------------------|------------------------|
| New                  | `new`                  |
| In Progress          | `in_progress`          |
| Manager Review       | `manager_review`       |
| Specialist Review    | `specialist_review`    |
| Ready to Send        | `ready_to_send`        |
| Sent to Client       | `sent_to_client`       |
| Client Changes       | `client_changes`       |
| Done                 | `done`                 |

Unknown stages fall back to `new` rather than failing the import.

## Custom Rwasem fields

These come from the `rwasem_project_task_progress` Odoo addon. They're
declared as optional in `types.ts` so the import still works against a
vanilla Odoo:

- `progress_percentage` → `tasks.progress_percent`
- `expected_progress`   → `tasks.expected_progress_percent`
- `progress_slip`       → `tasks.progress_slip_percent`

## Not yet covered

- Writeback (dashboard → Odoo). Will live in a small custom Odoo addon
  `mr_dashboard_sync` exposing `@http.route('/api/sync/...', type='json',
  auth='user')` so we go through Odoo's ORM for validations.
- Stage-history pull from `mail.message` / `eg_task_stage_duration`.
- Service / department mapping — Odoo has no first-class services model;
  these stay Supabase-canonical for now.
- Incremental sync. Today's importer pulls everything; add a
  `write_date >= last_sync_at` domain on the next iteration.
