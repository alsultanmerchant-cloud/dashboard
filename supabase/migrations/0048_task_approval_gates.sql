-- 0048_task_approval_gates.sql
-- Adds a single-approver approval gate to tasks (Option A — matches live
-- Sky Light usage; the multi-step workflow_user/group tables are empty in
-- production). When a task has approval_required = true, forward stage
-- transitions are blocked until approval_status = 'approved'.
--
-- Adds:
--   * enum task_approval_status (not_required / pending / approved / rejected)
--   * tasks columns: approval_required, approval_status, first_approver_id,
--     approval_requested_at, approval_decided_at, approval_decided_by
--   * task_approval_history table (audit trail)
--   * trigger trg_tasks_approval_gate (blocks forward stage when not approved)
--   * helper RPCs: request_task_approval, approve_task, reject_task,
--     reset_task_approval — all SECURITY DEFINER, log to history.
--
-- Bypassed for service-role connections (auth.uid() is null) and users with
-- the global owner/admin/manager app roles, mirroring 0015 conventions.

-- =========================================================================
-- 1. Enum
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_approval_status') then
    create type public.task_approval_status as enum (
      'not_required',
      'pending',
      'approved',
      'rejected'
    );
  end if;
end$$;

-- =========================================================================
-- 2. Columns on tasks
-- =========================================================================
alter table public.tasks
  add column if not exists approval_required boolean not null default false,
  add column if not exists approval_status public.task_approval_status not null default 'not_required',
  add column if not exists first_approver_id uuid references public.employee_profiles(id) on delete set null,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_decided_at timestamptz,
  add column if not exists approval_decided_by uuid references public.employee_profiles(id) on delete set null;

alter table public.tasks
  drop constraint if exists tasks_approval_status_consistency;
alter table public.tasks
  add constraint tasks_approval_status_consistency check (
    (approval_required = false and approval_status = 'not_required')
    or
    (approval_required = true  and approval_status in ('pending','approved','rejected'))
  );

create index if not exists idx_tasks_approval_pending
  on public.tasks(organization_id, first_approver_id)
  where approval_required = true and approval_status = 'pending';

-- =========================================================================
-- 3. History table
-- =========================================================================
create table if not exists public.task_approval_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  stage public.task_stage not null,
  actor_employee_id uuid references public.employee_profiles(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('requested','approved','rejected','reset')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_approval_history_task
  on public.task_approval_history(task_id, created_at desc);

alter table public.task_approval_history enable row level security;

drop policy if exists task_approval_history_select on public.task_approval_history;
create policy task_approval_history_select
  on public.task_approval_history
  for select
  to authenticated
  using (public.has_org_access(organization_id));

-- =========================================================================
-- 4. Trigger: block forward stage when approval pending
-- =========================================================================
create or replace function public.assert_task_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_has_override boolean;
  v_old_idx int;
  v_new_idx int;
begin
  if v_user is null then
    return new;
  end if;
  if old.stage = new.stage then
    return new;
  end if;
  if not new.approval_required then
    return new;
  end if;
  if new.approval_status = 'approved' then
    return new;
  end if;

  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = v_user
       and ur.organization_id = new.organization_id
       and r.key in ('owner','admin','manager')
  ) into v_has_override;
  if v_has_override then
    return new;
  end if;

  select array_position(enum_range(null::public.task_stage), old.stage),
         array_position(enum_range(null::public.task_stage), new.stage)
    into v_old_idx, v_new_idx;

  if v_new_idx <= v_old_idx then
    return new;
  end if;

  raise exception
    'Stage transition % → % blocked: task requires approval (status: %)',
    old.stage, new.stage, new.approval_status
    using errcode = '42501',
          hint = 'Have the assigned approver call approve_task(task_id), then retry the stage move.';
end;
$$;

drop trigger if exists trg_tasks_approval_gate on public.tasks;
create trigger trg_tasks_approval_gate
  before update of stage
  on public.tasks
  for each row
  when (old.stage is distinct from new.stage)
  execute function public.assert_task_approval_gate();

comment on function public.assert_task_approval_gate() is
  'Blocks forward stage transitions on tasks where approval_required=true '
  'and approval_status is not approved. Bypassed for service-role and for '
  'users with owner/admin/manager app roles.';

