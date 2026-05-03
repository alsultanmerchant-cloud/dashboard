-- =========================================================================
-- Migration 0025 — Decisions + SLA + Escalation Engine (phase T5)
-- =========================================================================
-- Purpose: encode owner spec §12 (escalation paths), §13 (decision rights)
-- and SLA-as-control (§29) into data, plus the bookkeeping tables the
-- sla-watcher edge function needs (exceptions / escalations / business
-- hours / per-stage SLA rules).
--
-- Idempotent + additive. RLS gates use the 1-arg has_permission(text)
-- overload added in 0020a. All write policies are split per-command
-- (INSERT/UPDATE/DELETE) per the Wave-2 lessons in 0022b/0023b — no
-- FOR-ALL policies that re-open SELECT.
-- =========================================================================

-- 1. decision_rights -------------------------------------------------------
create table if not exists public.decision_rights (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision_key    text not null,
  owner_position  text not null,
  scope_note      text,
  created_at      timestamptz not null default now(),
  unique (organization_id, decision_key)
);

comment on table public.decision_rights is
  'Decision Rights Matrix (owner spec §13). Maps decision_key → the position that owns the call.';

create index if not exists idx_decision_rights_org
  on public.decision_rights(organization_id);

alter table public.decision_rights enable row level security;

drop policy if exists decision_rights_select on public.decision_rights;
create policy decision_rights_select
  on public.decision_rights for select to authenticated using (true);

drop policy if exists decision_rights_insert on public.decision_rights;
create policy decision_rights_insert
  on public.decision_rights for insert to authenticated
  with check ( public.has_permission('settings.manage') );

drop policy if exists decision_rights_update on public.decision_rights;
create policy decision_rights_update
  on public.decision_rights for update to authenticated
  using      ( public.has_permission('settings.manage') )
  with check ( public.has_permission('settings.manage') );

drop policy if exists decision_rights_delete on public.decision_rights;
create policy decision_rights_delete
  on public.decision_rights for delete to authenticated
  using ( public.has_permission('settings.manage') );

-- 2. escalation_paths ------------------------------------------------------
create table if not exists public.escalation_paths (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('operational','functional','client','critical')),
  from_position   text not null,
  to_position     text not null,
  sla_minutes     integer,
  created_at      timestamptz not null default now()
);

comment on table public.escalation_paths is
  'Escalation Model paths (owner spec §12). Closed list of 4 kinds; never-skip rule enforced in app code.';

create index if not exists idx_escalation_paths_org_kind
  on public.escalation_paths(organization_id, kind);

alter table public.escalation_paths enable row level security;

drop policy if exists escalation_paths_select on public.escalation_paths;
create policy escalation_paths_select
  on public.escalation_paths for select to authenticated using (true);

drop policy if exists escalation_paths_insert on public.escalation_paths;
create policy escalation_paths_insert
  on public.escalation_paths for insert to authenticated
  with check ( public.has_permission('settings.manage') );

drop policy if exists escalation_paths_update on public.escalation_paths;
create policy escalation_paths_update
  on public.escalation_paths for update to authenticated
  using      ( public.has_permission('settings.manage') )
  with check ( public.has_permission('settings.manage') );

drop policy if exists escalation_paths_delete on public.escalation_paths;
create policy escalation_paths_delete
  on public.escalation_paths for delete to authenticated
  using ( public.has_permission('settings.manage') );

-- 3. sla_rules -------------------------------------------------------------
create table if not exists public.sla_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  stage_key           text not null,
  max_minutes         integer not null,
  severity            text not null default 'high',
  business_hours_only boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organization_id, stage_key)
);

comment on table public.sla_rules is
  'Global per-stage SLA values (owner-confirmed 2026-05-02). Per-template overrides live on task_templates; per-task override on tasks.sla_override_minutes.';

create index if not exists idx_sla_rules_org
  on public.sla_rules(organization_id);

alter table public.sla_rules enable row level security;

drop policy if exists sla_rules_select on public.sla_rules;
create policy sla_rules_select
  on public.sla_rules for select to authenticated using (true);

