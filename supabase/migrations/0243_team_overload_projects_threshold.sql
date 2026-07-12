-- 0243 — Configurable Team-Pulse overload threshold (by ACTIVE PROJECTS)
--
-- نبض الفريق «محمّل زائد» used to flag an agent from their open-task count vs the
-- team median WIP. The team wants it driven by how many ACTIVE PROJECTS a person
-- is juggling instead (a project is the real unit of context-switching load), and
-- the cutoff must be editable because the limit will change over time.
--
-- Reuses the generic per-org key→number store (kpi_settings, migration 0233).
-- Default 10 active projects; code (src/lib/data/kpi-settings.ts) falls back to
-- this same default when the row is absent, so a fresh org still renders.

insert into public.kpi_settings (organization_id, setting_key, setting_value)
select id, 'team_overload_projects_threshold', 10 from public.organizations
on conflict (organization_id, setting_key) do nothing;
