-- 0004_handover_notifications_audit.sql
-- Sales handover, notifications, audit logs, and AI events foundation.

-- =========================================================================
-- sales_handover_forms
-- =========================================================================
create table if not exists public.sales_handover_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  submitted_by uuid not null references auth.users(id) on delete set null,
  assigned_account_manager_employee_id uuid references public.employee_profiles(id) on delete set null,
  client_name text not null,
  client_contact_name text,
  client_phone text,
  client_email text,
  selected_service_ids uuid[] not null default '{}',
  package_details text,
  project_start_date date,
  urgency_level text not null default 'normal'
    check (urgency_level in ('low','normal','high','critical')),
  sales_notes text,
  status text not null default 'submitted'
    check (status in ('submitted','in_review','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_handover_org on public.sales_handover_forms(organization_id, created_at desc);
create index if not exists idx_handover_status on public.sales_handover_forms(organization_id, status);
create index if not exists idx_handover_am on public.sales_handover_forms(assigned_account_manager_employee_id);

create trigger trg_handover_updated_at
before update on public.sales_handover_forms
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- notifications
-- =========================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_employee_id uuid references public.employee_profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_employee_id is not null)
);

create index if not exists idx_notif_user_unread on public.notifications(recipient_user_id, created_at desc) where read_at is null;
create index if not exists idx_notif_employee on public.notifications(recipient_employee_id, created_at desc);
create index if not exists idx_notif_org on public.notifications(organization_id, created_at desc);

-- =========================================================================
-- audit_logs
-- =========================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_org on public.audit_logs(organization_id, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_actor on public.audit_logs(actor_user_id);

-- =========================================================================
-- ai_events
-- =========================================================================
create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  importance text not null default 'normal'
    check (importance in ('low','normal','high','critical')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_events_org on public.ai_events(organization_id, created_at desc);
create index if not exists idx_ai_events_type on public.ai_events(organization_id, event_type, created_at desc);
create index if not exists idx_ai_events_unprocessed on public.ai_events(organization_id, created_at) where processed_at is null;