-- =========================================================================
-- 5. Helper: resolve current actor's employee row
-- =========================================================================
create or replace function public._current_employee_in_org(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
    from public.employee_profiles
   where user_id = auth.uid()
     and organization_id = p_org
   limit 1;
$$;

-- =========================================================================
-- 6. RPC: request_task_approval
-- =========================================================================
create or replace function public.request_task_approval(
  p_task_id uuid,
  p_approver_id uuid default null,
  p_notes text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_employee uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % not found', p_task_id using errcode = 'P0002';
  end if;
  if not public.has_org_access(v_task.organization_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  v_employee := public._current_employee_in_org(v_task.organization_id);

  update public.tasks
     set approval_required     = true,
         approval_status       = 'pending',
         first_approver_id     = coalesce(p_approver_id, first_approver_id),
         approval_requested_at = now(),
         approval_decided_at   = null,
         approval_decided_by   = null
   where id = p_task_id
   returning * into v_task;

  insert into public.task_approval_history(
    organization_id, task_id, stage, actor_employee_id, actor_user_id, action, notes
  ) values (
    v_task.organization_id, v_task.id, v_task.stage, v_employee, auth.uid(), 'requested', p_notes
  );

  return v_task;
end;
$$;

-- =========================================================================
-- 7. RPC: approve_task
-- =========================================================================
create or replace function public.approve_task(
  p_task_id uuid,
  p_notes text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_employee uuid;
  v_can boolean;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % not found', p_task_id using errcode = 'P0002';
  end if;
  if not public.has_org_access(v_task.organization_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not v_task.approval_required then
    raise exception 'Task does not require approval' using errcode = '22023';
  end if;
  if v_task.approval_status = 'approved' then
    return v_task;
  end if;

  v_employee := public._current_employee_in_org(v_task.organization_id);

  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = auth.uid()
       and ur.organization_id = v_task.organization_id
       and r.key in ('owner','admin','manager')
  ) into v_can;

  if not v_can then
    if v_task.first_approver_id is null or v_employee is null
       or v_task.first_approver_id <> v_employee then
      raise exception 'Only the designated approver can approve this task'
        using errcode = '42501';
    end if;
  end if;

  update public.tasks
     set approval_status     = 'approved',
         approval_decided_at = now(),
         approval_decided_by = v_employee
   where id = p_task_id
   returning * into v_task;

  insert into public.task_approval_history(
    organization_id, task_id, stage, actor_employee_id, actor_user_id, action, notes
  ) values (
    v_task.organization_id, v_task.id, v_task.stage, v_employee, auth.uid(), 'approved', p_notes
  );

  return v_task;
end;
$$;

-- =========================================================================
-- 8. RPC: reject_task
-- =========================================================================
create or replace function public.reject_task(
  p_task_id uuid,
  p_notes text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_employee uuid;
  v_can boolean;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % not found', p_task_id using errcode = 'P0002';
  end if;
  if not public.has_org_access(v_task.organization_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not v_task.approval_required then
    raise exception 'Task does not require approval' using errcode = '22023';
  end if;

  v_employee := public._current_employee_in_org(v_task.organization_id);

  select exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = auth.uid()
       and ur.organization_id = v_task.organization_id
       and r.key in ('owner','admin','manager')
  ) into v_can;

  if not v_can then
    if v_task.first_approver_id is null or v_employee is null
       or v_task.first_approver_id <> v_employee then
      raise exception 'Only the designated approver can reject this task'
        using errcode = '42501';
    end if;
  end if;

  update public.tasks
     set approval_status     = 'rejected',
         approval_decided_at = now(),
         approval_decided_by = v_employee
   where id = p_task_id
   returning * into v_task;

  insert into public.task_approval_history(
    organization_id, task_id, stage, actor_employee_id, actor_user_id, action, notes
  ) values (
    v_task.organization_id, v_task.id, v_task.stage, v_employee, auth.uid(), 'rejected', p_notes
  );

  return v_task;
end;
$$;

-- =========================================================================
-- 9. RPC: reset_task_approval
-- =========================================================================
create or replace function public.reset_task_approval(
  p_task_id uuid,
  p_clear_requirement boolean default false,
  p_notes text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_employee uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % not found', p_task_id using errcode = 'P0002';
  end if;
  if not public.has_org_access(v_task.organization_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  v_employee := public._current_employee_in_org(v_task.organization_id);

  if p_clear_requirement then
    update public.tasks
       set approval_required     = false,
           approval_status       = 'not_required',
           first_approver_id     = null,
           approval_requested_at = null,
           approval_decided_at   = null,
           approval_decided_by   = null
     where id = p_task_id
     returning * into v_task;
  else
    update public.tasks
       set approval_status       = 'pending',
           approval_requested_at = now(),
           approval_decided_at   = null,
           approval_decided_by   = null
     where id = p_task_id and approval_required = true
     returning * into v_task;
  end if;

  insert into public.task_approval_history(
    organization_id, task_id, stage, actor_employee_id, actor_user_id, action, notes
  ) values (
    v_task.organization_id, v_task.id, v_task.stage, v_employee, auth.uid(), 'reset', p_notes
  );

  return v_task;
end;
$$;

-- =========================================================================
-- 10. Permissions
-- =========================================================================
grant execute on function public.request_task_approval(uuid, uuid, text) to authenticated;
grant execute on function public.approve_task(uuid, text) to authenticated;
grant execute on function public.reject_task(uuid, text) to authenticated;
grant execute on function public.reset_task_approval(uuid, boolean, text) to authenticated;
