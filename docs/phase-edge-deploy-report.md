# Wave 5a — Edge functions deployed + cron scheduled

**Date:** 2026-05-04 · **Project:** `vghokairfpzxcciwpokp` (rawasm-demo)

## What deployed

| Function | Status | verify_jwt | Cron (UTC) | Riyadh local | Cron name |
|---|---|---|---|---|---|
| `sla-watcher` | ACTIVE v1 | true | `*/5 * * * *` | every 5 min | `sla-watcher-5min` |
| `governance-watcher` | ACTIVE v1 | true | `0 3 * * *` | 06:00 daily | `governance-watcher-daily` |
| `renewal-scheduler` | ACTIVE v1 | true | `5 3 * * *` | 06:05 daily | `renewal-scheduler-daily` |
| `monthly-cycle-roller` | ACTIVE v1 | true | `0 3 1 * *` | 06:00 on the 1st | `monthly-cycle-roller` |

Riyadh has no DST → +03:00 fixed → UTC schedules above.

## Cron mechanism

`pg_cron` + `pg_net` in the Supabase project. `pg_net` was enabled fresh for this wave; `pg_cron` was already installed for the existing `rwasem_*` jobs.

Each cron row calls `net.http_post` with the service-role JWT inline in the `Authorization` header. `cron.job` is superuser-only so the embedded key has no broader exposure than DB superuser already grants.

Inspect / manage:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

To unschedule: `SELECT cron.unschedule('<jobname>');`

## Smoke results (manual invocation, 2026-05-04)

```
sla-watcher           → {"ok":true,"processed":30,"taskCount":30}
governance-watcher    → {"ok":true,"orgs":[{"orgId":"…","taskCount":30,"missingLogNote":30,"unownedTask":30}]}
renewal-scheduler     → {"processed":0,"nudged":0}
monthly-cycle-roller  → {"ok":true,"month":"2026-05-01","contracts":0,"processed":0,"skipped":0}
```

Notes:
- **governance-watcher inserted 60 violations** on first run — expected, since the seed dataset has 30 open tasks with neither recent comments nor assignees. The watcher is idempotent (per-task / per-kind dedupe), so re-runs won't multiply.
- **renewal-scheduler 0 nudged** — no projects have `next_renewal_date` within 14 days of 2026-05-04.
- **monthly-cycle-roller 0 contracts** — no contracts have `status='active'` yet (commercial layer was added in T7.5 but not seeded).

All four functions returned 200 with the expected shape. The reactive layer is now live.

## Not deployed

`wa-flush-outbox` exists in `supabase/functions/` but is parked under T8 (WhatsApp) and not part of Wave 5a.

## Followups

- When real contracts go to `status='active'`, monitor the next 1st-of-month roll and confirm `monthly_cycles` rows + AM notifications appear.
- If `cron.job_run_details` shows non-200 responses sustained for sla-watcher, the most likely cause is the function timing out when `tasks` grows; current timeout is 60s.
