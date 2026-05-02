-- =========================================================================
-- Migration 0020 — Feature Flags Foundation (phase T0)
-- =========================================================================
-- Single-tenant Sky Light deployment, but the schema keeps things simple:
-- one flag row per key (no per-org column — every flag is global). Flags
-- can be optionally restricted to a list of role keys via rollout_roles.
--
--   • read  — any authenticated user (UI needs to gate components)
--   • write — only callers with permission 'feature_flag.manage'
--             (seeded for owner + admin below; helper public.has_permission
--             takes (target_org, perm_key) so RLS calls it against the
--             single seeded organization id)
--
-- All operations are additive + idempotent. Safe to re-run.
-- =========================================================================

-- 1. Catalog ----------------------------------------------------------------
create table if not exists public.feature_flags (
  key            text primary key,
  enabled        boolean not null default false,
  rollout_roles  text[] not null default '{}',
  description    text,
  updated_at     timestamptz not null default now()
);

comment on table  public.feature_flags is 'Global feature toggles. enabled + optional rollout_roles gate.';
comment on column public.feature_flags.rollout_roles is
  'Empty array → enabled bit alone decides. Non-empty → user must hold ≥1 of these role keys AND enabled must be true.';

-- Auto-bump updated_at on UPDATE -------------------------------------------
create or replace function public.feature_flags_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_feature_flags_set_updated_at on public.feature_flags;
create trigger trg_feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.feature_flags_set_updated_at();

-- 2. Permission seed --------------------------------------------------------
insert into public.permissions (key, description) values
  ('feature_flag.manage', 'تبديل وتعديل المفاتيح المميّزة (Feature Flags)')
on conflict (key) do nothing;

-- Owner + admin already get every permission via the catch-all loop in
-- migration 0006. Re-asserting here makes the migration idempotent even on
-- a fresh DB where the catch-all hasn't run yet.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin')
  and p.key = 'feature_flag.manage'
on conflict do nothing;

-- 3. RLS --------------------------------------------------------------------
alter table public.feature_flags enable row level security;

-- Read: every authenticated user. We use a plain `to authenticated` policy
-- because flag visibility itself is not sensitive (the gated content is).
drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select
  on public.feature_flags
  for select
  to authenticated
  using (true);

-- Write: must hold feature_flag.manage in the seeded organization.
-- has_permission(target_org, perm_key) joins user_roles → role_permissions
-- → permissions. The single-tenant org id matches the 0006 seed.
drop policy if exists feature_flags_insert on public.feature_flags;
create policy feature_flags_insert
  on public.feature_flags
  for insert
  to authenticated
  with check (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'feature_flag.manage'
    )
  );

drop policy if exists feature_flags_update on public.feature_flags;
create policy feature_flags_update
  on public.feature_flags
  for update
  to authenticated
  using (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'feature_flag.manage'
    )
  )
  with check (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'feature_flag.manage'
    )
  );

drop policy if exists feature_flags_delete on public.feature_flags;
create policy feature_flags_delete
  on public.feature_flags
  for delete
  to authenticated
  using (
    public.has_permission(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'feature_flag.manage'
    )
  );

-- 4. Seed flags -------------------------------------------------------------
-- 'sales_track_enabled' gates the Sales / Telesales departments + routes.
-- 'whatsapp_enabled' gates the wa_outbox + group routing UI.
-- Both default OFF per owner directive (2026-05-02 — Sales deferred,
-- WhatsApp deferred).
insert into public.feature_flags (key, enabled, rollout_roles, description) values
  ('sales_track_enabled', false, '{}',
    'إظهار أقسام المبيعات والتيلي سيلز ومسارات Sales CRM'),
  ('whatsapp_enabled',    false, '{}',
    'تفعيل صندوق صادر واتساب وتوجيه القنوات للمشاريع')
on conflict (key) do nothing;
