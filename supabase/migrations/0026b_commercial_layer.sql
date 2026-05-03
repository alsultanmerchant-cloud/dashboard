-- =========================================================================
-- Migration 0026b — Commercial Layer (phase T7.5)
-- =========================================================================
-- Source: docs/data/acc-sheet.xlsx (~5,000 rows of live commercial data,
-- 7 tabs). This migration creates the schema. The bulk import is run via
-- scripts/import-acc-sheet.ts.
--
-- Tables (all per-organization, RLS-on):
--   services_catalog   — priced services (Monthly/OneTime/Quarterly).
--   contract_types     — New, Renew, Lost, Hold, UPSELL, Win-Back, Switch.
--   packages           — bundles of services_catalog rows.
--   contracts          — master commercial contracts.
--   installments       — per-contract payment plan (up to 5 by Excel sheet).
--   monthly_cycles     — per-contract monthly meeting / cycle tracker.
--                        NOTE: distinct from T7's renewal_cycles, which is
--                        per-PROJECT. They coexist on purpose.
--   am_targets         — per-AM monthly target + achieved.
--   contract_events    — replaces "Edits Updates log" tab.
--
-- RLS rule (Wave-2 lesson): every write policy that joins another
-- RLS-protected table is split INSERT/UPDATE/DELETE — never FOR ALL.
--
-- Permission seeds:
--   contract.view    — AM (own clients) + heads + CEO + admin
--   contract.manage  — AM (own clients) + AM head + admin
--   target.view_all  — heads + CEO + admin
-- =========================================================================

-- 0. ENUM-like check helpers (use TEXT + CHECK, matches house style) ------
-- (no domain types — keeps types.ts regen optional)