drop policy if exists sla_rules_insert on public.sla_rules;
create policy sla_rules_insert
  on public.sla_rules for insert to authenticated
  with check ( public.has_permission('settings.manage') );

drop policy if exists sla_rules_update on public.sla_rules;
create policy sla_rules_update
  on public.sla_rules for update to authenticated
  using      ( public.has_permission('settings.manage') )
  with check ( public.has_permission('settings.manage') );

drop policy if exists sla_rules_delete on public.sla_rules;
create policy sla_rules_delete
  on public.sla_rules for delete to authenticated
  using ( public.has_permission('settings.manage') );

-- 4. business_hours --------------------------------------------------------
create table if not exists public.business_hours (
  weekday    integer primary key check (weekday between 0 and 6),
  open_time  time not null,
  close_time time not null,
  tz         text not null default 'Asia/Riyadh'
);

comment on table public.business_hours is
  'Working windows for SLA arithmetic. Owner-confirmed Sun(0)–Thu(4), 09:00–17:00 Asia/Riyadh. Fri(5)/Sat(6) deliberately absent = closed.';

alter table public.business_hours enable row level security;

drop policy if exists business_hours_select on public.business_hours;
create policy business_hours_select
  on public.business_hours for select to authenticated using (true);

drop policy if exists business_hours_insert on public.business_hours;
create policy business_hours_insert
  on public.business_hours for insert to authenticated
  with check ( public.has_permission('settings.manage') );

drop policy if exists business_hours_update on public.business_hours;
create policy business_hours_update
  on public.business_hours for update to authenticated
  using      ( public.has_permission('settings.manage') )
  with check ( public.has_permission('settings.manage') );

drop policy if exists business_hours_delete on public.business_hours;
create policy business_hours_delete
  on public.business_hours for delete to authenticated
  using ( public.has_permission('settings.manage') );

-- 5. tasks.sla_override_minutes -------------------------------------------
alter table public.tasks
  add column if not exists sla_override_minutes integer;

comment on column public.tasks.sla_override_minutes is
  'Optional manual per-task SLA override (minutes). Resolves above template + global rule.';

-- 6. exceptions ------------------------------------------------------------
create table if not exists public.exceptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id         uuid not null references public.tasks(id) on delete cascade,
  kind            text not null check (kind in ('client','deadline','quality','resource')),
  reason          text not null,
  opened_by       uuid references auth.users(id) on delete set null,
  opened_at       timestamptz not null default now(),
  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  -- Idempotency anchor for the SLA watcher: same (task_id, stage_entered_at)
  -- pair never opens two automatic deadline exceptions.
  stage_entered_at timestamptz
);

comment on table public.exceptions is
  '4-type exception model (owner spec §11/§26). Auto-opened by sla-watcher (kind=deadline) or manually via openException().';

create index if not exists idx_exceptions_task_open
  on public.exceptions(task_id) where resolved_at is null;
create index if not exists idx_exceptions_org
  on public.exceptions(organization_id);
create unique index if not exists uniq_exceptions_open_per_stage
  on public.exceptions(task_id, stage_entered_at)
  where kind = 'deadline' and resolved_at is null and stage_entered_at is not null;

alter table public.exceptions enable row level security;

drop policy if exists exceptions_select on public.exceptions;
create policy exceptions_select
  on public.exceptions for select to authenticated
  using (
    public.has_permission('escalation.view_all')
    or opened_by = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = exceptions.task_id
        and ( t.created_by = auth.uid()
              or exists (
                select 1 from public.task_assignees ta
                join public.employee_profiles ep on ep.id = ta.employee_id
                where ta.task_id = t.id and ep.user_id = auth.uid()
              )
              or exists (
                select 1 from public.task_followers tf
                where tf.task_id = t.id and tf.user_id = auth.uid()
              )
            )
    )
  );

drop policy if exists exceptions_insert on public.exceptions;
create policy exceptions_insert
  on public.exceptions for insert to authenticated
  with check ( public.has_permission('exception.open')
               or public.has_permission('escalation.view_all') );

