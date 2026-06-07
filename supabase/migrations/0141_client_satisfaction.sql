-- 0141 Client satisfaction from imported WhatsApp group chats.
--
-- Each client runs two WhatsApp groups: 'client' (direct comms with the
-- customer) and 'technical' (internal team coordination + brief). We import
-- the text-only transcript (WhatsApp "export without media" .txt), store it,
-- and let AI distill a satisfaction + brief-adherence signal that feeds the
-- Execution Quality executive index and the per-client satisfaction view.

-- ---- Raw imported transcripts -------------------------------------------
create table if not exists public.client_chat_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  group_kind text not null check (group_kind in ('client', 'technical')),
  source_filename text,
  message_count integer not null default 0,
  participant_count integer not null default 0,
  first_message_at timestamptz,
  last_message_at timestamptz,
  transcript text not null default '',
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_cci_org_client
  on public.client_chat_imports (organization_id, client_id, group_kind, created_at desc);

-- ---- AI analysis (latest per client = is_current) ------------------------
create table if not exists public.client_satisfaction_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  satisfaction_score integer check (satisfaction_score between 0 and 100),
  brief_adherence_score integer check (brief_adherence_score between 0 and 100),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  summary text,
  highlights jsonb not null default '[]'::jsonb,
  sentiment_timeline jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  model text,
  client_import_id uuid references public.client_chat_imports(id) on delete set null,
  technical_import_id uuid references public.client_chat_imports(id) on delete set null,
  is_current boolean not null default true,
  analyzed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_csa_org_client_current
  on public.client_satisfaction_analyses (organization_id, client_id, is_current);

-- ---- RLS: read via has_org_access, write via clients.manage --------------
alter table public.client_chat_imports enable row level security;
alter table public.client_satisfaction_analyses enable row level security;

do $$
begin
  -- client_chat_imports
  drop policy if exists cci_select on public.client_chat_imports;
  drop policy if exists cci_insert on public.client_chat_imports;
  drop policy if exists cci_update on public.client_chat_imports;
  drop policy if exists cci_delete on public.client_chat_imports;
  create policy cci_select on public.client_chat_imports
    for select using (public.has_org_access(organization_id));
  create policy cci_insert on public.client_chat_imports
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  create policy cci_update on public.client_chat_imports
    for update using (public.has_permission(organization_id, 'clients.manage'));
  create policy cci_delete on public.client_chat_imports
    for delete using (public.has_permission(organization_id, 'clients.manage'));

  -- client_satisfaction_analyses
  drop policy if exists csa_select on public.client_satisfaction_analyses;
  drop policy if exists csa_insert on public.client_satisfaction_analyses;
  drop policy if exists csa_update on public.client_satisfaction_analyses;
  drop policy if exists csa_delete on public.client_satisfaction_analyses;
  create policy csa_select on public.client_satisfaction_analyses
    for select using (public.has_org_access(organization_id));
  create policy csa_insert on public.client_satisfaction_analyses
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  create policy csa_update on public.client_satisfaction_analyses
    for update using (public.has_permission(organization_id, 'clients.manage'));
  create policy csa_delete on public.client_satisfaction_analyses
    for delete using (public.has_permission(organization_id, 'clients.manage'));
end $$;
