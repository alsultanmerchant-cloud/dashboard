-- 0055_working_calendar.sql
-- Saudi work week (Sun-Thu) + per-org holidays. Replaces the plain
-- day-arithmetic in recalculate_project_task_dates with working-day
-- arithmetic so lag/duration honor weekends and holidays.
--
-- Postgres dow values: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
-- Working days = dow in (0,1,2,3,4) minus holidays.

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  recurring boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint holidays_org_date_unique unique (organization_id, holiday_date, name)
);

create index if not exists idx_holidays_org_date
  on public.holidays(organization_id, holiday_date);

alter table public.holidays enable row level security;

drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays
  for select to authenticated
  using (public.has_org_access(organization_id));

drop policy if exists holidays_write on public.holidays;
create policy holidays_write on public.holidays
  for all to authenticated
  using (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  )
  with check (
    public.has_org_access(organization_id)
    and public.has_permission(organization_id, 'projects.manage')
  );

create or replace function public.is_working_day(p_org uuid, p_date date)
returns boolean
language sql
stable
as $$
  select
    extract(dow from p_date)::int in (0,1,2,3,4)
    and not exists (
      select 1 from public.holidays h
       where h.organization_id = p_org
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

create or replace function public.working_days_between(p_org uuid, p_from date, p_to date)
returns int
language sql
stable
as $$
  select case
    when p_to <= p_from then 0
    else (
      select count(*)::int
        from generate_series(p_from, p_to - 1, interval '1 day') as g(d)
       where public.is_working_day(p_org, g.d::date)
    )
  end;
$$;

create or replace function public.add_working_days(p_org uuid, p_anchor date, p_days int)
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
    if public.is_working_day(p_org, v_date) then
      v_remaining := v_remaining - v_step;
      if v_remaining = 0 then
        return v_date;
      end if;
    end if;
  end loop;
  raise exception 'add_working_days exceeded % iterations', v_max;
end;
$$;

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
          then public.working_days_between(v_org, v_tgt.start_date, v_tgt.planned_date)
        else 0
      end;

      v_target_start  := v_tgt.start_date;
      v_target_finish := v_tgt.planned_date;

      case v_link.dependency_type
        when 'finish_to_start' then
          if v_src.planned_date is not null then
            v_anchor := public.add_working_days(v_org, v_src.planned_date, greatest(v_link.lag_days, 1));
            v_target_start := greatest(coalesce(v_target_start, v_anchor), v_anchor);
            v_target_finish := public.add_working_days(v_org, v_target_start, v_duration);
          end if;
        when 'start_to_start' then
          if v_src.start_date is not null then
            v_anchor := case when v_link.lag_days = 0 then v_src.start_date
                             else public.add_working_days(v_org, v_src.start_date, v_link.lag_days) end;
            v_target_start := greatest(coalesce(v_target_start, v_anchor), v_anchor);
            v_target_finish := public.add_working_days(v_org, v_target_start, v_duration);
          end if;
        when 'finish_to_finish' then
          if v_src.planned_date is not null then
            v_anchor := case when v_link.lag_days = 0 then v_src.planned_date
                             else public.add_working_days(v_org, v_src.planned_date, v_link.lag_days) end;
            v_target_finish := greatest(coalesce(v_target_finish, v_anchor), v_anchor);
            v_target_start := public.add_working_days(v_org, v_target_finish, -v_duration);
          end if;
        when 'start_to_finish' then
          if v_src.start_date is not null then
            v_anchor := case when v_link.lag_days = 0 then v_src.start_date
                             else public.add_working_days(v_org, v_src.start_date, v_link.lag_days) end;
            v_target_finish := greatest(coalesce(v_target_finish, v_anchor), v_anchor);
            v_target_start := public.add_working_days(v_org, v_target_finish, -v_duration);
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
