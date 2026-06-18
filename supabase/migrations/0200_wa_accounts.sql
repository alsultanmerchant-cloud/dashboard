-- 0200 Multi-WhatsApp-number registry (wa_accounts) + message provenance.
--
-- The dashboard can connect MORE THAN ONE WhatsApp number to the same OpenWA
-- gateway. Each connected number is one gateway session, recorded here. All
-- numbers sit in the same client groups, so their message coverage is UNIONED:
-- the wa_messages unique (organization_id, chat_id, wa_message_id) constraint
-- dedups the same WA message seen by two numbers (it keys on the stable bare id
-- per migration 0199). This table is a provenance + onboarding registry only;
-- it does NOT participate in dedup.

create table if not exists public.wa_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id      text not null,            -- OpenWA session *name* (what we POST as {name})
  phone           text,                     -- connected number, filled once status=CONNECTED
  label           text,                     -- human label e.g. "رقم خدمة العملاء"
  is_active       boolean not null default true,
  status          text not null default 'NOT_CREATED',  -- mirrors WaSessionStatus union
  last_seen_at    timestamptz,              -- last inbound event attributed to this account
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, session_id)
);

create index if not exists idx_wa_accounts_org
  on public.wa_accounts (organization_id, is_active);

-- Provenance: first number that DELIVERED each message. Nullable. MUST NOT be
-- added to the dedup unique constraint — dedup stays account-blind so two
-- numbers' coverage collapses to one row. The first number to land a given
-- (org, chat, wa_message_id) wins this stamp; later duplicates are ignored.
alter table public.wa_messages
  add column if not exists first_seen_account_id uuid references public.wa_accounts(id) on delete set null;

create index if not exists idx_wa_messages_first_seen_account
  on public.wa_messages (first_seen_account_id);

-- ---- RLS: read via has_org_access, write via clients.manage --------------
alter table public.wa_accounts enable row level security;

do $$
begin
  drop policy if exists wac_select on public.wa_accounts;
  drop policy if exists wac_insert on public.wa_accounts;
  drop policy if exists wac_update on public.wa_accounts;
  drop policy if exists wac_delete on public.wa_accounts;
  create policy wac_select on public.wa_accounts
    for select using (public.has_org_access(organization_id));
  create policy wac_insert on public.wa_accounts
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  create policy wac_update on public.wa_accounts
    for update using (public.has_permission(organization_id, 'clients.manage'));
  create policy wac_delete on public.wa_accounts
    for delete using (public.has_permission(organization_id, 'clients.manage'));
end $$;
