-- =========================================================================
-- Migration 0143 — Employee warnings / disciplinary notes (الإنذارات)
-- =========================================================================
-- Issued by a Head or Team-Leader against a team member. Optionally linked
-- to the task that triggered it. RLS read via has_org_access; write gated
-- by warning.manage.
-- =========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'warning_severity') then
    create type public.warning_severity as enum
      ('verbal', 'written', 'final', 'suspension');
  end if;
end$$;

create table if not exists public.employee_warnings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_profile_id uuid not null references public.employee_profiles(id) on delete cascade,
  issued_by           uuid references public.employee_profiles(id) on delete set null,
  severity            public.warning_severity not null default 'verbal',
  reason              text not null,
  detail              text,
  related_task_id     uuid references public.tasks(id) on delete set null,
  issued_at           timestamptz not null default now(),
  acknowledged_at     timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);

comment on table public.employee_warnings is
  'Disciplinary warnings issued to employees by a Head/Team-Leader. Surfaced on the department dashboard + employee performance table.';

create index if not exists idx_warnings_org      on public.employee_warnings(organization_id);
create index if not exists idx_warnings_emp      on public.employee_warnings(employee_profile_id, issued_at desc);

alter table public.employee_warnings enable row level security;

drop policy if exists warnings_select on public.employee_warnings;
create policy warnings_select on public.employee_warnings
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists warnings_insert on public.employee_warnings;
create policy warnings_insert on public.employee_warnings
  for insert to authenticated
  with check (public.has_permission(organization_id, 'warning.manage'));

drop policy if exists warnings_update on public.employee_warnings;
create policy warnings_update on public.employee_warnings
  for update to authenticated
  using      (public.has_permission(organization_id, 'warning.manage'))
  with check (public.has_permission(organization_id, 'warning.manage'));

drop policy if exists warnings_delete on public.employee_warnings;
create policy warnings_delete on public.employee_warnings
  for delete to authenticated
  using (public.has_permission(organization_id, 'warning.manage'));
