create table if not exists public.ai_insight_runs (
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

create index if not exists ai_insight_runs_org_created_idx
  on public.ai_insight_runs (organization_id, created_at desc);

create index if not exists ai_insight_runs_org_status_idx
  on public.ai_insight_runs (organization_id, status, completed_at desc);

create unique index if not exists ai_insight_runs_one_current_per_org_idx
  on public.ai_insight_runs (organization_id)
  where is_current = true;

alter table public.ai_insight_runs enable row level security;

create policy "ai_insight_runs_select_org"
on public.ai_insight_runs
for select
to authenticated
using (organization_id = public.current_org_id());

create policy "ai_insight_runs_insert_org"
on public.ai_insight_runs
for insert
to authenticated
with check (organization_id = public.current_org_id());

create policy "ai_insight_runs_update_org"
on public.ai_insight_runs
for update
to authenticated
using (organization_id = public.current_org_id())
with check (organization_id = public.current_org_id());
