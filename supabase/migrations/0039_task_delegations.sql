-- 0039_task_delegations.sql
-- Track Specialist → Supporting Department delegations as first-class
-- rows so we can render the delegation chain in the task UI and report
-- on supporting-dept load. Per the Sky Light owner-system MD section 15:
--
--   Specialist:   writes Requirement, drops it in Log Note, assigns to Lead
--   Lead:         distributes to Agent
--   Agent:        executes, returns to Lead/Flow
--
-- Today this is implicit (the only signal is task_assignees rows for
-- supporting_lead and supporting_agent slots). We make it explicit so
-- analytics can answer "who delegated to whom, when, with what brief."
--
-- Trigger behavior:
--   * When a row with role_type = 'supporting_lead' is inserted on a task,
--     create a task_delegations row capturing (delegator = specialist of
--     same task, delegatee = the supporting_lead employee, brief = empty),
--     post a system task_comment quoting the requirement (filled by the
--     Specialist immediately after — UI prompts for it), and create a
--     notification for the supporting_lead.
--   * When supporting_agent is later set by the lead, update the
--     delegation row's executor_employee_id and notify the agent.
--
-- The delegation row is owned by the task; cascading delete cleans it up.

create table if not exists public.task_delegations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  -- The Specialist who initiated the delegation. Resolved at insert time
  -- from task_assignees on the same task.
  delegator_employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  -- The Supporting-Department Lead receiving the request.
  delegatee_employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  -- The Agent inside the supporting dept who actually executes. Set
  -- when the lead distributes; nullable until then.
  executor_employee_id uuid references public.employee_profiles(id) on delete set null,
  -- Free-form brief copied from the Specialist's Log Note at delegation
  -- time. Captured as text (not a comment FK) so deletion of the comment
  -- doesn't lose the historical brief.
  brief text,
  -- Lifecycle: 'pending' (lead hasn't assigned) → 'in_progress' (executor
  -- assigned) → 'returned' (executor returned the work) → 'closed'.
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'returned', 'closed')),
  delegated_at timestamptz not null default now(),
  assigned_executor_at timestamptz,
  returned_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_task_delegations_task on public.task_delegations(task_id);
create index if not exists idx_task_delegations_org on public.task_delegations(organization_id);
create index if not exists idx_task_delegations_delegatee_open
  on public.task_delegations(delegatee_employee_id)
  where status in ('pending', 'in_progress');
create index if not exists idx_task_delegations_executor_open
  on public.task_delegations(executor_employee_id)
  where status in ('in_progress');

-- updated_at trigger (matches the convention used in 0003 etc.)
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_task_delegations_updated_at'
  ) then
    create trigger trg_task_delegations_updated_at
      before update on public.task_delegations
      for each row execute function public.tg_set_updated_at();
  end if;
end$$;

-- Trigger function: react to task_assignees inserts that create a
-- supporting_lead or supporting_agent slot.
create or replace function public.handle_supporting_dept_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_specialist uuid;
  v_delegation_id uuid;
begin
  if new.role_type = 'supporting_lead' then
    -- Resolve the specialist on the same task. If none, abort with a clear
    -- error — a delegation cannot exist without a Specialist as delegator.
    select employee_id into v_specialist
      from public.task_assignees
     where task_id = new.task_id
       and role_type = 'specialist'
     limit 1;
    if v_specialist is null then
      raise exception
        'Cannot assign supporting_lead on task %: no specialist slot found. '
        'Assign the specialist first.', new.task_id
        using errcode = '23514';
    end if;

    insert into public.task_delegations (
      organization_id, task_id, delegator_employee_id, delegatee_employee_id, status
    ) values (
      new.organization_id, new.task_id, v_specialist, new.employee_id, 'pending'
    )
    returning id into v_delegation_id;

    -- Notify the supporting lead.
    insert into public.notifications (
      organization_id, recipient_employee_id, type, title, body, entity_type, entity_id
    ) values (
      new.organization_id,
      new.employee_id,
      'task_delegation_received',
      'مهمة جديدة من قسم متخصص',
      'تم إسناد مهمة إليك. افتح المهمة لقراءة المتطلبات في Log Note.',
      'task',
      new.task_id
    );

  elsif new.role_type = 'supporting_agent' then
    -- Update the most recent open delegation on this task with the executor.
    update public.task_delegations
       set executor_employee_id = new.employee_id,
           status = 'in_progress',
           assigned_executor_at = now()
     where task_id = new.task_id
       and status = 'pending'
       and id = (
         select id from public.task_delegations
          where task_id = new.task_id and status = 'pending'
          order by delegated_at desc
          limit 1
       );

    -- Notify the executor.
    insert into public.notifications (
      organization_id, recipient_employee_id, type, title, body, entity_type, entity_id
    ) values (
      new.organization_id,
      new.employee_id,
      'task_delegation_assigned',
      'مهمة منفذة جديدة',
      'وزّع لك Lead القسم مهمة. افتح Log Note لقراءة الـ brief.',
      'task',
      new.task_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_supporting_dept_assignment on public.task_assignees;
create trigger trg_supporting_dept_assignment
  after insert on public.task_assignees
  for each row
  when (new.role_type in ('supporting_lead', 'supporting_agent'))
  execute function public.handle_supporting_dept_assignment();

comment on table public.task_delegations is
  'Tracks Specialist → Supporting Department delegations per the Sky Light '
  'owner-system MD section 15. One row per delegation; supports analytics '
  'on supporting-dept load and turnaround time.';

-- RLS: org-scoped read for any member; writes go through the trigger
-- on task_assignees, so direct insert/update/delete is restricted.
alter table public.task_delegations enable row level security;

drop policy if exists task_delegations_select on public.task_delegations;
create policy task_delegations_select on public.task_delegations
  for select to authenticated
  using (
    organization_id in (
      select organization_id from public.employee_profiles where user_id = auth.uid()
    )
  );

-- Updates allowed for delegatee/executor to flip status to returned/closed
-- via the dashboard. Owner/admin can do anything via service role on backend.
drop policy if exists task_delegations_update on public.task_delegations;
create policy task_delegations_update on public.task_delegations
  for update to authenticated
  using (
    organization_id in (
      select organization_id from public.employee_profiles where user_id = auth.uid()
    )
    and (
      delegatee_employee_id in (
        select id from public.employee_profiles where user_id = auth.uid()
      )
      or executor_employee_id in (
        select id from public.employee_profiles where user_id = auth.uid()
      )
    )
  );
