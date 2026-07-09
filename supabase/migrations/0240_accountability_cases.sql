-- Accountability Cases persistence (Phase 2 of the Problems & Proof engine).
-- The /accountability case feed is computed LIVE each load; this table freezes
-- each person's case so history survives re-detection: first-seen date, a
-- repeat-offense counter, the manager's decision (status + note), and an
-- append-only event log. The live proof/ledger snapshot is stored too so a
-- resolved case still shows what it was built on.
--
-- One live case per (org, employee). status:
--   open          — detected, awaiting a manager decision (جديدة)
--   under_review  — a manager is looking into it (قيد المراجعة)
--   excused       — manager judged it justified (مبرَّرة)
--   warned        — action taken / employee warned (أُنذِر)
--   resolved      — no longer detected (انتهت)
-- is_current mirrors the latest detection: false = not in the newest live set.
-- Idempotent. RLS read via has_org_access; writes go through the service role
-- (server actions check people.analytics.view first), so no write policy.

create table if not exists public.accountability_cases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  employee_id      uuid not null references public.employee_profiles(id) on delete cascade,
  status           text not null default 'open',
  severity         text not null,
  streams          text[] not null default '{}',
  problem_tags     text[] not null default '{}',
  proof            jsonb not null default '[]'::jsonb,
  ledger           jsonb,
  client_names     text[] not null default '{}',
  is_current       boolean not null default true,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_seen_date   date not null default (now() at time zone 'Asia/Riyadh')::date,
  times_seen       int not null default 1,
  decided_by       uuid references public.employee_profiles(id),
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, employee_id)
);

create index if not exists accountability_cases_org_current_idx
  on public.accountability_cases (organization_id, is_current, severity);

alter table public.accountability_cases enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accountability_cases'
       and policyname = 'accountability_cases_read'
  ) then
    create policy accountability_cases_read on public.accountability_cases
      for select using (public.has_org_access(organization_id));
  end if;
end $$;

drop trigger if exists tg_accountability_cases_updated_at on public.accountability_cases;
create trigger tg_accountability_cases_updated_at
  before update on public.accountability_cases
  for each row execute function public.tg_set_updated_at();

-- Append-only event log: every detection-driven reopen and every manager
-- decision. Lets the person's file show "أُنذِر في … ثم تكرّرت".
create table if not exists public.accountability_case_events (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.accountability_cases(id) on delete cascade,
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  kind               text not null,            -- detected | reopened | status_change | resolved
  status             text,
  severity           text,
  note               text,
  actor_employee_id  uuid references public.employee_profiles(id),
  created_at         timestamptz not null default now()
);

create index if not exists accountability_case_events_case_idx
  on public.accountability_case_events (case_id, created_at desc);

alter table public.accountability_case_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accountability_case_events'
       and policyname = 'accountability_case_events_read'
  ) then
    create policy accountability_case_events_read on public.accountability_case_events
      for select using (public.has_org_access(organization_id));
  end if;
end $$;

-- Advice-on-demand cache (Phase 3). One row per (org, employee); invalidated by
-- a signature over the case facts + the org's taught-knowledge stamp.
create table if not exists public.accountability_advice_cache (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  employee_id      uuid not null references public.employee_profiles(id) on delete cascade,
  signature        text not null,
  result_json      jsonb not null,
  model            text,
  generated_at     timestamptz not null default now(),
  primary key (organization_id, employee_id)
);

alter table public.accountability_advice_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accountability_advice_cache'
       and policyname = 'accountability_advice_cache_read'
  ) then
    create policy accountability_advice_cache_read on public.accountability_advice_cache
      for select using (public.has_org_access(organization_id));
  end if;
end $$;
