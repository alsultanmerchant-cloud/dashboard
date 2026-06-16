-- 0184_backfill_contract_package_links.sql
-- Ensure imported sheet package text is mirrored into the structured package
-- pointers used by the contracts grid and duration engine.

insert into public.packages (organization_id, key, name_ar, active, grace_days)
select distinct
  c.organization_id,
  'promo_video',
  'فيديو برومو',
  true,
  5
from public.contracts c
where c.package_name is not null
  and exists (
    select 1
    from regexp_split_to_table(c.package_name, '\s*[,،]\s*') as s(raw)
    where btrim(s.raw) = 'فيديو برومو'
  )
on conflict (organization_id, key) do update
  set name_ar = excluded.name_ar,
      active = excluded.active,
      grace_days = excluded.grace_days;

with desired as (
  select
    c.id as contract_id,
    p.id as package_id
  from public.contracts c
  cross join lateral regexp_split_to_table(c.package_name, '\s*[,،]\s*')
    with ordinality as s(raw, ord)
  join public.packages p
    on p.organization_id = c.organization_id
   and p.name_ar = btrim(s.raw)
  where c.package_name is not null
    and btrim(s.raw) <> ''
    and btrim(s.raw) <> '#'
)
delete from public.contract_packages cp
using public.contracts c
where c.id = cp.contract_id
  and c.package_name is not null
  and not exists (
    select 1
      from desired d
     where d.contract_id = cp.contract_id
       and d.package_id = cp.package_id
  );

insert into public.contract_packages (contract_id, package_id, sort_order)
select
  c.id,
  p.id,
  (s.ord - 1)::smallint
from public.contracts c
cross join lateral regexp_split_to_table(c.package_name, '\s*[,،]\s*')
  with ordinality as s(raw, ord)
join public.packages p
  on p.organization_id = c.organization_id
 and p.name_ar = btrim(s.raw)
where c.package_name is not null
  and btrim(s.raw) <> ''
  and btrim(s.raw) <> '#'
on conflict (contract_id, package_id) do update
  set sort_order = excluded.sort_order;

update public.contracts c
   set package_id = cp.package_id
  from public.contract_packages cp
 where cp.contract_id = c.id
   and cp.sort_order = 0
   and (
     c.package_id is null
     or c.package_id is distinct from cp.package_id
   );