drop policy if exists exceptions_update on public.exceptions;
create policy exceptions_update
  on public.exceptions for update to authenticated
  using      ( public.has_permission('escalation.view_all')
               or opened_by = auth.uid() )
  with check ( public.has_permission('escalation.view_all')
               or opened_by = auth.uid() );

drop policy if exists exceptions_delete on public.exceptions;
create policy exceptions_delete
  on public.exceptions for delete to authenticated
  using ( public.has_permission('escalation.view_all') );

-- 7. escalations -----------------------------------------------------------
create table if not exists public.escalations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  exception_id      uuid references public.exceptions(id) on delete set null,
  task_id           uuid not null references public.tasks(id) on delete cascade,
  level             integer not null default 1,
  raised_to_user_id uuid references auth.users(id) on delete set null,
  raised_at         timestamptz not null default now(),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid references auth.users(id) on delete set null,
  status            text not null default 'open' check (status in ('open','acknowledged','closed'))
);

comment on table public.escalations is
  'Escalation events raised against a task (with or without an exception). Acknowledged by the recipient.';

create index if not exists idx_escalations_task on public.escalations(task_id);
create index if not exists idx_escalations_recipient on public.escalations(raised_to_user_id, status);
create index if not exists idx_escalations_org on public.escalations(organization_id);

alter table public.escalations enable row level security;

drop policy if exists escalations_select on public.escalations;
create policy escalations_select
  on public.escalations for select to authenticated
  using (
    public.has_permission('escalation.view_all')
    or raised_to_user_id = auth.uid()
  );

drop policy if exists escalations_insert on public.escalations;
create policy escalations_insert
  on public.escalations for insert to authenticated
  with check ( public.has_permission('escalation.view_all') );

drop policy if exists escalations_update on public.escalations;
create policy escalations_update
  on public.escalations for update to authenticated
  using      ( public.has_permission('escalation.acknowledge')
               or raised_to_user_id = auth.uid() )
  with check ( public.has_permission('escalation.acknowledge')
               or raised_to_user_id = auth.uid() );

drop policy if exists escalations_delete on public.escalations;
create policy escalations_delete
  on public.escalations for delete to authenticated
  using ( public.has_permission('escalation.view_all') );

-- 8. business_minutes_between(start, end) ---------------------------------
-- Pure function. Returns the integer count of minutes that fall inside
-- the Sun–Thu 09:00–17:00 Asia/Riyadh business window between two UTC
-- timestamps. STABLE (not IMMUTABLE) because timezone arithmetic against
-- 'Asia/Riyadh' is timezone-data dependent. Must NOT read any tables so
-- it can be inlined safely in larger queries.
create or replace function public.business_minutes_between(p_start timestamptz, p_end timestamptz)
returns integer
language plpgsql
stable
as $$
declare
  v_start timestamptz := least(p_start, p_end);
  v_end   timestamptz := greatest(p_start, p_end);
  v_total integer := 0;
  v_day   date;
  v_dow   integer;
  v_open  timestamptz;
  v_close timestamptz;
  v_a     timestamptz;
  v_b     timestamptz;
begin
  if v_start is null or v_end is null or v_start >= v_end then
    return 0;
  end if;

  -- iterate by Riyadh-local day so weekday + open/close map cleanly
  v_day := (v_start at time zone 'Asia/Riyadh')::date;
  while v_day <= (v_end at time zone 'Asia/Riyadh')::date loop
    -- Postgres EXTRACT(DOW): 0=Sun, 1=Mon, ..., 6=Sat. Owner: Sun..Thu.
    v_dow := extract(dow from v_day)::int;
    if v_dow between 0 and 4 then
      v_open  := (v_day::timestamp + time '09:00') at time zone 'Asia/Riyadh';
      v_close := (v_day::timestamp + time '17:00') at time zone 'Asia/Riyadh';
      v_a := greatest(v_start, v_open);
      v_b := least(v_end,   v_close);
      if v_b > v_a then
        v_total := v_total + floor(extract(epoch from (v_b - v_a)) / 60.0)::int;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;

  return v_total;
