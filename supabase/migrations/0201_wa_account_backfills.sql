-- 0201 Per-account history backfill tracking (resumable).
--
-- wa_group_links.history_imported_at is a PER-GROUP marker: once the primary
-- number seeds a group, no other number could ever backfill it — even though a
-- newly-added older number may hold history the primary lacks (the whole point
-- of multi-number coverage). This table tracks backfill completion per
-- (account, group) so EACH connected number can pull its own history once, and
-- re-runs are resumable. Ingest still dedups on the bare id, so a number's
-- backfill only ADDS the messages the pool is missing.

create table if not exists public.wa_account_backfills (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id      uuid not null references public.wa_accounts(id) on delete cascade,
  chat_id         text not null,
  imported_count  integer not null default 0,   -- new rows this account contributed
  imported_at     timestamptz not null default now(),
  unique (account_id, chat_id)
);

create index if not exists idx_wa_account_backfills_org_account
  on public.wa_account_backfills (organization_id, account_id);

-- ---- RLS: read via has_org_access, write via clients.manage --------------
alter table public.wa_account_backfills enable row level security;

do $$
begin
  drop policy if exists wab_select on public.wa_account_backfills;
  drop policy if exists wab_insert on public.wa_account_backfills;
  drop policy if exists wab_update on public.wa_account_backfills;
  drop policy if exists wab_delete on public.wa_account_backfills;
  create policy wab_select on public.wa_account_backfills
    for select using (public.has_org_access(organization_id));
  create policy wab_insert on public.wa_account_backfills
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  create policy wab_update on public.wa_account_backfills
    for update using (public.has_permission(organization_id, 'clients.manage'));
  create policy wab_delete on public.wa_account_backfills
    for delete using (public.has_permission(organization_id, 'clients.manage'));
end $$;
