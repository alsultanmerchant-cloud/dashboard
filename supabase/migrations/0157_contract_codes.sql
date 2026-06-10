-- 0157_contract_codes.sql
--
-- Human-readable incremental codes, matching how the team thinks in the
-- Skylight sheet (gap G10 in docs/CONTRACTS_GAP_ANALYSIS.md):
--
--   clients.client_code     → "C164"   (the sheet's Client ID, auto-increment)
--   contracts.contract_code → "C164-2" (client code + per-client sequence,
--                                        because duplicate sheet IDs = the
--                                        same client holding several contracts)
--
-- Counter pattern copied from 0050 (org_project_counters): atomic upsert
-- RETURNING, SECURITY DEFINER, BEFORE INSERT trigger that only fires when
-- the code is null. Backfill runs in start_date/created_at order so the
-- sequence matches the historical order the team knows.

-- 1) Columns -----------------------------------------------------------------

alter table public.clients
  add column if not exists client_code text,
  add column if not exists contract_seq integer not null default 0;

alter table public.contracts
  add column if not exists contract_code text;

-- 2) Backfill client_code from the sheet IDs already imported ---------------
-- external_id for sheet-imported clients is the raw "C164". Only copy values
-- that look like sheet codes; Odoo numeric ids stay out.

update public.clients c
   set client_code = upper(trim(external_id))
 where c.client_code is null
   and c.external_id ~* '^c[0-9]{1,5}$'
   -- Guard against duplicate sheet IDs (e.g. un-merged client copies): only
   -- the oldest row gets the code; the rest fall through to the counter.
   and not exists (
     select 1 from public.clients c2
      where c2.organization_id = c.organization_id
        and c2.id <> c.id
        and upper(trim(c2.external_id)) = upper(trim(c.external_id))
        and c2.created_at < c.created_at
   );

-- 3) Org-level client counter -------------------------------------------------

create table if not exists public.org_client_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_seq        integer not null default 0
);

alter table public.org_client_counters enable row level security;
-- Service-role / trigger access only; no user policies on purpose.

-- Seed each org's counter from the max numeric code already present.
insert into public.org_client_counters (organization_id, last_seq)
select c.organization_id,
       coalesce(max((regexp_match(c.client_code, '^C0*([0-9]+)$'))[1]::int), 0)
  from public.clients c
 where c.client_code is not null
 group by c.organization_id
on conflict (organization_id)
  do update set last_seq = greatest(org_client_counters.last_seq, excluded.last_seq);

create or replace function public._next_client_code(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  insert into public.org_client_counters as c (organization_id, last_seq)
  values (p_org, 1)
  on conflict (organization_id)
    do update set last_seq = c.last_seq + 1
  returning last_seq into v_seq;
  -- Pad to at least 2 digits like the sheet (C01 … C164). NB: lpad TRUNCATES
  -- strings longer than the target length, so the length must be dynamic.
  return 'C' || lpad(v_seq::text, greatest(length(v_seq::text), 2), '0');
end;
$$;

-- AFTER INSERT (not BEFORE): BEFORE INSERT triggers also fire on the insert
-- attempt of `insert … on conflict do update` (importer re-runs), consuming
-- counter numbers for rows that resolve to UPDATE. AFTER INSERT only fires
-- for genuinely new rows.
create or replace function public.clients_assign_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.client_code is null then
    update public.clients
       set client_code = public._next_client_code(NEW.organization_id)
     where id = NEW.id and client_code is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_clients_assign_code on public.clients;
create trigger trg_clients_assign_code
  after insert on public.clients
  for each row
  execute function public.clients_assign_code();

-- Backfill codes for existing clients that still have none (Odoo-imported or
-- dashboard-created), oldest first so numbering is stable.
do $$
declare
  r record;
begin
  for r in
    select id, organization_id
      from public.clients
     where client_code is null
     order by created_at, id
  loop
    update public.clients
       set client_code = public._next_client_code(r.organization_id)
     where id = r.id;
  end loop;
end $$;

create unique index if not exists clients_org_client_code_uniq
  on public.clients(organization_id, client_code)
  where client_code is not null;

-- 4) Per-client contract sequence → contract_code ----------------------------

create or replace function public._next_contract_code(p_client uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq  integer;
  v_code text;
begin
  update public.clients
     set contract_seq = contract_seq + 1
   where id = p_client
  returning contract_seq, client_code into v_seq, v_code;

  if v_code is null then
    -- Client predates the code system and the backfill somehow missed it:
    -- assign a client code first, then retry once.
    update public.clients
       set client_code = public._next_client_code(organization_id)
     where id = p_client
       and client_code is null;
    select client_code into v_code from public.clients where id = p_client;
  end if;

  return v_code || '-' || v_seq::text;
end;
$$;

create or replace function public.contracts_assign_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.contract_code is null then
    update public.contracts
       set contract_code = public._next_contract_code(NEW.client_id)
     where id = NEW.id and contract_code is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_contracts_assign_code on public.contracts;
create trigger trg_contracts_assign_code
  after insert on public.contracts
  for each row
  execute function public.contracts_assign_code();

-- Backfill existing contracts per client, ordered by start_date then
-- created_at (matches the sheet's historical order).
do $$
declare
  r record;
begin
  for r in
    select id, client_id
      from public.contracts
     where contract_code is null
     order by client_id, start_date nulls last, created_at, id
  loop
    update public.contracts
       set contract_code = public._next_contract_code(r.client_id)
     where id = r.id;
  end loop;
end $$;

create unique index if not exists contracts_org_contract_code_uniq
  on public.contracts(organization_id, contract_code)
  where contract_code is not null;

comment on column public.clients.client_code is
  'Sheet-style incremental client ID (C164). Auto-assigned on insert; backfilled from external_id.';
comment on column public.contracts.contract_code is
  'Human code: client_code + per-client sequence (C164-2). Auto-assigned on insert.';