-- 1. services_catalog ------------------------------------------------------
create table if not exists public.services_catalog (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  name_ar         text not null,
  name_en         text,
  price           numeric(12,2) not null default 0,
  price_type      text not null default 'Monthly'
    check (price_type in ('Monthly','OneTime','Quarterly')),
  extra_days      integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists idx_services_catalog_org
  on public.services_catalog(organization_id);

-- 2. contract_types --------------------------------------------------------
create table if not exists public.contract_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  name_ar         text not null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists idx_contract_types_org
  on public.contract_types(organization_id);

-- 3. packages --------------------------------------------------------------
create table if not exists public.packages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  key                 text not null,
  name_ar             text not null,
  included_service_ids uuid[] not null default '{}',
  grace_days          integer not null default 0,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists idx_packages_org
  on public.packages(organization_id);

-- 4. contracts -------------------------------------------------------------
create table if not exists public.contracts (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  client_id                uuid not null references public.clients(id) on delete cascade,
  account_manager_id       uuid references public.employee_profiles(id) on delete set null,
  contract_type_id         uuid references public.contract_types(id) on delete set null,
  package_id               uuid references public.packages(id) on delete set null,
  project_id               uuid references public.projects(id) on delete set null,
  start_date               date not null,
  end_date                 date,
  duration_months          integer,
  total_value              numeric(12,2) not null default 0,
  paid_value               numeric(12,2) not null default 0,
  target                   text not null default 'On-Target'
    check (target in ('On-Target','Overdue','Lost','Renewed')),
  status                   text not null default 'active'
    check (status in ('active','hold','lost','closed','renewed')),
  total_days_computed      integer,
  external_source          text,
  external_id              text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (organization_id, client_id, start_date)
);

create index if not exists idx_contracts_org      on public.contracts(organization_id);
create index if not exists idx_contracts_client   on public.contracts(client_id);
create index if not exists idx_contracts_am       on public.contracts(account_manager_id);
create index if not exists idx_contracts_status   on public.contracts(status);
create index if not exists idx_contracts_target   on public.contracts(target);
create index if not exists idx_contracts_start    on public.contracts(start_date);

-- 5. installments ----------------------------------------------------------
create table if not exists public.installments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  sequence        integer not null,
  expected_date   date not null,
  expected_amount numeric(12,2) not null default 0,
  actual_date     date,
  actual_amount   numeric(12,2),
  status          text not null default 'pending'
    check (status in ('pending','received','partial','overdue','waived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (contract_id, sequence)
);

create index if not exists idx_installments_org      on public.installments(organization_id);
create index if not exists idx_installments_contract on public.installments(contract_id);
create index if not exists idx_installments_status   on public.installments(status);
create index if not exists idx_installments_expected on public.installments(expected_date);

-- 6. monthly_cycles --------------------------------------------------------
-- per-CONTRACT (NOT per-project — T7's renewal_cycles is per-project).
create table if not exists public.monthly_cycles (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  contract_id              uuid not null references public.contracts(id) on delete cascade,
  cycle_no                 integer not null,
  month                    date not null,
  state                    text not null default 'pending'
    check (state in ('pending','active','done','overdue','skipped')),
  start_date               date,
  grace_days               integer not null default 0,
  expected_meeting_date    date,
  actual_meeting_date      date,
  meeting_status           text
    check (meeting_status is null or meeting_status in ('on-time','late','missed')),
  meeting_delay_days       integer,
  expected_cycle_add_date  date,
  actual_cycle_add_date    date,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (contract_id, cycle_no)
);

create index if not exists idx_monthly_cycles_org      on public.monthly_cycles(organization_id);
create index if not exists idx_monthly_cycles_contract on public.monthly_cycles(contract_id);
create index if not exists idx_monthly_cycles_month    on public.monthly_cycles(month);

-- 7. am_targets ------------------------------------------------------------
create table if not exists public.am_targets (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  account_manager_id  uuid not null references public.employee_profiles(id) on delete cascade,
  month               date not null,
  expected_total      numeric(12,2) not null default 0,
  achieved_total      numeric(12,2) not null default 0,
  achievement_pct     numeric(6,2) not null default 0,
  breakdown_json      jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, account_manager_id, month)
);

create index if not exists idx_am_targets_org   on public.am_targets(organization_id);
create index if not exists idx_am_targets_am    on public.am_targets(account_manager_id);
create index if not exists idx_am_targets_month on public.am_targets(month);

-- 8. contract_events -------------------------------------------------------
create table if not exists public.contract_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  event_type      text not null,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid references public.employee_profiles(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_contract_events_org      on public.contract_events(organization_id);
create index if not exists idx_contract_events_contract on public.contract_events(contract_id);
create index if not exists idx_contract_events_type     on public.contract_events(event_type);
create index if not exists idx_contract_events_occurred on public.contract_events(occurred_at desc);

-- 9. updated_at triggers ---------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    foreach t in array array[
      'services_catalog','packages','contracts','installments',
      'monthly_cycles','am_targets'
    ] loop
      execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
      execute format(
        'create trigger trg_%1$s_updated_at before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
    end loop;
  end if;
end$$;

-- 10. RLS ON ---------------------------------------------------------------
alter table public.services_catalog enable row level security;
alter table public.contract_types   enable row level security;
alter table public.packages         enable row level security;
alter table public.contracts        enable row level security;
alter table public.installments     enable row level security;
alter table public.monthly_cycles   enable row level security;
alter table public.am_targets       enable row level security;
alter table public.contract_events  enable row level security;

-- 11. Permission seeds -----------------------------------------------------
-- contract.view, contract.manage, target.view_all
insert into public.permissions (key, description) values
  ('contract.view',  'عرض العقود التجارية ودورات المتابعة'),
  ('contract.manage','إدارة العقود التجارية: إنشاء، تعديل، تسجيل الأحداث'),
  ('target.view_all','عرض كل أهداف فريق إدارة الحسابات')
on conflict (key) do nothing;

-- Bind permissions to roles (single-tenant Rawasm).
-- contract.view  → admin, manager (heads/CEO via admin/manager), account_manager
-- contract.manage → admin, manager, account_manager
-- target.view_all → admin, manager
do $$
declare
  org_id uuid := '11111111-1111-1111-1111-111111111111';
  perm_view    uuid := (select id from public.permissions where key='contract.view');
  perm_manage  uuid := (select id from public.permissions where key='contract.manage');
  perm_targets uuid := (select id from public.permissions where key='target.view_all');
  r record;
begin
  for r in
    select id, key from public.roles where organization_id = org_id
  loop
    if r.key in ('owner','admin','manager','account_manager') then
      insert into public.role_permissions (role_id, permission_id)
        values (r.id, perm_view) on conflict do nothing;
    end if;
    if r.key in ('owner','admin','manager','account_manager') then
      insert into public.role_permissions (role_id, permission_id)
        values (r.id, perm_manage) on conflict do nothing;
    end if;
    if r.key in ('owner','admin','manager') then
      insert into public.role_permissions (role_id, permission_id)
        values (r.id, perm_targets) on conflict do nothing;
    end if;
  end loop;
end$$;

-- 12. RLS POLICIES ---------------------------------------------------------
-- Pattern: SELECT broad (contract.view); writes use contract.manage.
-- For child tables (installments, monthly_cycles, contract_events) we
-- split INSERT/UPDATE/DELETE since their USING joins contracts.

-- 12a. services_catalog (no parent join — FOR ALL safe but split anyway)
drop policy if exists services_catalog_select on public.services_catalog;
create policy services_catalog_select on public.services_catalog
  for select to authenticated
  using (public.has_permission(organization_id, 'contract.view'));

drop policy if exists services_catalog_insert on public.services_catalog;
create policy services_catalog_insert on public.services_catalog
  for insert to authenticated
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists services_catalog_update on public.services_catalog;
create policy services_catalog_update on public.services_catalog
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists services_catalog_delete on public.services_catalog;
create policy services_catalog_delete on public.services_catalog
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12b. contract_types
drop policy if exists contract_types_select on public.contract_types;
create policy contract_types_select on public.contract_types
  for select to authenticated
  using (public.has_permission(organization_id, 'contract.view'));

drop policy if exists contract_types_insert on public.contract_types;
create policy contract_types_insert on public.contract_types
  for insert to authenticated
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists contract_types_update on public.contract_types;
create policy contract_types_update on public.contract_types
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists contract_types_delete on public.contract_types;
create policy contract_types_delete on public.contract_types
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12c. packages
drop policy if exists packages_select on public.packages;
create policy packages_select on public.packages
  for select to authenticated
  using (public.has_permission(organization_id, 'contract.view'));

drop policy if exists packages_insert on public.packages;
create policy packages_insert on public.packages
  for insert to authenticated
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists packages_update on public.packages;
create policy packages_update on public.packages
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists packages_delete on public.packages;
create policy packages_delete on public.packages
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12d. contracts
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated
  using (public.has_permission(organization_id, 'contract.view'));

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts
  for insert to authenticated
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists contracts_delete on public.contracts;
create policy contracts_delete on public.contracts
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12e. installments — child of contracts; split writes
drop policy if exists installments_select on public.installments;
create policy installments_select on public.installments
  for select to authenticated
  using (
    public.has_permission(organization_id, 'contract.view')
    and exists (
      select 1 from public.contracts c
      where c.id = installments.contract_id
        and c.organization_id = installments.organization_id
    )
  );

drop policy if exists installments_insert on public.installments;
create policy installments_insert on public.installments
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'contract.manage')
    and exists (
      select 1 from public.contracts c
      where c.id = installments.contract_id
        and c.organization_id = installments.organization_id
    )
  );

drop policy if exists installments_update on public.installments;
create policy installments_update on public.installments
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists installments_delete on public.installments;
create policy installments_delete on public.installments
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12f. monthly_cycles — child of contracts; split writes
drop policy if exists monthly_cycles_select on public.monthly_cycles;
create policy monthly_cycles_select on public.monthly_cycles
  for select to authenticated
  using (
    public.has_permission(organization_id, 'contract.view')
    and exists (
      select 1 from public.contracts c
      where c.id = monthly_cycles.contract_id
        and c.organization_id = monthly_cycles.organization_id
    )
  );

drop policy if exists monthly_cycles_insert on public.monthly_cycles;
create policy monthly_cycles_insert on public.monthly_cycles
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'contract.manage')
    and exists (
      select 1 from public.contracts c
      where c.id = monthly_cycles.contract_id
        and c.organization_id = monthly_cycles.organization_id
    )
  );

