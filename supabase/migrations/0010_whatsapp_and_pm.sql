-- 0010_whatsapp_and_pm.sql
-- Phase 6: Sky Light WhatsApp group registry + global Project Manager.
--
-- The manual treats WhatsApp as a primary client channel with two groups
-- per active project:
--   * Client group   — naming convention: "إدارة نشاط | <client>"
--   * Internal group — naming convention: "<client>"
-- Account Manager is the bridge between them. We track the references here
-- so the dashboard can surface them, copy links, and (later, in Phase 6b)
-- mirror messages back into the task activity feed.

-- 1. Global Project Manager (manual: "usually fixed").
alter table public.organizations
  add column if not exists project_manager_employee_id uuid
    references public.employee_profiles(id) on delete set null;

-- 2. WhatsApp group registry.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'whatsapp_group_kind') then
    create type public.whatsapp_group_kind as enum ('client', 'internal');
  end if;
end$$;

create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.whatsapp_group_kind not null,
  name text not null,
  invite_url text,
  whatsapp_chat_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- One client + one internal group per project.
create unique index if not exists uq_whatsapp_groups_project_kind
  on public.whatsapp_groups (project_id, kind);
create index if not exists idx_whatsapp_groups_org
  on public.whatsapp_groups (organization_id);

create trigger trg_whatsapp_groups_updated_at
  before update on public.whatsapp_groups
  for each row execute function public.tg_set_updated_at();

alter table public.whatsapp_groups enable row level security;

drop policy if exists "wa_select" on public.whatsapp_groups;
create policy "wa_select"
  on public.whatsapp_groups for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists "wa_write" on public.whatsapp_groups;
create policy "wa_write"
  on public.whatsapp_groups for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));
