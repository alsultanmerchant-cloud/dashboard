-- =========================================================================
-- 0255 — Executive Report runs (مركز التقارير).
--
-- /reports composes a period-scoped executive report: deterministic facts
-- are computed in code from the verified loaders (indicators, scores,
-- contracts month block, team pulse, accountability, satisfaction,
-- renewals), then Gemini writes the Arabic analyst narrative around them —
-- it never invents a number. Each generation is frozen here (facts_json +
-- result_json) so the on-screen report and the printed report always show
-- the exact same numbers and prose, keyed by the report period.
--
-- Mirrors ceo_brief_runs (0171): admin-written, org-scoped read.
-- =========================================================================

create table if not exists public.executive_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid null references auth.users(id) on delete set null,
  range_from date not null,
  range_to date not null,
  preset text null,
  status text not null default 'running' check (status in ('running', 'ready', 'failed')),
  model text null,
  facts_json jsonb null,
  result_json jsonb null,
  error_message text null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists executive_report_runs_org_created_idx
  on public.executive_report_runs (organization_id, created_at desc);

create index if not exists executive_report_runs_org_range_idx
  on public.executive_report_runs (organization_id, range_from, range_to, completed_at desc);

-- One current run per (org, period) — regenerating replaces it.
create unique index if not exists executive_report_runs_one_current_idx
  on public.executive_report_runs (organization_id, range_from, range_to)
  where is_current = true;

alter table public.executive_report_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'executive_report_runs'
      and policyname = 'executive_report_runs_select_org'
  ) then
    create policy "executive_report_runs_select_org"
      on public.executive_report_runs for select to authenticated
      using (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'executive_report_runs'
      and policyname = 'executive_report_runs_insert_org'
  ) then
    create policy "executive_report_runs_insert_org"
      on public.executive_report_runs for insert to authenticated
      with check (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'executive_report_runs'
      and policyname = 'executive_report_runs_update_org'
  ) then
    create policy "executive_report_runs_update_org"
      on public.executive_report_runs for update to authenticated
      using (public.has_org_access(organization_id))
      with check (public.has_org_access(organization_id));
  end if;
end $$;
