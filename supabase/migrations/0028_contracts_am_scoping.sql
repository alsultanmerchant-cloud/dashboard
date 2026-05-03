-- =========================================================================
-- Migration 0028 — Contracts per-AM RLS scoping (phase T7.5-finish)
-- =========================================================================
-- Owner-decision: Option B from docs/phase-T7-5-followups.md §1.
--   contracts.account_manager_id is the authority for per-AM visibility.
--   Heads/CEO/admin keep org-wide visibility via target.view_all OR
--   contract.manage. Specialist AMs see only their own contracts.
--
-- Scope: SELECT policies only. INSERT/UPDATE/DELETE policies remain
-- unchanged (they already use contract.manage, which is gated by role).
--
-- Wave-2 lesson: child tables (installments, monthly_cycles,
-- contract_events) are tightened via EXISTS into contracts. Because the
-- contracts row itself is RLS-protected, the EXISTS only succeeds when
-- the caller can SEE that contract — giving us per-AM scoping for the
-- child rows for free, without a FOR-ALL recursion trap.
-- =========================================================================

-- 1. contracts: per-AM SELECT --------------------------------------------
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated
  using (
    public.has_permission('target.view_all')
    or public.has_permission('contract.manage')
    or account_manager_id = (
      select id from public.employee_profiles
      where user_id = auth.uid() limit 1
    )
  );

-- 2. installments: SELECT via EXISTS contracts ---------------------------
drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments
  for select to authenticated
  using (
    public.has_permission('target.view_all')
    or public.has_permission('contract.manage')
    or exists (
      select 1 from public.contracts c
      where c.id = installments.contract_id
        and c.account_manager_id = (
          select id from public.employee_profiles
          where user_id = auth.uid() limit 1
        )
    )
  );

-- 3. monthly_cycles: SELECT via EXISTS contracts -------------------------
drop policy if exists monthly_cycles_select on public.monthly_cycles;
create policy monthly_cycles_select on public.monthly_cycles
  for select to authenticated
  using (
    public.has_permission('target.view_all')
    or public.has_permission('contract.manage')
    or exists (
      select 1 from public.contracts c
      where c.id = monthly_cycles.contract_id
        and c.account_manager_id = (
          select id from public.employee_profiles
          where user_id = auth.uid() limit 1
        )
    )
  );

-- 4. contract_events: SELECT via EXISTS contracts ------------------------
drop policy if exists contract_events_select on public.contract_events;
create policy contract_events_select on public.contract_events
  for select to authenticated
  using (
    public.has_permission('target.view_all')
    or public.has_permission('contract.manage')
    or exists (
      select 1 from public.contracts c
      where c.id = contract_events.contract_id
        and c.account_manager_id = (
          select id from public.employee_profiles
          where user_id = auth.uid() limit 1
        )
    )
  );

-- NOTE: write policies (insert/update/delete) on contracts/installments/
-- monthly_cycles/contract_events are intentionally NOT touched — they
-- already use contract.manage and the split-write pattern from 0026b.
