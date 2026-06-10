-- 0159_contract_hold_flow.sql
--
-- Hold flow, dashboard-native (gap G2). In the sheet, switching Contract Type
-- to "Hold" snapshots the row via Apps Script and the team tracks the hold
-- end date by hand in notes. Team decision (June 2026):
--   • selecting Hold in the dashboard asks for a hold END DATE (popup),
--   • when ≤5 days remain (and while overdue), notify the account manager,
--     the owner(s), and dashboard users following the contract,
--   • the pre-hold type is remembered so lifting the hold can restore it.
--
-- Columns + daily cron here; the popup/snapshot/diff logic lives in the
-- server actions (src/app/(dashboard)/contracts/_actions.ts).

-- 1) Columns -------------------------------------------------------------------

alter table public.contracts
  add column if not exists hold_started_at        date,
  add column if not exists hold_end_date          date,
  add column if not exists type_before_hold_id    uuid references public.contract_types(id) on delete set null,
  add column if not exists last_hold_notification date;

create index if not exists idx_contracts_hold_active
  on public.contracts(organization_id, hold_end_date)
  where status = 'hold';

comment on column public.contracts.hold_end_date is
  'Agreed end of the hold period (asked by the popup when type → Hold). Drives the expiry notifications.';
comment on column public.contracts.type_before_hold_id is
  'Contract type before entering Hold; offered back when the hold is lifted (sheet''s *BeforeHold flags).';

-- 2) Daily notifier --------------------------------------------------------------
-- One notification per recipient per contract per day while:
--   status = 'hold' AND hold_end_date − today ≤ 5 (including overdue holds).
-- Recipients: the contract's AM + every user holding the owner role in the org.

create or replace function public.notify_hold_expiring_contracts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_inserted int := 0;
begin
  with expiring as (
    select ct.id, ct.organization_id, ct.account_manager_id,
           ct.hold_end_date, ct.contract_code,
           cl.name as client_name,
           (ct.hold_end_date - v_today) as days_left
      from public.contracts ct
      join public.clients cl on cl.id = ct.client_id
     where ct.status = 'hold'
       and ct.hold_end_date is not null
       and ct.hold_end_date - v_today <= 5
       and (ct.last_hold_notification is null or ct.last_hold_notification < v_today)
  ),
  recipients as (
    -- The contract's account manager.
    select e.id as contract_id, e.organization_id, e.contract_code,
           e.client_name, e.days_left,
           emp.user_id, emp.id as employee_id
      from expiring e
      join public.employee_profiles emp on emp.id = e.account_manager_id
     where emp.user_id is not null
    union
    -- Org owners.
    select e.id, e.organization_id, e.contract_code, e.client_name, e.days_left,
           ur.user_id, ep.id
      from expiring e
      join public.user_roles ur on ur.organization_id = e.organization_id
      join public.roles r on r.id = ur.role_id and r.key = 'owner'
      left join public.employee_profiles ep
        on ep.user_id = ur.user_id and ep.organization_id = e.organization_id
  ),
  inserted as (
    insert into public.notifications (
      organization_id, recipient_user_id, recipient_employee_id,
      type, title, body, entity_type, entity_id
    )
    select organization_id,
           user_id,
           employee_id,
           case when days_left < 0 then 'CONTRACT_HOLD_EXPIRED'
                else 'CONTRACT_HOLD_ENDING' end,
           coalesce(contract_code || ' — ', '') ||
           case when days_left < 0 then 'انتهت مدة الإيقاف'
                when days_left = 0 then 'الإيقاف ينتهي اليوم'
                else 'الإيقاف ينتهي خلال ' || days_left || ' يوم' end,
           'عقد العميل «' || coalesce(client_name, '—') || '» موقوف' ||
           case when days_left < 0
                then ' وتجاوز تاريخ نهاية الإيقاف منذ ' || abs(days_left) || ' يوم — يجب رفع الإيقاف أو التمديد.'
                else ' وينتهي الإيقاف بتاريخ مُتفق عليه قريب — راجعي العقد لاستئناف الخدمة.' end,
           'contract',
           contract_id
      from recipients
    returning 1
  )
  select count(*)::int into v_inserted from inserted;

  update public.contracts
     set last_hold_notification = v_today
   where status = 'hold'
     and hold_end_date is not null
     and hold_end_date - v_today <= 5
     and (last_hold_notification is null or last_hold_notification < v_today);

  return v_inserted;
end;
$$;

comment on function public.notify_hold_expiring_contracts() is
  'Daily: notifies the AM + org owners about contracts on hold whose hold_end_date is within 5 days (or already passed). Throttled by contracts.last_hold_notification.';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'notify-hold-expiring-daily') then
    perform cron.schedule(
      'notify-hold-expiring-daily',
      '10 6 * * *',
      $cron$ select public.notify_hold_expiring_contracts(); $cron$
    );
  end if;
end $$;
