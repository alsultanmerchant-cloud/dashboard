create table if not exists public.contract_sheet_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_key text not null,
  contract_id uuid null references public.contracts(id) on delete set null,
  client_external_id text null,
  client_name text null,
  account_manager text null,
  log_type text not null,
  log_time timestamptz null,
  notes text null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.contract_sheet_logs'::regclass
      and conname = 'contract_sheet_logs_org_key_type_time_key'
  ) then
    alter table public.contract_sheet_logs
      add constraint contract_sheet_logs_org_key_type_time_key
      unique (organization_id, contract_key, log_type, log_time);
  end if;
end $$;

create index if not exists contract_sheet_logs_org_time_idx
  on public.contract_sheet_logs (organization_id, log_time desc);

create index if not exists contract_sheet_logs_contract_id_idx
  on public.contract_sheet_logs (contract_id);

create index if not exists contract_sheet_logs_org_type_idx
  on public.contract_sheet_logs (organization_id, log_type);

alter table public.contract_sheet_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'contract_sheet_logs'
      and policyname = 'contract_sheet_logs_select_org_access'
  ) then
    create policy contract_sheet_logs_select_org_access
      on public.contract_sheet_logs
      for select
      to authenticated
      using (public.has_org_access(organization_id));
  end if;
end $$;
