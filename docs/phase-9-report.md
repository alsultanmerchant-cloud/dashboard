# Phase 9 — QA + advisors + README + handoff (report)

## Done

### QA scenarios (all green)

**Scenario A — Sales handover end-to-end via UI** (re-confirmed from Phase 5)
- Handover row written, status `accepted`, linked to new client + project.
- 15 tasks generated from templates.
- HANDOVER_SUBMITTED ai_event + notification + audit_log all present.

**Scenario B — Task comment + @mention** (re-confirmed from Phase 4)
- 1 `task_comment` with `@السلطان` body
- 1 `task_mention` row resolving to the matching `employee_profile`
- 1 notification routed to the recipient's `auth.users.id`
- `TASK_COMMENT_ADDED` and `MENTION_CREATED` ai_events present
- Owner bell badge incremented

**Scenario C — Overdue dashboard count**
- SQL: `update tasks set due_date = current_date - interval '3 days' where id = (select id from tasks where status='todo' limit 1)`
- Dashboard "مهام متأخرة" metric jumps from 0 → 1 with destructive tone + "تحتاج متابعة عاجلة" hint
- The same task now appears in the "مهام متأخرة" card list with cc-red border + cc-red due-date label

**Scenario D — RLS attack with rogue user**
1. Created `intruder@external.com` via the Auth admin API (no `employee_profiles` row, no `user_roles` row in our org).
2. Got an access_token via `/auth/v1/token?grant_type=password`.
3. Sent SELECT requests to `/rest/v1/clients`, `/rest/v1/tasks`, `/rest/v1/sales_handover_forms` with the rogue token.
4. **All returned `[]`** — RLS correctly blocks cross-org reads.
5. Sent INSERT to `/rest/v1/clients` with `organization_id` of our org. Postgres returned **`42501: new row violates row-level security policy for table "clients"`**.
6. Sent same SELECT as the real owner — got the expected 2 client rows.
7. Cleaned up: deleted the rogue user.

```bash
# Verify RLS isolation in 6 lines
ROGUE_TOKEN=$(curl -s -X POST "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"intruder@external.com","password":"intruder-pwd-1234"}' \
  | jq -r .access_token)
curl -s "$URL/rest/v1/clients?select=id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ROGUE_TOKEN"
# → []
```

**Scenario E — Audit log presence after critical actions**
6 distinct actions covering the full domain lifecycle:
- `client.create`
- `project.create`
- `task.status_change`
- `task.comment_add`
- `handover.submit`
- `employee.invite`

Each row carries `actor_user_id`, `entity_type`/`entity_id`, and `metadata` jsonb suitable for replay/debug.

### Security audit (manual)

| Check | Result |
|---|---|
| Tables with RLS disabled in `public` | **0** of 22 |
| Tables without any policies | **0** |
| Policies per table | 1–3 (most have 2: select + write) |
| Helper functions (`current_user_organization_ids`, `has_org_access`, `has_permission`) | All `SECURITY DEFINER` with `search_path=public` |
| Tables with no indexes | **0** — every table has FK indexes + status/date indexes where needed |

The Management API doesn't expose the advisors lints at `/v1/projects/{ref}/advisors` for this Supabase tier; the manual audit covered the same checks (RLS coverage, policy presence, function security mode, FK indexing).

### Documentation

- **`README.md`** at the repo root — full setup, env vars, file structure, scenarios, known limitations, recommended next phases, and useful commands. Includes the test owner credentials and the Supabase migration application snippet.
- **`docs/HANDOFF.md`** — single-page handoff doc with status table, DB state, security audit, scenario reproductions, and roadmap.
- **`docs/MVP_PLAN.md`** — 10-phase master plan with gates (already shipped, kept for reference).
- **`docs/phase-N-report.md`** for each of Phases 0–9 — what was done, what was verified, decisions logged, what's next.
- **`docs/design-system.md`** — token reference + rules.

## Decisions logged
- **Manual audit instead of MCP `get_advisors`** — the Supabase MCP we have access to is wired to a different project (we worked around this for migrations via the Management API SQL endpoint). Manual SQL audit covered the same checks reliably.
- **Final commit batches docs only** — Phase 9 is documentation + verification, no production code changes.
- **Test environment kept warm** — owner account stays active, seeded data left in place for the user to walk the scenarios manually.

## Next
The MVP is shippable. The roadmap below lives in `README.md` and `docs/HANDOFF.md`:
1. Multi-tenant UI (org switcher)
2. AI insights model wiring
3. Edit affordances + role-permission editing
4. Email/WhatsApp integrations
5. Realtime channels
6. HR / Finance / Sales CRM modules
7. Hardening (per-user supabase clients on writes)
