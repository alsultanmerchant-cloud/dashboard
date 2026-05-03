-- =========================================================================
-- Migration 0027 — Governance Enforcement (phase T6)
-- =========================================================================
-- Source: docs/SPEC_FROM_OWNER.md §10 — five governance rules. This
-- migration adds the `governance_violations` table that the in-app
-- /governance dashboard reads, that `moveTaskStageAction` writes nothing
-- into directly (the gate is just a friendly reject), and that the
-- `governance-watcher` edge function (daily 06:00 Asia/Riyadh) populates
-- with `missing_log_note` and `unowned_task` records.
--
-- Idempotent + additive. RLS uses the 1-arg has_permission(text) overload
-- (added in 0020a). All write policies are split per command per the
-- Wave-2 lessons (0022b/0023b/0026b) — no FOR-ALL policies that re-open
-- SELECT.
--
-- Roles seeded in 0006: owner, admin, manager (= Head), account_manager,
-- specialist. governance.view binds to manager/admin/owner so heads see
-- the dashboard. governance.resolve binds to admin/owner only.
-- =========================================================================

create table if not exists public.governance_violations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('missing_log_note','stage_jump','unowned_task','permission_breach')),
  task_id         uuid references public.tasks(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  detected_at     timestamptz not null default now(),
  resolver_user_id uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  note            text
);

comment on table public.governance_violations is
  'Governance violations (owner spec §10). Written by the governance-watcher edge function and resolved by admin/head from the /governance dashboard.';

create index if not exists idx_gov_violations_org_open
  on public.governance_violations(organization_id) where resolved_at is null;
create index if not exists idx_gov_violations_task
  on public.governance_violations(task_id);
create index if not exists idx_gov_violations_kind_open
  on public.governance_violations(kind) where resolved_at is null;

-- Helps the watcher's "no existing open violation of same kind" check.
create index if not exists idx_gov_violations_task_kind_open
  on public.governance_violations(task_id, kind) where resolved_at is null;

alter table public.governance_violations enable row level security;

drop policy if exists gov_violations_select on public.governance_violations;
create policy gov_violations_select on public.governance_violations
  for select to authenticated
  using ( public.has_permission('governance.view') );

drop policy if exists gov_violations_insert on public.governance_violations;
create policy gov_violations_insert on public.governance_violations
  for insert to authenticated
  with check ( public.has_permission('governance.view') );

drop policy if exists gov_violations_update on public.governance_violations;
create policy gov_violations_update on public.governance_violations
  for update to authenticated
  using      ( public.has_permission('governance.resolve') )
  with check ( public.has_permission('governance.resolve') );

drop policy if exists gov_violations_delete on public.governance_violations;
create policy gov_violations_delete on public.governance_violations
  for delete to authenticated
  using ( public.has_permission('governance.resolve') );

-- Permissions ------------------------------------------------------------
insert into public.permissions (key, description) values
  ('governance.view',    'عرض لوحة مخالفات الحوكمة'),
  ('governance.resolve', 'إغلاق مخالفات الحوكمة')
on conflict (key) do nothing;

-- governance.view → owner + admin + manager (Head)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin','manager')
  and p.key = 'governance.view'
on conflict do nothing;

-- governance.resolve → owner + admin only
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner','admin')
  and p.key = 'governance.resolve'
on conflict do nothing;
