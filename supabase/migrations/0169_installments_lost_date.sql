-- 0169_installments_lost_date.sql
--
-- The sheet's Installments Tracker has a per-contract "lost date before
-- completing payments" (col R). When a client is lost before finishing their
-- installment plan, payments due on/after that date stop being expected. The
-- income engine (0168) needs this to trim overdue installments exactly the way
-- "CEO_Dashboared" does — without it our Sales overdue-installments over-counts
-- (validated: 13,840 vs sheet 18,840 for April; the gap is lost-client rows).
--
-- The sheet's R is per-contract; we store it on each installment row of that
-- contract so the engine can filter per payment with (lost_date is null or
-- lost_date >= month_start).

alter table public.installments
  add column if not exists lost_date date;
