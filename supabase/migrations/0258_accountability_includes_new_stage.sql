-- 0258 — revert 0224: the `new` (not-started) stage IS audited
-- =========================================================================
-- Companion to 0257. 0257 fixed overdue *counting* (متأخرة); this fixes overdue
-- *attribution* (مراحل متأخرة, the case feed, the evidence drill-down).
--
-- 0224 made `accountable_position_for_stage()` return NULL for stage='new' on
-- the same rejected premise as 0219 — "nobody is held accountable for not
-- having STARTED yet". With that NULL, a late `new` task passes the ownership
-- gate for no one: it now counts in متأخرة (0257) but lands on no one's record.
-- The team's rule is the opposite — an un-started task past its deadline is the
-- clearest case of someone not picking work up, so it must be attributable.
--
-- Fix: `new` resolves like every other stage — the template's
-- `stage_owner_positions ->> 'new'` when set (11,181 tasks carry one; values
-- span account_manager/agent/manager/specialist/pos_aef8f95c1e15), else
-- 'specialist' as the default owner of not-started work. That default matches
-- the desk-ownership fallback already established in 0247, so owned_open and
-- the accountability gate finally agree instead of disagreeing by design.
--
-- Blast radius is bounded and deliberate:
--   • مراحل متأخرة / إجمالي المراحل (loadPeriodTrends) — deadline-based, so
--     `new` intervals add to BOTH numerator and denominator. Intended.
--   • الالتزام % (the `measured` CTE) — gated on `max_minutes is not null` and
--     there is NO sla_rules row for stage_key='new' (verified: 0 rows), so the
--     SLA sample is structurally untouched. No dilution.
--   • open_tasks / overdue_owned in the cached scorecard, the case feed, and
--     satisfaction-team stage ownership — all now see `new`. Intended.
--   • `effective_task_stage_owner` (0249) already short-circuits `new` to the
--     same coalesce, and 0247's owned_open coalesce becomes redundant but stays
--     correct. Neither needs changing.
--
-- 66 non-archived tasks are currently sitting in `new` past their deadline.
-- Idempotent (`create or replace`).
create or replace function public.accountable_position_for_stage(owners jsonb, stage text)
  returns text
  language sql
  immutable
as $$
  select case
    coalesce(
      owners ->> stage,
      case stage
        when 'new'               then 'specialist'
        when 'in_progress'       then 'agent'
        when 'specialist_review' then 'specialist'
        when 'client_changes'    then 'agent'
        when 'manager_review'    then 'manager'
        when 'ready_to_send'     then 'account_manager'
        when 'sent_to_client'    then 'account_manager'
        else null
      end
    )
    when 'pos_aef8f95c1e15' then 'manager'
    else coalesce(
      owners ->> stage,
      case stage
        when 'new'               then 'specialist'
        when 'in_progress'       then 'agent'
        when 'specialist_review' then 'specialist'
        when 'client_changes'    then 'agent'
        when 'manager_review'    then 'manager'
        when 'ready_to_send'     then 'account_manager'
        when 'sent_to_client'    then 'account_manager'
        else null
      end
    )
  end
$$;

comment on function public.accountable_position_for_stage(jsonb, text) is
  'Template-driven stage ownership (0223). The `new` stage resolves like any other — template owner, else ''specialist'' (0258 reverts 0224''s NULL, which left late not-started work unattributable).';

select public.refresh_accountability_scorecard();
