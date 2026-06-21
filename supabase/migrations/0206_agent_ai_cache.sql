-- 0206 Agent AI cache
-- =====================================================================
-- The agent cockpit's AI cards (growth coach, technical tip, today's
-- priorities prose) used to fire a Gemini call on every dashboard mount.
-- That is wasteful and slow. Instead we persist the LAST generated result
-- per (employee, kind) and render it instantly on load; the agent presses
-- "re-analyse" to regenerate. The streamed object is saved by the client on
-- finish (POST /api/agent-ai-cache) through the service role.
--
-- One row per (org, employee, kind). payload is the surface-specific JSON
-- (growth_coach → {diagnosis, focusArea, actions}; tech_tip → {focusTip,
-- generalTip}; today_priorities → {items:[{taskId, reason, suggestedAction}]}).
-- =====================================================================

create table if not exists public.agent_ai_cache (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null,
  kind            text not null,            -- growth_coach | tech_tip | today_priorities
  payload         jsonb not null,
  generated_at    timestamptz not null default now(),
  primary key (organization_id, employee_id, kind)
);

alter table public.agent_ai_cache enable row level security;

-- Read is org-scoped; writes go through the service role (admin client) only,
-- so no write policy is defined.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'agent_ai_cache'
       and policyname = 'agent_ai_cache_read'
  ) then
    create policy agent_ai_cache_read
      on public.agent_ai_cache
      for select
      using (public.has_org_access(organization_id));
  end if;
end $$;
