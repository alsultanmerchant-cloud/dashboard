-- 0091_project_holidays.sql
--
-- Sky Light feedback #16: holiday/skip-date deadline shifting at both the
-- org level (already shipped in 0055 via public.holidays) AND a per-project
-- level so each engagement can carry its own blackouts (e.g. a client's
-- shutdown week, an event-launch freeze). When recalculate_project_task_dates
-- runs we want it to honor BOTH sets — org-wide holidays AND the project's
-- own blackouts.
--
-- Idempotent: tables/functions use `if not exists` / `create or replace`.

create table if not exists public.project_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  recurring boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint project_holidays_unique unique (project_id, holiday_date, name)
);

create index if not exists idx_project_holidays_project_date
  on public.project_holidays(project_id, holiday_date);

alter table public.project_holidays enable row level security;

drop policy if exists project_holidays_select on public.project_holidays;
create policy project_holidays_select on public.project_holidays
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists project_holidays_write on public.project_holidays;
create policy project_holidays_write on public.project_holidays
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  )
  with check (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  );

-- Project-aware working-day helpers. They wrap the org-level functions
-- from 0055 and additionally check public.project_holidays for project_id.
create or replace function public.is_working_day_for_project(
  p_org uuid,
  p_project uuid,
  p_date date
)
returns boolean
language sql
stable
as $$
  select
    -- Same Sun-Thu rule + org holidays as 0055.is_working_day...
    public.is_working_day(p_org, p_date)
    -- ...minus this project's own blackouts.
    and not exists (
      select 1 from public.project_holidays h
       where h.project_id = p_project
         and (
           (h.recurring = false and h.holiday_date = p_date)
           or (
             h.recurring = true
             and extract(month from h.holiday_date) = extract(month from p_date)
             and extract(day   from h.holiday_date) = extract(day   from p_date)
           )
         )
    );
$$;

create or replace function public.working_days_between_for_project(
  p_org uuid,
  p_project uuid,
  p_from date,
  p_to date
)
returns int
language sql
stable
as $$
  select case
    when p_to <= p_from then 0
    else (
      select count(*)::int
        from generate_series(p_from, p_to - 1, interval '1 day') as g(d)
       where public.is_working_day_for_project(p_org, p_project, g.d::date)
    )
  end;
$$;

create or replace function public.add_working_days_for_project(
  p_org uuid,
  p_project uuid,
  p_anchor date,
  p_days int
)
returns date
language plpgsql
stable
as $$
declare
  v_date date := p_anchor;
  v_remaining int := p_days;
  v_step int := case when p_days >= 0 then 1 else -1 end;
  v_iter int := 0;
  v_max constant int := 365 * 5;
begin
  if p_days = 0 then
    return v_date;
  end if;
  loop
    v_iter := v_iter + 1;
    exit when v_iter > v_max;
    v_date := v_date + v_step;
    if public.is_working_day_for_project(p_org, p_project, v_date) then
      v_remaining := v_remaining - v_step;
      if v_remaining = 0 then
        return v_date;
      end if;
    end if;
  end loop;
  raise exception 'add_working_days_for_project exceeded % iterations', v_max;
end;
$$;

-- Replace recalculate_project_task_dates to honor project blackouts.
-- Body is otherwise identical to 0055's version; only the working-day
-- helper calls change.
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
  v_anchor date;
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
          then public.working_days_between_for_project(v_org, p_project, v_tgt.start_date, v_tgt.planned_date)
        else 0
      end;

      v_target_start  := v_tgt.start_date;
      v_target_finish := v_tgt.planned_date;

      case v_link.dependency_type
        when 'finish_to_start' then
          if v_src.planned_date is not null then
            v_anchor := public.add_working_days_for_project(v_org, p_project, v_src.planned_date, greatest(v_link.lag_days, 1));
            v_target_start := greatest(coalesce(v_target_start, v_anchor), v_anchor);
            v_target_finish := public.add_working_days_for_project(v_org, p_project, v_target_start, v_duration);
          end if;
        when 'start_to_start' then
          if v_src.start_date is not null then
            v_anchor := case when v_link.lag_days = 0 then v_src.start_date
                             else public.add_working_days_for_project(v_org, p_project, v_src.start_date, v_link.lag_days) end;
            v_target_start := greatest(coalesce(v_target_start, v_anchor), v_anchor);
            v_target_finish := public.add_working_days_for_project(v_org, p_project, v_target_start, v_duration);
          end if;
        when 'finish_to_finish' then
          if v_src.planned_date is not null then
            v_anchor := case when v_link.lag_days = 0 then v_src.planned_date
                             else public.add_working_days_for_project(v_org, p_project, v_src.planned_date, v_link.lag_days) end;
            v_target_finish := greatest(coalesce(v_target_finish, v_anchor), v_anchor);
            v_target_start := public.add_working_days_for_project(v_org, p_project, v_target_finish, -v_duration);
          end if;
        when 'start_to_finish' then
          if v_src.start_date is not null then
            v_anchor := case when v_link.lag_days = 0 then v_src.start_date
                             else public.add_working_days_for_project(v_org, p_project, v_src.start_date, v_link.lag_days) end;
            v_target_finish := greatest(coalesce(v_target_finish, v_anchor), v_anchor);
            v_target_start := public.add_working_days_for_project(v_org, p_project, v_target_finish, -v_duration);
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

comment on function public.recalculate_project_task_dates(uuid) is
  'Recompute task dates respecting project_holidays AND org-wide holidays. Sky Light parity for feedback #16.';
