-- 0137_contract_packages_junction.sql
--
-- Multi-package support for contracts.
--
-- The team's sheet allows a single contract to bundle multiple services
-- (e.g. "حملات, سوشيال" or "موديريشن, حملات, سوشيال"). The current
-- contracts.package_id is one-to-one, so 30% of imported rows
-- (51 of 172) can't be linked. This migration adds:
--
--   contract_packages (contract_id, package_id, sort_order)
--
-- a thin junction so a contract can carry N packages while the existing
-- contracts.package_id stays as a "primary package" pointer for
-- backward-compatibility with the current UI/exports. The denormalized
-- text in contracts.package_name remains the display string used by the
-- importer / Odoo sync; the junction is the authoritative join.
--
-- Backfill: for every contract with a comma-joined package_name like
-- "حملات, سوشيال", split on commas, trim, and link each piece to its
-- packages.name_ar row. Single-package contracts also get a row in the
-- junction (mirrors their existing contracts.package_id) so consumers can
-- read multi-package state uniformly.

create table if not exists public.contract_packages (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  package_id      uuid not null references public.packages(id)  on delete restrict,
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now(),
  unique (contract_id, package_id)
);

create index if not exists contract_packages_contract_idx
  on public.contract_packages (contract_id, sort_order);
create index if not exists contract_packages_package_idx
  on public.contract_packages (package_id);

-- RLS: same scope rules as contracts (read = has_org_access on the
-- contract's org; write = contract.update permission).
alter table public.contract_packages enable row level security;

drop policy if exists contract_packages_select on public.contract_packages;
create policy contract_packages_select on public.contract_packages
  for select using (
    exists (
      select 1 from public.contracts c
      where c.id = contract_packages.contract_id
        and public.has_org_access(c.organization_id)
    )
  );

drop policy if exists contract_packages_insert on public.contract_packages;
create policy contract_packages_insert on public.contract_packages
  for insert with check (
    exists (
      select 1 from public.contracts c
      where c.id = contract_packages.contract_id
        and public.has_permission(c.organization_id, 'contract.update')
    )
  );

drop policy if exists contract_packages_update on public.contract_packages;
create policy contract_packages_update on public.contract_packages
  for update using (
    exists (
      select 1 from public.contracts c
      where c.id = contract_packages.contract_id
        and public.has_permission(c.organization_id, 'contract.update')
    )
  );

drop policy if exists contract_packages_delete on public.contract_packages;
create policy contract_packages_delete on public.contract_packages
  for delete using (
    exists (
      select 1 from public.contracts c
      where c.id = contract_packages.contract_id
        and public.has_permission(c.organization_id, 'contract.update')
    )
  );

-- Backfill from contracts.package_name. Splits on commas, trims, matches
-- each piece to packages.name_ar. Single-package contracts also land in
-- the junction so reads stay uniform. Idempotent on re-run thanks to the
-- unique (contract_id, package_id) constraint + on conflict do nothing.
insert into public.contract_packages (contract_id, package_id, sort_order)
select
  c.id,
  p.id,
  (s.ord - 1)::smallint
from public.contracts c
cross join lateral unnest(string_to_array(c.package_name, ',')) with ordinality as s(raw, ord)
join public.packages p
  on p.organization_id = c.organization_id
 and p.name_ar = btrim(s.raw)
where c.package_name is not null
  and btrim(s.raw) <> ''
on conflict (contract_id, package_id) do nothing;

-- Mirror the primary package_id back onto contracts for any row where the
-- single-package name resolves cleanly and package_id is still null. This
-- closes the gap left after migration 0136 for rows whose package_name was
-- not an exact name_ar match but where the first comma-split piece does
-- match (rare edge-case; defensive).
update public.contracts c
   set package_id = cp.package_id
  from public.contract_packages cp
 where cp.contract_id = c.id
   and cp.sort_order = 0
   and c.package_id is null;
