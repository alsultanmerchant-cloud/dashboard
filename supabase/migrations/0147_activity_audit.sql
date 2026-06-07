-- =========================================================================
-- Migration 0147 — Activity audit foundation (ownership episodes + SLAs)
-- =========================================================================
-- Phase 1 of the employee-activity / audit system (RAI model). Captures, per
-- stage occupancy, an "ownership episode": who OWNED the stage, when it opened,
-- when it was answered (stage advanced / approved), and against which SLA.
-- Scoring + CEO board come in Phase 2; this migration only accrues clean data.
--
-- Key design points (grounded in the codebase):
--   * Owner per stage comes from tasks.stage_owner_positions (0077) -> role slug
--     -> task_assignees.role_type. Source of truth is the per-task JSONB.
--   * SLA per stage resolves: tasks.stage_sla_overrides[stage] (per-task, set in
--     the template) -> sla_rules[stage] (org default) -> NULL (N/A, not scored).
--   * Working time excludes off-hours + Fri/Sat + holidays via a new
--     working_minutes_between() composing is_working_day() (0055).
--   * external_origin = episodes opened before activity_config.cutover (Odoo /
--     pre-instrumentation history) are excluded from scoring (shown N/A, never 0).
-- =========================================================================

-- 1. Working-minutes (holiday-aware) ---------------------------------------
-- Mirrors business_minutes_between (0025) but swaps the hardcoded Sun–Thu check
-- for is_working_day(org, day) so org holidays are excluded too.
create or replace function public.working_minutes_between(
  p_org uuid, p_start timestamptz, p_end timestamptz
) returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz := least(p_start, p_end);
  v_end   timestamptz := greatest(p_start, p_end);
  v_total integer := 0;
  v_day   date;
  v_open  timestamptz;
  v_close timestamptz;
  v_a     timestamptz;
  v_b     timestamptz;
begin
  if v_start is null or v_end is null or v_start >= v_end then
    return 0;
  end if;

  v_day := (v_start at time zone 'Asia/Riyadh')::date;
  while v_day <= (v_end at time zone 'Asia/Riyadh')::date loop
    if public.is_working_day(p_org, v_day) then
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

comment on function public.working_minutes_between(uuid, timestamptz, timestamptz) is
  'Working minutes (Sun–Thu 09:00–17:00 Asia/Riyadh, minus org holidays) between two timestamps. Holiday-aware variant of business_minutes_between.';

-- 2. Org default SLAs — set to the agency-confirmed values ------------------
-- New / In Progress / Done have NO org default (they are per-task via
-- stage_sla_overrides). Existing 0025 seed had different values; upsert ours.
do $$
declare v_org uuid;
begin
  for v_org in select id from public.organizations loop
    insert into public.sla_rules (organization_id, stage_key, max_minutes, severity, business_hours_only) values
      (v_org, 'manager_review',    90,  'high', true),
      (v_org, 'specialist_review', 90,  'high', true),
      (v_org, 'ready_to_send',     60,  'high', true),
      (v_org, 'sent_to_client',    240, 'high', true),
      (v_org, 'client_changes',    480, 'high', true)
    on conflict (organization_id, stage_key) do update
      set max_minutes = excluded.max_minutes;
  end loop;
end$$;

-- 3. Per-stage SLA overrides (per template item + copied to each task) ------
-- Shape: { stage_key: minutes(int) | null }. New/In Progress live here.
alter table public.task_template_items
  add column if not exists stage_sla_overrides jsonb;
alter table public.tasks
  add column if not exists stage_sla_overrides jsonb;

comment on column public.task_template_items.stage_sla_overrides is
  'Per-stage SLA in working minutes for tasks generated from this item. {stage: minutes|null}. Overrides org sla_rules. New/In Progress are set here per task.';

