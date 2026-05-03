-- =========================================================================
-- Migration 0023 — Task Workflow PDF Gaps (phase T3)
-- =========================================================================
-- Closes the open rows in docs/SPEC_FROM_PDF.md §13:
--   • tasks.delay_days       — generated column, populated when a task
--                              finishes after its planned date.
--   • tasks.hold_reason      — free-text reason if a task is paused at the
--     tasks.hold_since         task level (mirrors projects.{hold_reason,held_at}
--                              but per-task; PDF §6 only requires it at the
--                              project level — added here for parity).
--   • task_followers          — followers (distinct from assignees) so a
--                              specialist / AM can keep someone in the loop
--                              without giving them an exit-role on a stage.
--                              The dispatch promised this column to T2's
--                              tightened tasks_select policy; this migration
--                              drops + recreates that policy with the new
--                              follower branch (cross-phase contract laid
--                              out in 0022's header).
--
-- Schema reality (verified before writing this file):
--   • tasks has `planned_date` (date) + `completed_at` (timestamptz). No
--     column literally called `deadline`; the PDF treats "Deadline" and
--     "Planned Date" as the same field, so we compute delay_days against
--     planned_date.
--   • tasks.stage is the canonical workflow enum (`new ... done`).
--     `done` is the terminal stage. Generated column gates on stage='done'.
--   • projects.held_at + projects.hold_reason already exist (migration
--     0019). Not re-added.
--   • project_status is NOT an enum on this DB — projects.status is `text`
--     (with rows using 'on_hold' as the HOLD value). The HOLD ribbon UI
--     ALREADY keys off projects.status='on_hold' AND held_at IS NOT NULL,
--     so we keep that contract and do nothing to a (non-existent) enum.
--   • task_comments.kind enum already exists (migration 0019).
--
-- Idempotent. Safe to re-run.
-- =========================================================================

-- 1. Per-task delay + hold metadata ---------------------------------------
-- Note on the view conflict: migration 0007 created a view
--   public.tasks_with_metrics as select t.*, task_delay_days(t) as delay_days
-- and a function `task_delay_days(t public.tasks)` returning that same
-- value (which also includes a "negative when ahead" branch and a
-- live-updating "current_date - planned_date" branch for non-done tasks).
-- The new generated column would collide with the view's alias, so we
-- drop the view, add the column, then recreate the view so it sources
-- delay_days from the column directly (and we drop the function whose
-- responsibility is now subsumed by the column for done tasks; the
-- view supplies the live-running delta for non-done tasks via a CASE).
drop view if exists public.tasks_with_metrics;
drop function if exists public.task_delay_days(public.tasks);

-- NOTE: STORED generated columns require IMMUTABLE expressions. A bare
-- `completed_at::date` cast on a timestamptz is NOT immutable (depends on
-- session TimeZone). Anchoring the cast with `at time zone 'UTC'` makes
-- it immutable: literal timezone constants are immutable per Postgres
-- function-volatility rules.
alter table public.tasks
  add column if not exists delay_days integer
    generated always as (
      case
        when stage = 'done'
         and planned_date is not null
         and completed_at is not null
        then greatest(
          0,
          ((completed_at at time zone 'UTC')::date - planned_date)
        )
      end
    ) stored,
  add column if not exists hold_reason text,
  add column if not exists hold_since timestamptz;

-- Recreate the metrics view. For done tasks the column is authoritative;
-- for in-flight tasks we still want a live "running delay" so the legacy
-- dashboards keep working — keep that branch as a CASE inside the view,
-- not a generated column (the column must be deterministic w.r.t row
-- contents, not w.r.t. now()).
create or replace view public.tasks_with_metrics as
select
  t.*,
  case
    when t.planned_date is null then null
    when t.stage = 'done' then t.delay_days
    else (current_date - t.planned_date)
  end                                  as running_delay_days,
  public.task_current_stage_seconds(t) as current_stage_seconds
from public.tasks t;

comment on column public.tasks.delay_days is
  'Computed: days completed_at trails planned_date. NULL until the task is done.';
comment on column public.tasks.hold_reason is
  'Optional reason a task is paused. Mirrors projects.hold_reason at the task level.';
comment on column public.tasks.hold_since is
  'When the task was paused. Mirrors projects.held_at at the task level.';

-- 2. Followers --------------------------------------------------------------
create table if not exists public.task_followers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_followers_user_idx
  on public.task_followers (user_id);
create index if not exists task_followers_task_idx
  on public.task_followers (task_id);

alter table public.task_followers enable row level security;

-- SELECT: anyone in the org who can already see the parent task. The
-- parent-task visibility check is the same OR-chain used by tasks_select
-- below (view_all OR creator OR assignee). Followers can ALSO see their
-- own follower row directly so a "my follows" view is possible without
-- having to also be the task assignee.
drop policy if exists task_followers_select on public.task_followers;
create policy task_followers_select
  on public.task_followers
  for select
  to authenticated
  using (
    task_followers.user_id = auth.uid()
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and public.has_org_access(t.organization_id)
        and (
          public.has_permission('task.view_all')
          or t.created_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            join public.employee_profiles ep on ep.id = ta.employee_id
            where ta.task_id = t.id
              and ep.user_id = auth.uid()
          )
        )
    )
  );

-- INSERT/DELETE: caller must be the task creator OR hold task.view_all.
-- We collapse INSERT + DELETE into a single FOR ALL policy with USING +
-- WITH CHECK; a separate write policy keeps semantics explicit.
drop policy if exists task_followers_write on public.task_followers;
create policy task_followers_write
  on public.task_followers
  for all
  to authenticated
  using (
    public.has_permission('task.view_all')
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and t.created_by = auth.uid()
    )
  )
  with check (
    public.has_permission('task.view_all')
    or exists (
      select 1
      from public.tasks t
      where t.id = task_followers.task_id
        and t.created_by = auth.uid()
    )
  );

-- 3. Re-create tasks_select to add the followers branch --------------------
-- Migration 0022 shipped the (view_all OR creator OR assignee) chain.
-- T3 owns the followers branch — drop and recreate, preserving the
-- existing semantics + adding the new OR.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission('task.view_all')
      or tasks.created_by = auth.uid()
      or exists (
        select 1
        from public.task_assignees ta
        join public.employee_profiles ep on ep.id = ta.employee_id
        where ta.task_id = tasks.id
          and ep.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.task_followers tf
        where tf.task_id = tasks.id
          and tf.user_id = auth.uid()
      )
    )
  );

-- 4. Permission seed -------------------------------------------------------
-- task.manage_followers is the explicit permission for adding/removing
-- followers via server actions. Without it, the action falls back to the
-- creator-or-view_all check at the RLS layer. Bound to roles that
-- already hold task.view_all.
insert into public.permissions (key, description) values
  ('task.manage_followers',
    'إضافة وإزالة متابعي المهمة (مستقل عن المُسنَدين)')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager', 'account_manager')
  and p.key = 'task.manage_followers'
on conflict do nothing;
