-- Per-problem accountability workflow (extends the 0240 case store).
--
-- The /accountability case feed groups every one of a person's problems under a
-- single per-employee case, and 0240 froze STATUS + REOPEN at that per-employee
-- grain. The team's feedback: a manager decides on ONE problem at a time, and a
-- "عادت بعد إغلاقها" badge on the whole person can't say WHICH problem came back.
-- So this migration moves status + reopen down to the individual problem.
--
-- One row per (org, problem_key). problem_key is a deterministic identity for a
-- single problem inside a person's file (task problems key off the task, client
-- problems off the client + cited task, the operational signals are one per
-- person) — computed in code (accountability-cases.ts problemKeyFor) so it is
-- stable across re-detections and reopen tracking is meaningful.
--
-- status:
--   open          — detected, awaiting a manager decision (جديدة)
--   under_review  — a manager is looking into it (قيد المراجعة)
--   excused       — manager judged it justified (مبرَّرة)
--   warned        — action taken / employee warned (أُنذِر)
--   resolved      — no longer detected (انتهت)
-- is_current mirrors the latest detection: false = not in the newest live set.
-- Idempotent. RLS read via has_org_access; writes go through the service role
-- (server actions check people.analytics.view first), so no write policy.

create table if not exists public.accountability_problems (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  employee_id      uuid not null references public.employee_profiles(id) on delete cascade,
  problem_key      text not null,
  kind             text not null,             -- overdue_task | silent | complaint | churn | …
  stream           text not null,             -- execution | client | commercial
  status           text not null default 'open',
  severity         text,
  summary          text,                      -- snapshot of the proof line, for a resolved history readback
  task_code        text,
  client_id        text,                      -- canonical client id (text: proof.clientId is already text)
  href             text,
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
  unique (organization_id, problem_key)
);

create index if not exists accountability_problems_org_emp_idx
  on public.accountability_problems (organization_id, employee_id, is_current);
create index if not exists accountability_problems_org_current_idx
  on public.accountability_problems (organization_id, is_current, status);

alter table public.accountability_problems enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accountability_problems'
       and policyname = 'accountability_problems_read'
  ) then
    create policy accountability_problems_read on public.accountability_problems
      for select using (public.has_org_access(organization_id));
  end if;
end $$;

drop trigger if exists tg_accountability_problems_updated_at on public.accountability_problems;
create trigger tg_accountability_problems_updated_at
  before update on public.accountability_problems
  for each row execute function public.tg_set_updated_at();

-- Append-only event log: every detection-driven reopen and every manager
-- decision on a single problem. Lets a problem's history show "أُنذِر … ثم عادت".
create table if not exists public.accountability_problem_events (
  id                 uuid primary key default gen_random_uuid(),
  problem_id         uuid not null references public.accountability_problems(id) on delete cascade,
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  kind               text not null,            -- detected | reopened | status_change | resolved
  status             text,
  severity           text,
  note               text,
  actor_employee_id  uuid references public.employee_profiles(id),
  created_at         timestamptz not null default now()
);

create index if not exists accountability_problem_events_problem_idx
  on public.accountability_problem_events (problem_id, created_at desc);
create index if not exists accountability_problem_events_org_kind_idx
  on public.accountability_problem_events (organization_id, kind, created_at desc);

alter table public.accountability_problem_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accountability_problem_events'
       and policyname = 'accountability_problem_events_read'
  ) then
    create policy accountability_problem_events_read on public.accountability_problem_events
      for select using (public.has_org_access(organization_id));
  end if;
end $$;
