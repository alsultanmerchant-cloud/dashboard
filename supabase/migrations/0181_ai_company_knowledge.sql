-- =========================================================================
-- 0181 — AI company knowledge (the "teach the AI" store).
--
-- The dashboard's AI prose (the CEO brief) sometimes states something wrong
-- because the model doesn't know enough about the company. From the dashboard
-- a team member can select that text and teach the assistant the correct fact.
-- The lesson is stored here as a durable instruction and injected into EVERY
-- future AI generation (CEO brief generation + the /agent system prompt), so
-- the same mistake never recurs.
--
-- Unlike ai_conversations/ai_messages (per-user chat history), these rows are
-- org-wide, team-authored, and read back into prompts. Mirrors the RLS style
-- of ceo_brief_runs (0171): team-readable/writable via has_org_access.
-- =========================================================================

create table if not exists public.ai_company_knowledge (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- what kind of durable instruction this is
  kind text not null default 'correction'
    check (kind in ('correction', 'fact', 'preference', 'terminology')),
  -- the durable instruction text injected into future prompts (generalized)
  instruction text not null,
  -- optional provenance: which brief field + the wrong/corrected text
  source_field text null,        -- e.g. 'headline' | 'bottomLine' | 'rec:0' | 'risk:client_churn'
  wrong_text text null,          -- the selected text that was wrong
  corrected_text text null,      -- what it should have said (when a correction)
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_company_knowledge_org_active_idx
  on public.ai_company_knowledge (organization_id, is_active, created_at desc);

alter table public.ai_company_knowledge enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_company_knowledge'
      and policyname = 'ai_company_knowledge_select_org'
  ) then
    create policy "ai_company_knowledge_select_org"
      on public.ai_company_knowledge for select to authenticated
      using (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_company_knowledge'
      and policyname = 'ai_company_knowledge_insert_org'
  ) then
    create policy "ai_company_knowledge_insert_org"
      on public.ai_company_knowledge for insert to authenticated
      with check (public.has_org_access(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_company_knowledge'
      and policyname = 'ai_company_knowledge_update_org'
  ) then
    create policy "ai_company_knowledge_update_org"
      on public.ai_company_knowledge for update to authenticated
      using (public.has_org_access(organization_id))
      with check (public.has_org_access(organization_id));
  end if;
end $$;
