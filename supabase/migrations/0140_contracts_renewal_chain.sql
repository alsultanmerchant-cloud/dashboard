-- 0140_contracts_renewal_chain.sql
--
-- Connect contracts into renewal chains.
--
-- The Skylight sheet kept one row per cycle but had no machine-readable
-- link from cycle N to cycle N-1 — the team eyeballed it from Client ID.
-- That made "what's this client's lifetime value" and "how many cycles
-- has this client renewed" impossible to query without a CTE.
--
-- We add contracts.previous_contract_id and backfill it by walking each
-- client's contracts in start_date order. Going forward, the new-contract
-- modal can set this explicitly when the type = Renewal; until then the
-- trigger auto-fills it on insert (the previous contract = the latest
-- contract for the same client that started before this one).
--
-- Also adds a tiny view contract_renewal_chains for the dashboard /
-- assistant to use without re-deriving every read.

alter table public.contracts
  add column if not exists previous_contract_id uuid
    references public.contracts(id) on delete set null;

create index if not exists contracts_previous_contract_idx
  on public.contracts (previous_contract_id);
create index if not exists contracts_client_start_idx
  on public.contracts (client_id, start_date desc);

-- Backfill: for every contract, link it to the most-recent earlier
-- contract for the same client. Postgres doesn't allow lateral subqueries
-- to reference the UPDATE target in the FROM clause, so we use a CTE that
-- pre-computes the (contract_id, previous_id) pairs and joins it in.
with prev_map as (
  select
    c.id as contract_id,
    (select p.id
       from public.contracts p
      where p.client_id = c.client_id
        and p.organization_id = c.organization_id
        and p.start_date < c.start_date
      order by p.start_date desc
      limit 1) as previous_id
  from public.contracts c
  where c.previous_contract_id is null
)
update public.contracts c
   set previous_contract_id = pm.previous_id
  from prev_map pm
 where pm.contract_id = c.id
   and pm.previous_id is not null;

-- Auto-link on insert: same algorithm as the backfill, runs only when the
-- caller didn't explicitly set previous_contract_id.
create or replace function public.contracts_autolink_previous()
returns trigger language plpgsql as $$
begin
  if NEW.previous_contract_id is null then
    select id into NEW.previous_contract_id
      from public.contracts
     where client_id = NEW.client_id
       and organization_id = NEW.organization_id
       and start_date < NEW.start_date
       and (NEW.id is null or id <> NEW.id)
     order by start_date desc
     limit 1;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_contracts_autolink_previous on public.contracts;
create trigger trg_contracts_autolink_previous
  before insert on public.contracts
  for each row execute function public.contracts_autolink_previous();

-- Read-side view: each row is a contract with its chain depth (1 = first
-- cycle for this client) and the root contract id (the very first cycle).
-- Useful for "show me this client's entire history" and "lifetime value".
create or replace view public.contract_renewal_chains as
with recursive chain as (
  -- Base: contracts that have no predecessor.
  select c.id, c.client_id, c.organization_id, c.id as root_id, 1 as chain_depth,
         c.start_date, c.total_value, c.paid_value
    from public.contracts c
   where c.previous_contract_id is null
  union all
  -- Recurse: each contract's depth = parent depth + 1.
  select c.id, c.client_id, c.organization_id, ch.root_id, ch.chain_depth + 1,
         c.start_date, c.total_value, c.paid_value
    from public.contracts c
    join chain ch on ch.id = c.previous_contract_id
)
select id, client_id, organization_id, root_id, chain_depth,
       start_date, total_value, paid_value
  from chain;

comment on view public.contract_renewal_chains is
  'Each contract with its chain depth and the root (first) contract for the same client.';

comment on column public.contracts.previous_contract_id is
  'Link to the prior cycle for the same client. Auto-set on insert by trigger; can be overridden.';
