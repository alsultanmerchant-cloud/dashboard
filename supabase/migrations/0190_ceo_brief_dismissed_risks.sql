-- =========================================================================
-- 0190 — CEO Brief dismissed risks.
--
-- The CEO brief risks (Q2 "where is the danger?") are computed deterministically
-- every generation from audited loaders. Until now the only feedback loop was
-- `ai_company_knowledge` (prose injected into the prompt) — which steers the AI
-- WORDING but cannot stop a code-computed risk from reappearing. So when the CEO
-- said "this isn't a problem, here's why", the alert kept coming back.
--
-- This table records that a specific risk was dismissed. The signal builder
-- (ceo-brief-signals.ts) filters against it on every generation:
--   • entity_id NULL  → suppress the whole risk KIND (e.g. delivery_slip)
--   • entity_id set   → suppress only that instance (e.g. one stuck project /
--                       one at-risk client), so a genuinely new entity of the
--                       same kind still surfaces.
-- Soft-deletable via is_active so a dismissal can be reversed later from settings.
-- =========================================================================

create table if not exists public.ceo_brief_dismissed_risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_id text not null,            -- the RiskKind (delivery_slip, stuck_project, …)
  entity_id text null,              -- project/client/employee/task/index key, or NULL = whole kind
  reason text null,                 -- why the CEO said it isn't a risk (provenance)
  dismissed_by uuid null references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ceo_brief_dismissed_risks_org_active_idx
  on public.ceo_brief_dismissed_risks (organization_id, is_active);

-- One active dismissal per (org, risk_id, entity_id). COALESCE so NULL entity
-- collapses to a single kind-level row instead of NULL-bypassing the unique idx.
create unique index if not exists ceo_brief_dismissed_risks_unique_active_idx
  on public.ceo_brief_dismissed_risks (organization_id, risk_id, coalesce(entity_id, ''))
  where is_active = true;

alter table public.ceo_brief_dismissed_risks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ceo_brief_dismissed_risks'
      and policyname = 'ceo_brief_dismissed_risks_select_org'
  ) then
    create policy "ceo_brief_dismissed_risks_select_org"
      on public.ceo_brief_dismissed_risks for select to authenticated
      using (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ceo_brief_dismissed_risks'
      and policyname = 'ceo_brief_dismissed_risks_insert_org'
  ) then
    create policy "ceo_brief_dismissed_risks_insert_org"
      on public.ceo_brief_dismissed_risks for insert to authenticated
      with check (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ceo_brief_dismissed_risks'
      and policyname = 'ceo_brief_dismissed_risks_update_org'
  ) then
    create policy "ceo_brief_dismissed_risks_update_org"
      on public.ceo_brief_dismissed_risks for update to authenticated
      using (public.has_org_access(organization_id))
      with check (public.has_org_access(organization_id));
  end if;
end $$;
