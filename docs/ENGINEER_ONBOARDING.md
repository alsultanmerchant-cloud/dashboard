# Engineer Onboarding — Sky Light Operating System

> **Read this first.** Everything else is a deep-dive linked from here. Total ramp time: ~30 min reading + 10 min connecting credentials.

---

## 1. What you're building (90 seconds)

A modern Arabic-first dashboard that **replaces a customized Odoo 17** for **Sky Light**, a Saudi marketing agency (codename Rwasem). Owner has reframed the product as a **"Service Delivery Operating System"** spanning 8 layers: Org → Sales → Delivery → Tasks → Permissions → Decisions → Governance → Escalation.

Phases 0–9 (foundation, auth, basic CRUD, handover, dashboard, AI assistant) are **already built**. We're now in the **Technical-First Track** — phases T0 → T10.

**Owner directive:** Technical first, Sales deferred, WhatsApp deferred, QC deferred.

---

## 2. The five docs you must read in order

| # | Doc | Purpose | Length |
|---|---|---|---|
| 1 | [`MASTER_PLAN.md`](MASTER_PLAN.md) | Strategic roadmap — vision, target, 8 layers, phase order, principles | 9 parts |
| 2 | [`ENGINEERING_PLAN.md`](ENGINEERING_PLAN.md) | Sprint-level execution — every T-phase with migrations, server actions, UI, tests, acceptance | ~T0–T10 |
| 3 | [`SPEC_FROM_OWNER.md`](SPEC_FROM_OWNER.md) | Owner-authored intent — governance, decisions, escalation. **Wins all conflicts.** | 22 sections |
| 4 | [`SPEC_FROM_PDF.md`](SPEC_FROM_PDF.md) | Trainee onboarding spec — 8 stages, roles, upload offsets | 14 sections |
| 5 | [`ODOO_AUDIT.md`](ODOO_AUDIT.md) | Live Odoo probe — what's used, what's dead, record counts | 7 sections |

Plus running log:
- [`DECISIONS_LOG.md`](DECISIONS_LOG.md) — every owner answer captured. Updated continuously. **Always check before guessing.**

