-- 0203 · WhatsApp group → MANY projects (multi-contract clients)
--
-- 0153 gave each group a single project_id, explicitly anticipating a client
-- gaining a 2nd project. That case is now real: a client who signs multiple
-- contracts runs multiple projects but shares ONE 💫 client group (and one 📍
-- team group PER project). A single project_id can't express "this group serves
-- projects A and B", so the shared client group could only ever satisfy one
-- project's coverage — the other was perpetually flagged as missing a group and
-- re-linking just re-pointed the same row. This join table lets one group link
-- to any number of projects.
--
-- wa_group_links.project_id is KEPT as the "primary" project (the first one
-- selected), mirrored from this table, so the satisfaction archived-status
-- resolver and any single-project reader keep working unchanged. This table is
-- the source of truth for project coverage and the mapping UI.

create table if not exists public.wa_group_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_link_id uuid not null references public.wa_group_links(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_link_id, project_id)
);

create index if not exists idx_wa_group_projects_group
  on public.wa_group_projects (group_link_id);
create index if not exists idx_wa_group_projects_project
  on public.wa_group_projects (organization_id, project_id);

-- Backfill: every existing single project_id becomes a join row.
insert into public.wa_group_projects (organization_id, group_link_id, project_id)
select organization_id, id, project_id
  from public.wa_group_links
 where project_id is not null
on conflict (group_link_id, project_id) do nothing;

-- RLS: read via has_org_access, write via clients.manage (mirrors wa_group_links).
alter table public.wa_group_projects enable row level security;

do $$
begin
  drop policy if exists wgp_select on public.wa_group_projects;
  drop policy if exists wgp_insert on public.wa_group_projects;
  drop policy if exists wgp_update on public.wa_group_projects;
  drop policy if exists wgp_delete on public.wa_group_projects;
  create policy wgp_select on public.wa_group_projects
    for select using (public.has_org_access(organization_id));
  create policy wgp_insert on public.wa_group_projects
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  create policy wgp_update on public.wa_group_projects
    for update using (public.has_permission(organization_id, 'clients.manage'));
  create policy wgp_delete on public.wa_group_projects
    for delete using (public.has_permission(organization_id, 'clients.manage'));
end $$;

comment on table public.wa_group_projects is
  'Many-to-many: a WhatsApp group can serve multiple projects of the same client (multi-contract clients). Source of truth for project coverage; wa_group_links.project_id mirrors the primary project.';
