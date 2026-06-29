-- 0224 Accountability: 'new' (not-started) stage is NOT audited
-- =====================================================================
-- Team rule (already encoded for overdue in 0219): a task sitting in `new` past
-- its deadline is ORDINARY slip, not a distress signal — nobody is held
-- accountable for not having STARTED yet. 0223 still charged the specialist for
-- `new`-stage dwell/open tasks (template owner new→specialist), so غادة's
-- evidence surfaced not-started tasks as overdue.
--
-- Fix: `accountable_position_for_stage` returns NULL for stage='new', so the
-- ownership gate excludes it everywhere (open_tasks, overdue_owned, SLA/dwell
-- intervals, and the evidence drill-down — they all share this function).
-- =====================================================================
create or replace function public.accountable_position_for_stage(owners jsonb, stage text)
  returns text
  language sql
  immutable
as $$
  select case
    when stage = 'new' then null   -- not-started: ordinary to be late, not audited
    else (
      case
        coalesce(
          owners ->> stage,
          case stage
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
    )
  end
$$;

select public.refresh_accountability_scorecard();
