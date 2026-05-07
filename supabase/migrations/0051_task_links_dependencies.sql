-- 0051_task_links_dependencies.sql
-- Typed task dependencies for the Gantt view (FS / SS / FF / SF + lag).
--
-- Adds:
--   * tasks.start_date (date) — paired with planned_date (= finish) for
--     FS/SS/FF/SF math and Gantt rendering.
--   * enum task_dependency_type
--   * table task_links(source_task_id, target_task_id, dependency_type, lag_days)
--     with same-project + same-org enforcement and cycle prevention.
--   * RPC recalculate_project_task_dates(project_id) — naive day-arithmetic
--     forward propagation. Gap #8 will swap plain days for working days
--     once the holiday calendar exists.
--
-- RLS: read with has_org_access; write requires has_permission(org, 'tasks.manage').

alter table public.tasks
  add column if not exists start_date date;

create index if not exists idx_tasks_start_date
  on public.tasks(organization_id, start_date)
  where start_date is not null;

comment on column public.tasks.start_date is
  'Task start date. Pair with planned_date (finish) for FS/SS/FF/SF dependency math and Gantt rendering.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_dependency_type') then
    create type public.task_dependency_type as enum (
      'finish_to_start',
      'start_to_start',
      'finish_to_finish',
      'start_to_finish'
    );
  end if;
end$$;

create table if not exists public.task_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_task_id uuid not null references public.tasks(id) on delete cascade,
  target_task_id uuid not null references public.tasks(id) on delete cascade,
  dependency_type public.task_dependency_type not null default 'finish_to_start',
  lag_days integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint task_links_distinct_endpoints check (source_task_id <> target_task_id),
  constraint task_links_unique_pair unique (source_task_id, target_task_id)
);

create index if not exists idx_task_links_source on public.task_links(source_task_id);
create index if not exists idx_task_links_target on public.task_links(target_task_id);
create index if not exists idx_task_links_org on public.task_links(organization_id);

create or replace function public.assert_task_link_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src record;
  v_tgt record;
begin
  select organization_id, project_id into v_src
    from public.tasks where id = new.source_task_id;
  select organization_id, project_id into v_tgt
    from public.tasks where id = new.target_task_id;

  if v_src is null or v_tgt is null then
    raise exception 'task_link references missing task' using errcode = 'P0002';
  end if;
  if v_src.organization_id <> v_tgt.organization_id then
    raise exception 'task_link must connect tasks in the same organization' using errcode = '23514';
  end if;
  if v_src.project_id <> v_tgt.project_id then
    raise exception 'task_link must connect tasks in the same project' using errcode = '23514';
  end if;
  if new.organization_id is null then
    new.organization_id := v_src.organization_id;
  elsif new.organization_id <> v_src.organization_id then
    raise exception 'task_link.organization_id mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_links_consistency on public.task_links;
create trigger trg_task_links_consistency
  before insert or update on public.task_links
  for each row execute function public.assert_task_link_consistency();

create or replace function public.assert_task_link_no_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle boolean;
begin
  with recursive successors(task_id) as (
    select new.target_task_id
    union
    select tl.target_task_id
      from public.task_links tl
      join successors s on s.task_id = tl.source_task_id
     where (tg_op <> 'UPDATE') or tl.id <> new.id
  )
  select exists(select 1 from successors where task_id = new.source_task_id) into v_cycle;
  if v_cycle then
    raise exception 'task_link would create a cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_links_no_cycle on public.task_links;
create trigger trg_task_links_no_cycle
  before insert or update on public.task_links
  for each row execute function public.assert_task_link_no_cycle();

alter table public.task_links enable row level security;

drop policy if exists task_links_select on public.task_links;
create policy task_links_select
  on public.task_links
  for select
  to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists task_links_write on public.task_links;
create policy task_links_write
  on public.task_links
  for all
  to authenticated
  using (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'tasks.manage')
  )
  with check (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'tasks.manage')
  );

create or replace function public.recalculate_project_task_dates(p_project uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_iter int := 0;
  v_changed int;
  v_total_changes int := 0;
  v_max_iter constant int := 50;
  v_link record;
  v_src record;
  v_tgt record;
  v_target_start date;
  v_target_finish date;
  v_duration int;
begin
  select organization_id into v_org from public.projects where id = p_project;
  if v_org is null then
    raise exception 'project % not found', p_project using errcode = 'P0002';
  end if;
  if auth.uid() is not null and not public.has_org_access(v_org) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  loop
    v_iter := v_iter + 1;
    v_changed := 0;
    for v_link in
      select tl.source_task_id, tl.target_task_id, tl.dependency_type, tl.lag_days
        from public.task_links tl
        join public.tasks ts on ts.id = tl.source_task_id
       where ts.project_id = p_project
    loop
      select start_date, planned_date into v_src
        from public.tasks where id = v_link.source_task_id;
      select start_date, planned_date into v_tgt
        from public.tasks where id = v_link.target_task_id;
      if v_src.start_date is null and v_src.planned_date is null then
        continue;
      end if;

      v_duration := case
        when v_tgt.start_date is not null and v_tgt.planned_date is not null
          then greatest(0, v_tgt.planned_date - v_tgt.start_date)
        else 0
      end;

      v_target_start  := v_tgt.start_date;
      v_target_finish := v_tgt.planned_date;

      case v_link.dependency_type
        when 'finish_to_start' then
          if v_src.planned_date is not null then
            v_target_start := greatest(coalesce(v_target_start, v_src.planned_date + v_link.lag_days),
                                       v_src.planned_date + v_link.lag_days);
            v_target_finish := v_target_start + v_duration;
          end if;
        when 'start_to_start' then
          if v_src.start_date is not null then
            v_target_start := greatest(coalesce(v_target_start, v_src.start_date + v_link.lag_days),
                                       v_src.start_date + v_link.lag_days);
            v_target_finish := v_target_start + v_duration;
          end if;
        when 'finish_to_finish' then
          if v_src.planned_date is not null then
            v_target_finish := greatest(coalesce(v_target_finish, v_src.planned_date + v_link.lag_days),
                                        v_src.planned_date + v_link.lag_days);
            v_target_start := v_target_finish - v_duration;
          end if;
        when 'start_to_finish' then
          if v_src.start_date is not null then
            v_target_finish := greatest(coalesce(v_target_finish, v_src.start_date + v_link.lag_days),
                                        v_src.start_date + v_link.lag_days);
            v_target_start := v_target_finish - v_duration;
          end if;
      end case;

      if v_target_start is distinct from v_tgt.start_date
         or v_target_finish is distinct from v_tgt.planned_date then
        update public.tasks
           set start_date   = v_target_start,
               planned_date = v_target_finish
         where id = v_link.target_task_id;
        v_changed := v_changed + 1;
      end if;
    end loop;
    v_total_changes := v_total_changes + v_changed;
    exit when v_changed = 0 or v_iter >= v_max_iter;
  end loop;

  return v_total_changes;
end;
$$;

grant execute on function public.recalculate_project_task_dates(uuid) to authenticated;
