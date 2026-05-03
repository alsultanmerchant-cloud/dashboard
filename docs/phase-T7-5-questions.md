# Phase T7.5-finish — open questions for the owner

## Q1. Per-AM RLS scoping (DECIDED — needs owner confirmation)

The orchestrator dispatched **Option B** from `phase-T7-5-followups.md` §1:

- `contracts.account_manager_id` is the authority for per-AM visibility.
- Tightened SELECT policies (migration `0028_contracts_am_scoping.sql`):
  - `contracts_select` — visible if `target.view_all` OR `contract.manage` OR
    `account_manager_id = caller's employee_profile.id`.
  - `installments_select`, `monthly_cycles_select`, `contract_events_select` —
    same authority chain via `EXISTS (SELECT 1 FROM contracts c WHERE
    c.id = <table>.contract_id AND c.account_manager_id = …)`.
- Write policies (insert/update/delete) are NOT touched — they remain on
  `contract.manage` from `0026b`.
- No `FOR ALL` policies were introduced (Wave-2 trap avoided).
- Heads/CEO/admin keep org-wide visibility because they hold
  `target.view_all` and/or `contract.manage`.

**Owner please confirm**: this matches expectations? If you'd rather have
heads see only their department's AMs (Option A-ish), we'd need to add a
`clients.account_manager_employee_id` column or a per-employee
`department_id` join — flag and we'll dispatch a 0029 follow-up.

## Q2. Importer `--commit` scope

Only the **Clients Contracts** tab was wired in `scripts/import-acc-sheet.ts`
this round (the easiest one — it owns the natural key `(client_id, start_date)`
and creates clients/packages on-miss). The other 6 tabs are scaffolded with
`TODO(T7.5-followup-#2)` comments because verifying their exact column
headers requires reading the live `docs/data/acc-sheet.xlsx`, which the
sandbox where this agent ran could not load.

Recommended next step: a follow-up agent runs `bun scripts/import-acc-sheet.ts`
on a real machine, captures `tmp/acc-sheet-diff.csv`, then implements the
remaining tabs against the verified header names.

## Q3. Nav entry for `/am/[id]/dashboard`

Skipped — there is no good single-tenant URL to put in the sidebar (the
employee id is per-AM). Suggested follow-up: surface a link from each AM's
row inside `/organization/employees`, or add a quick "لوحتي" link in the
topbar avatar menu that resolves to `/am/${session.employeeId}/dashboard`
when the user holds `contract.view`. Out of scope for this dispatch.
