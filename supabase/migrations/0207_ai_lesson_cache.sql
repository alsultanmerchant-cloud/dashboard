-- 0207 AI lesson cache (my-performance "learn from past misses")
-- =====================================================================
-- The /my-performance failure-lesson modal fired a Gemini call every time a
-- row was opened. Instead we persist the last generated lesson per
-- (org, employee, task) and re-serve it instantly; the agent presses
-- "Regenerate" to force a fresh one.
--
-- Invalidation:
--   * signature  — a hash of the task's failure inputs (delay / rework /
--                  time-in-stage). When the numbers move, the hash changes and
--                  the cache misses, so the lesson regenerates.
--   * generated_at < organizations.ai_knowledge_updated_at — a freshly-taught
--                  instruction makes older lessons stale (same rule the CEO
--                  brief / insights caches use).
-- One row per (org, employee, task). Written only by the service-role route.
-- =====================================================================

create table if not exists public.ai_lesson_cache (
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_profile_id uuid not null references public.employee_profiles(id) on delete cascade,
  task_id             uuid not null references public.tasks(id) on delete cascade,
  signature           text not null,
  model               text,
  result_json         jsonb not null,
  generated_at        timestamptz not null default now(),
  primary key (organization_id, employee_profile_id, task_id)
);

comment on table public.ai_lesson_cache is
  'Cached AI failure-lesson per (org, employee, task) for the /my-performance learn-from-past-misses modal. Re-served instead of re-calling Gemini; invalidated when signature changes (task metrics moved) or generated_at predates organizations.ai_knowledge_updated_at (instructions changed).';

alter table public.ai_lesson_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'ai_lesson_cache'
       and policyname = 'ai_lesson_cache_read'
  ) then
    create policy ai_lesson_cache_read
      on public.ai_lesson_cache
      for select to authenticated
      using (public.has_org_access(organization_id));
  end if;
end $$;
-- No write policy: written only by the service-role API route.
