-- 0261: map the supporting-department review position to its real role.
--
-- Task templates store the selected position slug in stage_owner_positions.
-- `pos_aef8f95c1e15` is the catalog position "مدير القسم المساند", whose
-- structural role is `supporting_lead`. Migration 0223 originally hard-coded
-- that slug to `manager`, so accountability credited Manager Review intervals
-- to main/technical department managers (including people who do not own a
-- template review stage) and omitted the supporting-department managers who do.
--
-- Keep the function immutable and correct the only custom position slug used
-- by the current template owner maps. The final refresh rebuilds the cached
-- scorecard with the corrected ownership; reviewer-rigor queries are live and
-- pick up the function change immediately.

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
    when 'pos_aef8f95c1e15' then 'supporting_lead'
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
  'Template-driven stage ownership. Position slug pos_aef8f95c1e15 resolves to supporting_lead (0261); the new stage remains attributable to its template owner, else specialist (0258).';

select public.refresh_accountability_scorecard();
