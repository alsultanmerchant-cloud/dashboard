-- 0166_wa_link_suggestions.sql
--
-- Confirmation queue for auto-suggested WhatsApp group → client/project links.
-- The auto-linker keeps APPLYING exact/high matches directly (settled behaviour),
-- but LOW-confidence matches — previously dropped silently — are now parked here
-- as a suggestion the operator confirms or rejects, so an uncertain guess never
-- silently pollutes the live link / satisfaction transcripts.
--
-- A row carries a pending suggestion when suggested_client_id is not null,
-- client_id is still null (not yet linked), and suggestion_dismissed_at is null.
-- Confirm → copy suggested_* onto client_id/project_id and clear the triplet.
-- Reject → set suggestion_dismissed_at and clear the triplet (won't re-suggest).

alter table public.wa_group_links
  add column if not exists suggested_client_id uuid references public.clients(id) on delete set null,
  add column if not exists suggested_project_id uuid references public.projects(id) on delete set null,
  add column if not exists suggested_confidence text check (suggested_confidence in ('exact', 'high', 'low')),
  add column if not exists suggested_at timestamptz,
  add column if not exists suggestion_dismissed_at timestamptz;

-- Pending-suggestion lookups (the confirmation queue) hit only unlinked rows.
create index if not exists wa_group_links_pending_suggestion_idx
  on public.wa_group_links (organization_id)
  where suggested_client_id is not null and client_id is null and suggestion_dismissed_at is null;