end;
$$;

comment on function public.business_minutes_between is
  'Minutes inside Sun–Thu 09:00–17:00 Asia/Riyadh between two timestamps. STABLE; no table reads.';

-- 9. Permissions seed ------------------------------------------------------
insert into public.permissions (key, description) values
  ('escalation.view_own',
   'عرض التصعيدات والاستثناءات الموجَّهة إلى المستخدم'),
  ('escalation.view_all',
   'عرض كل التصعيدات والاستثناءات في المنظمة'),
  ('escalation.acknowledge',
   'الإقرار بتصعيد ومعالجته'),
  ('exception.open',
   'فتح استثناء يدوي على مهمة (Client/Deadline/Quality/Resource)')
on conflict (key) do nothing;

-- everyone (every role) gets escalation.view_own
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where p.key = 'escalation.view_own'
on conflict do nothing;

-- view_all + acknowledge → admin/manager/owner
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin','manager')
  and p.key in ('escalation.view_all','escalation.acknowledge')
on conflict do nothing;

-- exception.open → specialist+ (specialist, manager, admin, owner). The
-- 0009 catalog binds 'specialist' to a role family; we mirror that here.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin','manager','specialist')
  and p.key = 'exception.open'
on conflict do nothing;

-- 10. Seed reference data --------------------------------------------------
-- Seed per organization so future multi-tenant rollout still gets the
-- defaults, but in practice this fires only for `rawasm-demo`.
do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations loop
    -- decision_rights (6 rows from owner §13)
    insert into public.decision_rights (organization_id, decision_key, owner_position, scope_note) values
      (v_org, 'execute',            'agent',     'تنفيذ المهمة وفق المعايير المحدَّدة'),
      (v_org, 'distribute',         'team_lead', 'توزيع العمل وإعادة توازن الحمل'),
      (v_org, 'approve_quality',    'specialist','مراجعة الجودة وقرار القبول/الإرجاع'),
      (v_org, 'change_scope',       'head',      'تعديل نطاق العمل أو حذف/إضافة مهام'),
      (v_org, 'client_exception',   'head',      'التعامل مع الاستثناءات والتصعيدات الخاصة بالعميل'),
      (v_org, 'resource_priority',  'head',      'تعديل أولويات الموارد وإعادة الترتيب')
    on conflict (organization_id, decision_key) do nothing;

    -- escalation_paths (4 rows from owner §12)
    insert into public.escalation_paths (organization_id, kind, from_position, to_position, sla_minutes) values
      (v_org, 'operational', 'agent',         'team_lead', 60),
      (v_org, 'functional',  'team_lead',     'head',      120),
      (v_org, 'client',      'account_manager','head',     120),
      (v_org, 'critical',    'head',          'admin',     30);

    -- sla_rules (5 global stage rules)
    insert into public.sla_rules (organization_id, stage_key, max_minutes, severity, business_hours_only) values
      (v_org, 'manager_review',    30,  'high', true),
      (v_org, 'specialist_review', 30,  'high', true),
      (v_org, 'ready_to_send',     15,  'high', true),
      (v_org, 'sent_to_client',    240, 'high', true),
      (v_org, 'client_changes',    480, 'high', true)
    on conflict (organization_id, stage_key) do nothing;
  end loop;
end$$;

-- business_hours: Sun(0)..Thu(4), 09:00–17:00 Asia/Riyadh.  Idempotent.
insert into public.business_hours (weekday, open_time, close_time, tz) values
  (0, '09:00', '17:00', 'Asia/Riyadh'),
  (1, '09:00', '17:00', 'Asia/Riyadh'),
  (2, '09:00', '17:00', 'Asia/Riyadh'),
  (3, '09:00', '17:00', 'Asia/Riyadh'),
  (4, '09:00', '17:00', 'Asia/Riyadh')
on conflict (weekday) do nothing;