-- 4. Activity config (cutover date for forward-capture honesty) -------------
create table if not exists public.activity_config (
  organization_id            uuid primary key references public.organizations(id) on delete cascade,
  instrumentation_cutover_date date not null default current_date,
  window_working_days        int not null default 7,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

insert into public.activity_config (organization_id)
  select id from public.organizations
  on conflict (organization_id) do nothing;

alter table public.activity_config enable row level security;
drop policy if exists activity_config_select on public.activity_config;
create policy activity_config_select on public.activity_config
  for select to authenticated using (public.has_org_access(organization_id));
drop policy if exists activity_config_write on public.activity_config;
create policy activity_config_write on public.activity_config
  for all to authenticated
  using      (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

-- 5. Ownership episodes -----------------------------------------------------
create table if not exists public.ownership_episodes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  task_id             uuid not null references public.tasks(id) on delete cascade,
  stage               public.task_stage not null,
  owner_role          text,                 -- role slug resolved from stage_owner_positions
  owner_employee_id   uuid references public.employee_profiles(id) on delete set null,
  opened_at           timestamptz not null,
  answered_at         timestamptz,
  answered_kind       text,                 -- stage_advance | approval | comment | upload | timesheet
  answered_by_employee_id uuid references public.employee_profiles(id) on delete set null,
  response_minutes    integer,              -- working minutes opened->answered
  sla_minutes         integer,              -- snapshot at open; null => not scored on responsiveness
  within_sla          boolean,
  closed_at           timestamptz,
  source              text not null default 'stage',  -- stage | handoff_mention
  external_origin     boolean not null default false, -- pre-cutover/Odoo => excluded from scoring
  created_at          timestamptz not null default now()
);

comment on table public.ownership_episodes is
  'One row per stage-occupancy: who owned the stage, when answered, against which SLA. Atomic unit for the activity/audit score. Populated by triggers; never written from app code.';

create index if not exists idx_ownership_episodes_owner on public.ownership_episodes(organization_id, owner_employee_id, opened_at desc);
create index if not exists idx_ownership_episodes_task  on public.ownership_episodes(task_id);
create index if not exists idx_ownership_episodes_open  on public.ownership_episodes(task_id) where closed_at is null;

alter table public.ownership_episodes enable row level security;
drop policy if exists ownership_episodes_select on public.ownership_episodes;
create policy ownership_episodes_select on public.ownership_episodes
  for select to authenticated using (public.has_org_access(organization_id));
-- No write policy: only the security-definer triggers below write here.

-- 6. Open/close trigger on task_stage_history -------------------------------
create or replace function public.tg_ownership_episode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_role text;
  v_owner_emp  uuid;
  v_sla        integer;
  v_cutover    date;
  v_resp       integer;
begin
  -- (a) Close the currently-open episode for this task (prior stage ended).
  --     If it was never answered, treat the advance itself as the answer
  --     (stage_advance) so Responsiveness is computable; Phase 2 backfills the
  --     actual actor from audit_logs.
  update public.ownership_episodes e
     set closed_at = NEW.entered_at,
         answered_at = coalesce(e.answered_at, NEW.entered_at),
         answered_kind = coalesce(e.answered_kind, 'stage_advance'),
         response_minutes = coalesce(
           e.response_minutes,
           public.working_minutes_between(e.organization_id, e.opened_at, NEW.entered_at)
         ),
         within_sla = case
           when e.within_sla is not null then e.within_sla
           when e.sla_minutes is null then null
           else public.working_minutes_between(e.organization_id, e.opened_at, NEW.entered_at) <= e.sla_minutes
         end
   where e.task_id = NEW.task_id
     and e.closed_at is null;

  -- (b) Open a new episode for the entered stage (skip terminal 'done').
  if NEW.to_stage <> 'done'::public.task_stage then
    select t.stage_owner_positions->>NEW.to_stage::text,
           coalesce(
             (t.stage_sla_overrides->>NEW.to_stage::text)::int,
             (select sr.max_minutes from public.sla_rules sr
               where sr.organization_id = NEW.organization_id
                 and sr.stage_key = NEW.to_stage::text)
           )
      into v_owner_role, v_sla
      from public.tasks t where t.id = NEW.task_id;

    if v_owner_role is not null then
      select ta.employee_id into v_owner_emp
        from public.task_assignees ta
       where ta.task_id = NEW.task_id
         and ta.role_type::text = v_owner_role
       order by ta.created_at asc
       limit 1;
    end if;

    select instrumentation_cutover_date into v_cutover
      from public.activity_config where organization_id = NEW.organization_id;

    -- Dedup guard: a full Odoo history re-sync (delete + re-insert) must not
    -- create duplicate episodes for the same stage-occupancy.
    if not exists (
      select 1 from public.ownership_episodes
       where task_id = NEW.task_id and stage = NEW.to_stage and opened_at = NEW.entered_at
    ) then
      insert into public.ownership_episodes (
        organization_id, task_id, stage, owner_role, owner_employee_id,
        opened_at, sla_minutes, external_origin, source
      ) values (
        NEW.organization_id, NEW.task_id, NEW.to_stage, v_owner_role, v_owner_emp,
        NEW.entered_at, v_sla,
        coalesce((NEW.entered_at at time zone 'Asia/Riyadh')::date < v_cutover, false),
        'stage'
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_ownership_episode on public.task_stage_history;
create trigger trg_ownership_episode
  after insert on public.task_stage_history
  for each row execute function public.tg_ownership_episode();

-- 7. Answer trigger on approvals (reliable actor) ---------------------------
create or replace function public.tg_ownership_episode_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ownership_episodes e
     set answered_at = NEW.created_at,
         answered_kind = 'approval',
         answered_by_employee_id = NEW.actor_employee_id,
         response_minutes = public.working_minutes_between(e.organization_id, e.opened_at, NEW.created_at),
         within_sla = case
           when e.sla_minutes is null then null
           else public.working_minutes_between(e.organization_id, e.opened_at, NEW.created_at) <= e.sla_minutes
         end
   where e.task_id = NEW.task_id
     and e.closed_at is null
     and e.answered_at is null;
  return NEW;
end;
$$;

drop trigger if exists trg_ownership_episode_approval on public.task_approval_history;
create trigger trg_ownership_episode_approval
  after insert on public.task_approval_history
  for each row execute function public.tg_ownership_episode_approval();
