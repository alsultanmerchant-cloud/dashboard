-- 0233 — Configurable KPI thresholds (Executive Indicators spec §9)
--
-- Generic per-org key→number store so business thresholds live in data, not
-- hardcoded constants. First consumer: projects_at_risk_threshold (default 5).

create table if not exists public.kpi_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  setting_key     text not null,
  setting_value   numeric not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  primary key (organization_id, setting_key)
);

alter table public.kpi_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'kpi_settings'
       and policyname = 'kpi_settings_read'
  ) then
    create policy kpi_settings_read on public.kpi_settings
      for select using (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'kpi_settings'
       and policyname = 'kpi_settings_write'
  ) then
    create policy kpi_settings_write on public.kpi_settings
      for all
      using (public.has_permission(organization_id, 'settings.manage'))
      with check (public.has_permission(organization_id, 'settings.manage'));
  end if;
end $$;

-- Seed the default threshold for every existing org.
insert into public.kpi_settings (organization_id, setting_key, setting_value)
select id, 'projects_at_risk_threshold', 5 from public.organizations
on conflict (organization_id, setting_key) do nothing;