Raw sources (don't read unless verifying):
- [`skylight-owner-system.md`](skylight-owner-system.md) — owner's raw doc
- [`skylight-operations-pdf.txt`](skylight-operations-pdf.txt) — extracted PDF text
- [`data/acc-sheet.xlsx`](data/acc-sheet.xlsx) — 5,000-row commercial Excel (drives T7.5)

---

## 3. Project rules (binding)

From [`/CLAUDE.md`](../CLAUDE.md):

- **Stack:** Next.js 16 App Router · React 19 · TypeScript · Bun · Tailwind 4 · shadcn (base-nova) · `@base-ui/react` · Tajawal font · Supabase Postgres 17 + Auth + RLS · Vercel AI SDK + Gemini.
- **Project ref:** `vghokairfpzxcciwpokp` (`Rawasm`). Single-tenant, slug `rawasm-demo`.
- **Owner login:** `alsultain@agency.com` / `alsultain22` (role=owner).
- **Arabic-only, RTL, mobile responsive.** Skeleton + empty + error states required on every page.
- **Every mutation:** zod validate → check user → check org scope → write `audit_log` if material → write `ai_event` if business-relevant.
- **Migrations:** SQL files in `supabase/migrations/`, applied via Management API (NOT the Supabase MCP — see below).
- **Never commit secrets.**

Engineering Definition-of-Done per phase (from [`ENGINEERING_PLAN.md`](ENGINEERING_PLAN.md) bottom):
1. Migration applied + types regenerated (`bun run gen:types`)
2. RLS policies + server-action gates in place
3. Skeleton + empty + error states on every new page
4. Mobile responsive at 375px
5. Arabic copy in `lib/copy.ts`
6. `audit_log` + `ai_event` on every mutation
7. ≥1 AI affordance using the new data
8. Phase report at `docs/phase-NN-report.md` with screenshots + smoke result
9. Behind a `feature_flags` row
10. PR includes a Playwright test exercising the new gate

---

## 4. Credentials & access

All real values are in `.env.local` (do not commit). Verified working as of 2026-05-02:

| What | How | Notes |
|---|---|---|
| **Supabase DB** | `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_ID` via `https://api.supabase.com/v1/projects/{ref}/database/query` | **Use the Management API. DO NOT use the Supabase MCP** (per project memory). |
| **Supabase service role** | `SUPABASE_SERVICE_ROLE_KEY` | For server-side migrations + admin scripts |
| **Live Odoo (read-only audit)** | `ODOO_URL=https://skylight.rwasem.com` · `ODOO_DB=skylight` · `ODOO_USERNAME=admin@rwasem.com` · `ODOO_PASSWORD=123456` | **READ-ONLY ONLY.** Use `src/lib/odoo/client.ts`. Never call `create`/`write`/`unlink`. |
| **Gemini AI** | `GEMINI_API_KEY` | For AI assistant + per-phase AI affordances |

Quick verifications:
```bash
# Supabase
set -a && source .env.local && set +a && \
curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) from public.tasks"}'

# Odoo (read-only)
set -a && source .env.local && set +a && bun -e '
import { odooFromEnv } from "./src/lib/odoo/client.ts";
const c = odooFromEnv();
console.log("count:", await c.executeKw("project.task","search_count",[[]]));
'
```

---

## 5. The current schema (already exists — don't rebuild)

26 tables in `public`. Highlights:
- **Identity:** `organizations · employee_profiles · roles · permissions · user_roles · role_permissions`
- **Org:** `departments`
- **Domain:** `clients · projects · project_members · project_services · services`
- **Tasks:** `tasks · task_assignees · task_comments · task_mentions · task_stage_history · task_templates · task_template_items`
- **Sales:** `sales_handover_forms` (handover engine already wired)
- **Cross-cutting:** `audit_logs · ai_events · notifications`
- **WhatsApp scaffold:** `whatsapp_groups · wa_outbox · wa_message_templates` (deferred but rails exist)

Generated TS types: `src/lib/supabase/types.ts`. Regenerate after every migration.

---

## 6. Phase order & dependencies (the dispatch graph)

```
T0  Foundation
       ↓
T1  Org Realignment       (seeds real Heads + Team Leads)
   ┌──────┼──────┐
   ↓      ↓      ↓
  T2     T3     T4   (parallel — Permissions / PDF gaps / Categories engine)
                ↓
              ┌─┴───────┐
              ↓         ↓
             T5       T7     (parallel — Decisions+SLA / Renewal cycles)
              ↓         ↓
             T6       T7.5   (Governance / Commercial layer — parallel)
                ↓
               T9    Reporting
                ↓
              T10    Cutover from Odoo

Deferred / parking lot:
  T8 (WhatsApp), S1–S5 (Sales engine), QC features
```

**Total estimate:** ~16–17 weeks for one engineer. With parallel agents, achievable in ~6–8 weeks if Waves 2 and 3 are dispatched simultaneously.

---

## 7. How to dispatch agents

See [`AGENT_DISPATCH.md`](AGENT_DISPATCH.md). Each phase has a **self-contained prompt** safe to hand to any agent that has read this onboarding doc + the five referenced specs.

**Rules for any phase agent:**
- Read [`MASTER_PLAN.md`](MASTER_PLAN.md), [`ENGINEERING_PLAN.md`](ENGINEERING_PLAN.md), [`SPEC_FROM_OWNER.md`](SPEC_FROM_OWNER.md), [`SPEC_FROM_PDF.md`](SPEC_FROM_PDF.md), [`DECISIONS_LOG.md`](DECISIONS_LOG.md) **before** writing code.
- Apply migrations via the Supabase Management API endpoint above (NOT the Supabase MCP).
- Touch Odoo **read-only** when you need reference data; use `src/lib/odoo/client.ts`.
- Stop and surface a question to a human if owner intent is unclear — do not invent.
- Write your phase report to `docs/phase-T{N}-report.md` when done.
- Open a single PR per phase (`feat(T{N}): ...`) with the migration file, code, tests, and the report.
