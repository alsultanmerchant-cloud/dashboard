-- 0142 Live WhatsApp ingestion (OpenWA gateway → dashboard).
--
-- An external OpenWA service (self-hosted, one dedicated WhatsApp number)
-- pushes group messages to /api/wa/webhook. We store every message in
-- `wa_messages` (idempotent on the WA message id) and map each chat to a
-- client + group kind via `wa_group_links`. Transcripts are rebuilt on
-- demand from these rows (merged with any one-time .txt import) and fed to
-- the existing satisfaction analysis.

-- ---- chat → client mapping ----------------------------------------------
create table if not exists public.wa_group_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chat_id text not null,                  -- WhatsApp group id e.g. "12036...@g.us"
  chat_name text,                         -- cached group subject from OpenWA
  client_id uuid references public.clients(id) on delete set null,
  group_kind text check (group_kind in ('client', 'technical')),
  is_active boolean not null default true,
  last_message_at timestamptz,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, chat_id)
);

create index if not exists idx_wa_group_links_client
  on public.wa_group_links (organization_id, client_id);

-- ---- raw messages --------------------------------------------------------
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chat_id text not null,
  wa_message_id text not null,            -- OpenWA/whatsapp-web.js message id (dedup key)
  client_id uuid references public.clients(id) on delete set null,
  group_kind text check (group_kind in ('client', 'technical')),
  sender text,                            -- display name / number of author
  sender_id text,
  body text not null default '',
  message_type text,                      -- chat, image, ptt, ... (we analyze text)
  is_from_me boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, chat_id, wa_message_id)
);

create index if not exists idx_wa_messages_client_time
  on public.wa_messages (organization_id, client_id, group_kind, sent_at);
create index if not exists idx_wa_messages_chat_time
  on public.wa_messages (organization_id, chat_id, sent_at);

-- ---- RLS: read via has_org_access, write via clients.manage --------------
alter table public.wa_group_links enable row level security;
alter table public.wa_messages enable row level security;

do $$
begin
  drop policy if exists wgl_select on public.wa_group_links;
  drop policy if exists wgl_insert on public.wa_group_links;
  drop policy if exists wgl_update on public.wa_group_links;
  drop policy if exists wgl_delete on public.wa_group_links;
  create policy wgl_select on public.wa_group_links
    for select using (public.has_org_access(organization_id));
  create policy wgl_insert on public.wa_group_links
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  create policy wgl_update on public.wa_group_links
    for update using (public.has_permission(organization_id, 'clients.manage'));
  create policy wgl_delete on public.wa_group_links
    for delete using (public.has_permission(organization_id, 'clients.manage'));

  drop policy if exists wam_select on public.wa_messages;
  create policy wam_select on public.wa_messages
    for select using (public.has_org_access(organization_id));
  -- writes happen only via the service-role webhook (bypasses RLS); no
  -- client-facing insert/update/delete policies on purpose.
end $$;
