-- 0099_project_log_notes.sql
-- Project-level log notes (Sky Light spec). These are NOT task-scoped:
-- they record meeting notes, blockers, client decisions, and other
-- project-wide context that doesn't belong on any one task.
--
-- RLS mirrors the project itself — anyone with org access can read; only
-- the author or someone with `projects.manage` can edit/delete. We keep
-- created_at + updated_at so the UI can mark edited entries.

create table if not exists public.project_log_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_log_notes_project
  on public.project_log_notes (project_id, created_at desc);

create index if not exists idx_project_log_notes_org
  on public.project_log_notes (organization_id);

create trigger trg_project_log_notes_updated_at
before update on public.project_log_notes
for each row execute function public.tg_set_updated_at();

alter table public.project_log_notes enable row level security;

drop policy if exists project_log_notes_select on public.project_log_notes;
create policy project_log_notes_select on public.project_log_notes
for select to authenticated
using (public.has_org_access(organization_id));

drop policy if exists project_log_notes_insert on public.project_log_notes;
create policy project_log_notes_insert on public.project_log_notes
for insert to authenticated
with check (
  public.has_org_access(organization_id)
  and author_user_id = auth.uid()
);

drop policy if exists project_log_notes_update on public.project_log_notes;
create policy project_log_notes_update on public.project_log_notes
for update to authenticated
using (
  public.has_org_access(organization_id)
  and (
    author_user_id = auth.uid()
    or public.has_permission(organization_id, 'projects.manage')
  )
)
with check (
  public.has_org_access(organization_id)
  and (
    author_user_id = auth.uid()
    or public.has_permission(organization_id, 'projects.manage')
  )
);

drop policy if exists project_log_notes_delete on public.project_log_notes;
create policy project_log_notes_delete on public.project_log_notes
for delete to authenticated
using (
  public.has_org_access(organization_id)
  and (
    author_user_id = auth.uid()
    or public.has_permission(organization_id, 'projects.manage')
  )
);
