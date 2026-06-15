-- Rich, per-source satisfaction analysis: typed indicator taxonomy, per-group
-- signal extraction, root-cause list, contract context snapshot, and the
-- rolled-up "big picture" account-health verdict. All nullable JSONB so older
-- rows and callers keep working (the app defaults them to empty on read).

alter table public.client_satisfaction_analyses
  add column if not exists indicators jsonb,
  add column if not exists client_group_signals jsonb,
  add column if not exists technical_group_signals jsonb,
  add column if not exists causes jsonb,
  add column if not exists contract_context jsonb,
  add column if not exists big_picture jsonb;

comment on column public.client_satisfaction_analyses.indicators is
  'Array of detected indicator objects {code,severity,source,evidence,date} from the fixed risk/operational taxonomy.';
comment on column public.client_satisfaction_analyses.client_group_signals is
  'Client group extraction: {requests{...}, approvals{...}, responseSpeed}.';
comment on column public.client_satisfaction_analyses.technical_group_signals is
  'Technical group extraction: {blockers[], delayCauses[{cause,attributedTo}], accountEvaluation[]}.';
comment on column public.client_satisfaction_analyses.causes is
  'Root-cause list: [{problem, rootCause, owner}] (أسباب المشاكل).';
comment on column public.client_satisfaction_analyses.contract_context is
  'Snapshot of the client contract status fed to the model {target,status,totalValue,paidValue,endDate}.';
comment on column public.client_satisfaction_analyses.big_picture is
  'Rolled-up account-health verdict {accountHealth, headline, relationshipScore, executionScore, commercialScore}.';