drop policy if exists monthly_cycles_update on public.monthly_cycles;
create policy monthly_cycles_update on public.monthly_cycles
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists monthly_cycles_delete on public.monthly_cycles;
create policy monthly_cycles_delete on public.monthly_cycles
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12g. am_targets — gated by target.view_all for select; manage for writes
drop policy if exists am_targets_select on public.am_targets;
create policy am_targets_select on public.am_targets
  for select to authenticated
  using (
    public.has_permission(organization_id, 'target.view_all')
    or exists (
      select 1 from public.employee_profiles ep
      where ep.id = am_targets.account_manager_id
        and ep.user_id = auth.uid()
    )
  );

drop policy if exists am_targets_insert on public.am_targets;
create policy am_targets_insert on public.am_targets
  for insert to authenticated
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists am_targets_update on public.am_targets;
create policy am_targets_update on public.am_targets
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists am_targets_delete on public.am_targets;
create policy am_targets_delete on public.am_targets
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 12h. contract_events — child; split writes
drop policy if exists contract_events_select on public.contract_events;
create policy contract_events_select on public.contract_events
  for select to authenticated
  using (
    public.has_permission(organization_id, 'contract.view')
    and exists (
      select 1 from public.contracts c
      where c.id = contract_events.contract_id
        and c.organization_id = contract_events.organization_id
    )
  );

drop policy if exists contract_events_insert on public.contract_events;
create policy contract_events_insert on public.contract_events
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'contract.manage')
    and exists (
      select 1 from public.contracts c
      where c.id = contract_events.contract_id
        and c.organization_id = contract_events.organization_id
    )
  );

drop policy if exists contract_events_update on public.contract_events;
create policy contract_events_update on public.contract_events
  for update to authenticated
  using      (public.has_permission(organization_id, 'contract.manage'))
  with check (public.has_permission(organization_id, 'contract.manage'));

drop policy if exists contract_events_delete on public.contract_events;
create policy contract_events_delete on public.contract_events
  for delete to authenticated
  using (public.has_permission(organization_id, 'contract.manage'));

-- 13. Seed contract_types for Rawasm ---------------------------------------
do $$
declare org_id uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into public.contract_types (organization_id, key, name_ar, sort_order) values
    (org_id, 'New',      'جديد',          10),
    (org_id, 'Renew',    'تجديد',         20),
    (org_id, 'UPSELL',   'رفع باقة',      30),
    (org_id, 'WinBack',  'استرجاع عميل',  40),
    (org_id, 'Switch',   'تحويل خدمة',    50),
    (org_id, 'Hold',     'تعليق',         60),
    (org_id, 'Lost',     'مفقود',         70)
  on conflict (organization_id, key) do nothing;
end$$;

-- 14. feature_flag --------------------------------------------------------
insert into public.feature_flags (key, enabled, description) values
  ('commercial_layer', true, 'وحدة الطبقة التجارية: العقود، الدفعات، الأهداف الشهرية')
on conflict (key) do nothing;
