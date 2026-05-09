-- 0080_project_attachments_comment_link.sql
-- Mirror task_attachments: add an optional FK from project_attachments to
-- project_comments so files dropped into a project chatter note (Odoo
-- mail.message on project.project) can be rendered alongside the note that
-- posted them. Attachments not tied to a comment (direct project uploads)
-- continue to work — task_comment_id is nullable.

alter table public.project_attachments
  add column if not exists project_comment_id uuid
    references public.project_comments(id) on delete set null;

create index if not exists idx_project_attachments_comment
  on public.project_attachments(project_comment_id)
  where project_comment_id is not null;
