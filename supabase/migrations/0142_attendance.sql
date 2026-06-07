-- =========================================================================
-- Migration 0142 — Attendance records (الحضور والانصراف)
-- =========================================================================
-- One row per (organization, employee, work_date). Net-new manual surface
-- for the Department-Head / Team-Leader dashboards: there is no upstream
-- attendance feed yet, so rows are entered manually (source='manual') or
-- imported later (source='import'|'device'). RLS read via has_org_access;
-- write gated by attendance.manage.
-- =========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum
      ('present', 'late', 'absent', 'remote', 'half_day', 'leave');
  end if;
end$$;

create table if not exists public.attendance_records (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_profile_id uuid not null references public.employee_profiles(id) on delete cascade,
  work_date           date not null,
  check_in_at         timestamptz,
  check_out_at        timestamptz,
  status              public.attendance_status not null default 'present',
  late_minutes        int not null default 0,
  worked_minutes      int,
  source              text not null default 'manual'
                        check (source in ('manual', 'import', 'device')),
  note                text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, employee_profile_id, work_date)
);

comment on table public.attendance_records is
  'Per-employee daily attendance. Manually entered surface for Head/Team-Leader dashboards; no upstream feed yet.';

create index if not exists idx_attendance_org        on public.attendance_records(organization_id);
create index if not exists idx_attendance_emp_date    on public.attendance_records(employee_profile_id, work_date desc);
create index if not exists idx_attendance_date        on public.attendance_records(work_date);

drop trigger if exists trg_attendance_updated_at on public.attendance_records;
create trigger trg_attendance_updated_at
  before update on public.attendance_records
  for each row execute function public.tg_set_updated_at();

alter table public.attendance_records enable row level security;

drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (public.has_permission(organization_id, 'attendance.manage'));

drop policy if exists attendance_update on public.attendance_records;
create policy attendance_update on public.attendance_records
  for update to authenticated
  using      (public.has_permission(organization_id, 'attendance.manage'))
  with check (public.has_permission(organization_id, 'attendance.manage'));

drop policy if exists attendance_delete on public.attendance_records;
create policy attendance_delete on public.attendance_records
  for delete to authenticated
  using (public.has_permission(organization_id, 'attendance.manage'));
