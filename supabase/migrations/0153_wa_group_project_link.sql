-- 0153 · Link WhatsApp groups → projects
-- Groups are mapped to a client today (0150). Most clients have exactly one
-- project, so a group also resolves to a single project. We persist that as an
-- explicit nullable FK so the link survives if a client later gains a 2nd
-- project, and so the mapping UI can override the auto-match.

alter table public.wa_group_links
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_wa_group_links_project
  on public.wa_group_links (organization_id, project_id);

comment on column public.wa_group_links.project_id is
  'Optional project this WhatsApp group belongs to (auto-matched by name on sync, manually overridable).';
