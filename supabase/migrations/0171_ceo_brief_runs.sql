-- =========================================================================
-- 0171 — CEO Brief runs cache.
--
-- The dashboard "موجز المدير التنفيذي" card answers three questions for the
-- CEO: is the company improving or worsening, where is the danger, and what
-- to do. Deterministic facts (scores, deltas, risks) are computed in code;
-- Gemini only writes the Arabic narrative around them. Generation is cached
-- here (TTL + daily cron refresh) so the dashboard never blocks on Gemini.
--
-- Mirrors ai_insight_runs (0047): one current row per org, admin-written.
-- =========================================================================

create table if not exists public.ceo_brief_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid null references auth.users(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'ready', 'failed')),
  model text null,
  snapshot_text text null,
  result_json jsonb null,
  error_message text null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists ceo_brief_runs_org_created_idx
  on public.ceo_brief_runs (organization_id, created_at desc);

create index if not exists ceo_brief_runs_org_status_idx
  on public.ceo_brief_runs (organization_id, status, completed_at desc);

create unique index if not exists ceo_brief_runs_one_current_per_org_idx
  on public.ceo_brief_runs (organization_id)
  where is_current = true;

alter table public.ceo_brief_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ceo_brief_runs'
      and policyname = 'ceo_brief_runs_select_org'
  ) then
    create policy "ceo_brief_runs_select_org"
      on public.ceo_brief_runs for select to authenticated
      using (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ceo_brief_runs'
      and policyname = 'ceo_brief_runs_insert_org'
  ) then
    create policy "ceo_brief_runs_insert_org"
      on public.ceo_brief_runs for insert to authenticated
      with check (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ceo_brief_runs'
      and policyname = 'ceo_brief_runs_update_org'
  ) then
    create policy "ceo_brief_runs_update_org"
      on public.ceo_brief_runs for update to authenticated
      using (public.has_org_access(organization_id))
      with check (public.has_org_access(organization_id));
  end if;
end $$;
