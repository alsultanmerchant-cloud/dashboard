-- Indicator chips (المؤشرات) now take part in the status-refresh reconciliation
-- like recommendations / risks / accountability rows do. An unjudgeable verdict
-- becomes an open question for the team, so `kind` must accept 'indicator' or
-- the insert fails the check constraint.
do $$
begin
  alter table public.satisfaction_questions
    drop constraint if exists satisfaction_questions_kind_check;
  alter table public.satisfaction_questions
    add constraint satisfaction_questions_kind_check
    check (kind = any (array['recommendation', 'risk', 'accountability', 'indicator']));
end $$;
