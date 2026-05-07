-- 0050_project_and_task_codes.sql
-- Adds human-readable identifiers:
--   * projects.project_code (e.g. "PRJ-007"), unique per organization
--   * tasks.task_code (e.g. "PRJ-007-014"), unique per project
-- Plus per-org and per-project counter state, BEFORE INSERT triggers that
-- auto-fill the codes when missing, and a one-shot backfill for existing
-- rows numbered in created_at order.

create table if not exists public.org_project_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_seq integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.org_project_counters enable row level security;

drop policy if exists org_project_counters_select on public.org_project_counters;
create policy org_project_counters_select
  on public.org_project_counters
  for select
  to authenticated
  using (public.has_org_access(organization_id));

alter table public.projects
  add column if not exists project_code text,
  add column if not exists task_seq integer not null default 0;

alter table public.tasks
  add column if not exists task_code text,
  add column if not exists code_seq integer;

create or replace function public._next_project_code(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
begin
  insert into public.org_project_counters as c (organization_id, last_seq)
       values (p_org, 1)
  on conflict (organization_id) do update
       set last_seq = c.last_seq + 1,
           updated_at = now()
  returning c.last_seq into v_seq;
  return 'PRJ-' || lpad(v_seq::text, 3, '0');
end;
$$;

create or replace function public._next_task_code(p_project uuid)
returns table(code text, seq int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
  v_pcode text;
begin
  update public.projects
     set task_seq = task_seq + 1
   where id = p_project
   returning task_seq, project_code into v_seq, v_pcode;
  if v_seq is null then
    raise exception 'project % not found', p_project using errcode = 'P0002';
  end if;
  return query select (coalesce(v_pcode, 'PRJ-?') || '-' || lpad(v_seq::text, 3, '0'))::text, v_seq;
end;
$$;

create or replace function public.tg_set_project_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_code is null or new.project_code = '' then
    new.project_code := public._next_project_code(new.organization_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_set_code on public.projects;
create trigger trg_projects_set_code
  before insert on public.projects
  for each row
  execute function public.tg_set_project_code();

create or replace function public.tg_set_task_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  if new.task_code is null or new.task_code = '' then
    select * into v from public._next_task_code(new.project_id);
    new.task_code := v.code;
    new.code_seq  := v.seq;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_set_code on public.tasks;
create trigger trg_tasks_set_code
  before insert on public.tasks
  for each row
  execute function public.tg_set_task_code();

-- Backfill projects (per-org sequence in created_at order)
do $$
declare
  v_org record;
  v_proj record;
  v_idx int;
begin
  for v_org in select id from public.organizations loop
    v_idx := 0;
    for v_proj in
      select id from public.projects
       where organization_id = v_org.id and project_code is null
       order by created_at, id
    loop
      v_idx := v_idx + 1;
      update public.projects
         set project_code = 'PRJ-' || lpad(v_idx::text, 3, '0')
       where id = v_proj.id;
    end loop;
    if v_idx > 0 then
      insert into public.org_project_counters as c (organization_id, last_seq)
           values (v_org.id, v_idx)
      on conflict (organization_id) do update
           set last_seq = greatest(c.last_seq, v_idx),
               updated_at = now();
    end if;
  end loop;
end$$;

-- Backfill tasks (per-project sequence)
do $$
declare
  v_proj record;
  v_task record;
  v_idx int;
begin
  for v_proj in select id, project_code from public.projects loop
    v_idx := 0;
    for v_task in
      select id from public.tasks
       where project_id = v_proj.id and task_code is null
       order by created_at, id
    loop
      v_idx := v_idx + 1;
      update public.tasks
         set task_code = v_proj.project_code || '-' || lpad(v_idx::text, 3, '0'),
             code_seq  = v_idx
       where id = v_task.id;
    end loop;
    if v_idx > 0 then
      update public.projects set task_seq = greatest(task_seq, v_idx) where id = v_proj.id;
    end if;
  end loop;
end$$;

alter table public.projects
  drop constraint if exists projects_org_project_code_unique;
alter table public.projects
  add constraint projects_org_project_code_unique
    unique (organization_id, project_code);

create unique index if not exists tasks_project_task_code_unique
  on public.tasks(project_id, task_code);

create index if not exists idx_tasks_task_code
  on public.tasks(organization_id, task_code);

grant execute on function public._next_project_code(uuid) to authenticated;
grant execute on function public._next_task_code(uuid) to authenticated;
