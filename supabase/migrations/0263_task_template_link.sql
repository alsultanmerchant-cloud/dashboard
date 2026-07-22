-- 0263_task_template_link.sql
-- =====================================================================
-- Durable task -> template-item association.
--
-- Root cause this fixes: accountability reads `tasks.stage_owner_positions`,
-- which was (re)derived at runtime by resolveStageOwnersForOrg via a heuristic
-- title match with a *service-mode fallback* — and the refresh cron was never
-- scheduled. So design tasks filed under the Social service froze on the
-- social mode-map (in_progress/client_changes -> specialist), billing the
-- designer's execution stages to the social specialist (team feedback:
-- علية غنيم / ايمن مجدي wrongly charged for قيد التنفيذ / تعديلات العميل).
--
-- Fix: store the resolved template item as an explicit FK on the task, matched
-- deterministically (Odoo copies the template name verbatim at generation, so
-- ~90% of tasks exact-match by service + normalised title). The owner map is
-- then derived from the LINKED item, not guessed per-service. Unmatched /
-- ad-hoc tasks are flagged instead of silently mis-attributed.
--
--   task_template_item_id   -> the matched template item (source of ownership)
--   template_match_status   -> how it was matched (see enum-ish text values)
--   template_match_confidence -> 1.0 exact/alias, <1 fuzzy, null for none
--   template_matched_at     -> when the link was last (re)computed
--
-- task_template_aliases: human-confirmed (service, normalised title) -> item
-- overrides. Every review-queue resolution writes one, so a renamed task is
-- matched deterministically forever after (the match rate climbs, never decays).
-- =====================================================================

alter table public.tasks
  add column if not exists task_template_item_id uuid
    references public.task_template_items(id) on delete set null,
  add column if not exists template_match_status text,
  add column if not exists template_match_confidence numeric,
  add column if not exists template_matched_at timestamptz;

-- Match status vocabulary (kept as text + check so it is trivially extensible):
--   linked_exact  service + normalised title matched one item
--   linked_alias  matched via a human-confirmed alias row
--   linked_fuzzy  token-set similarity above threshold with clear margin
--   manual        an operator pinned this link explicitly
--   ambiguous     >1 candidate item with DIFFERENT owner maps — needs review
--   unmatched     has a service but no candidate — needs review
--   ad_hoc        no service_id — a genuine one-off task, no template expected
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_template_match_status_chk'
  ) then
    alter table public.tasks
      add constraint tasks_template_match_status_chk
      check (template_match_status is null or template_match_status in (
        'linked_exact','linked_alias','linked_fuzzy','manual',
        'ambiguous','unmatched','ad_hoc'
      ));
  end if;
end $$;

create index if not exists tasks_template_item_id_idx
  on public.tasks (task_template_item_id)
  where task_template_item_id is not null;

create index if not exists tasks_template_match_status_idx
  on public.tasks (organization_id, template_match_status);

create table if not exists public.task_template_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade,
  norm_title text not null,
  task_template_item_id uuid not null references public.task_template_items(id) on delete cascade,
  note text,
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One alias per (org, service, normalised title). service_id NULL matches
-- title-only (rare; used for cross-service manual pins).
create unique index if not exists task_template_aliases_uniq
  on public.task_template_aliases (
    organization_id,
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    norm_title
  );

comment on column public.tasks.task_template_item_id is
  'Resolved template item (source of stage_owner_positions). Set by matchTemplatesForOrg at sync time. NULL when unmatched/ad_hoc.';
comment on column public.tasks.template_match_status is
  'How task_template_item_id was resolved: linked_exact|linked_alias|linked_fuzzy|manual|ambiguous|unmatched|ad_hoc.';
comment on table public.task_template_aliases is
  'Human-confirmed (service, normalised title) -> template item overrides fed by the review queue; makes drifted-title tasks match deterministically.';
