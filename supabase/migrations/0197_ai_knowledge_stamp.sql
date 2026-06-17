-- 0197_ai_knowledge_stamp.sql
--
-- "Apply taught instructions everywhere." When the team teaches / edits /
-- toggles / removes an AI instruction (ai_company_knowledge), every cached AI
-- analysis that was generated BEFORE the change is now built on stale guidance
-- and must regenerate so the new instruction actually takes effect.
--
-- Rather than add a knowledge-version column to every analysis table, we stamp
-- the org with the moment its knowledge last changed. Each cached surface
-- (CEO brief, AI insights, client satisfaction) compares its own run time to
-- this stamp and treats itself as stale when older — then regenerates lazily
-- on next view (cheap singletons) or surfaces a "re-analyze" affordance
-- (the per-client satisfaction analyses, too many to regenerate eagerly).

alter table public.organizations
  add column if not exists ai_knowledge_updated_at timestamptz not null default now();

comment on column public.organizations.ai_knowledge_updated_at is
  'Bumped by trg_ai_knowledge_stamp on any ai_company_knowledge mutation. Cached AI analyses generated before this are stale and regenerate.';

create or replace function public.bump_ai_knowledge_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  v_org := coalesce(NEW.organization_id, OLD.organization_id);
  if v_org is not null then
    update public.organizations
       set ai_knowledge_updated_at = now()
     where id = v_org;
  end if;
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_ai_knowledge_stamp on public.ai_company_knowledge;
create trigger trg_ai_knowledge_stamp
  after insert or update or delete on public.ai_company_knowledge
  for each row execute function public.bump_ai_knowledge_stamp();

-- Backfill: seed each org's stamp from its most-recent knowledge change so
-- existing analyses are only stale if a lesson is genuinely newer than them.
update public.organizations o
   set ai_knowledge_updated_at = coalesce(
     (select max(greatest(k.created_at, k.updated_at))
        from public.ai_company_knowledge k
       where k.organization_id = o.id),
     o.created_at,
     now());
