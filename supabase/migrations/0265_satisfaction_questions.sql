-- Questions queue ("أسئلة تحتاج إجابة") for the satisfaction status refresh.
--
-- When the refresh pass (src/lib/satisfaction-refresh.ts) can't judge a
-- still-open finding — an `unclear` verdict, including a `resolved` verdict
-- downgraded for lacking a verifiable citation — it persists ONE open question
-- per (org, client, issue) asking the team exactly what it needs to know.
-- A human answer either closes the issue everywhere (outcome=resolved → the
-- standard overlay ai_event) or becomes documented ground truth for the next
-- passes (outcome=still_open).
--
-- status:
--   open          — awaiting a human answer
--   answered      — a human answered (answer / answer_outcome / answered_by set)
--   auto_resolved — the issue became overlay-resolved by other means
--   dismissed     — reserved for a manual dismiss control
-- Idempotent. RLS read via has_org_access; writes via has_permission
-- 'clients.manage' (the API routes themselves use the service role).

create table if not exists public.satisfaction_questions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  analysis_id      uuid references public.client_satisfaction_analyses(id) on delete set null,
  kind             text not null check (kind in ('recommendation','risk','accountability')),
  issue            text not null,
  question         text not null,
  context          text,
  responsible_name text,
  task_codes       text[] not null default '{}',
  status           text not null default 'open' check (status in ('open','answered','auto_resolved','dismissed')),
  answer           text,
  answer_outcome   text check (answer_outcome in ('resolved','still_open')),
  answered_by      uuid,
  answered_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One OPEN question per issue per client — re-detections never duplicate.
create unique index if not exists satisfaction_questions_open_issue_uidx
  on public.satisfaction_questions (organization_id, client_id, md5(issue))
  where status = 'open';
create index if not exists satisfaction_questions_org_status_idx
  on public.satisfaction_questions (organization_id, status, created_at desc);
create index if not exists satisfaction_questions_org_client_idx
  on public.satisfaction_questions (organization_id, client_id, status);

alter table public.satisfaction_questions enable row level security;

do $$
begin
  drop policy if exists satisfaction_questions_select on public.satisfaction_questions;
  create policy satisfaction_questions_select on public.satisfaction_questions
    for select using (public.has_org_access(organization_id));
  drop policy if exists satisfaction_questions_insert on public.satisfaction_questions;
  create policy satisfaction_questions_insert on public.satisfaction_questions
    for insert with check (public.has_permission(organization_id, 'clients.manage'));
  drop policy if exists satisfaction_questions_update on public.satisfaction_questions;
  create policy satisfaction_questions_update on public.satisfaction_questions
    for update using (public.has_permission(organization_id, 'clients.manage'));
  drop policy if exists satisfaction_questions_delete on public.satisfaction_questions;
  create policy satisfaction_questions_delete on public.satisfaction_questions
    for delete using (public.has_permission(organization_id, 'clients.manage'));
end $$;

drop trigger if exists tg_satisfaction_questions_updated_at on public.satisfaction_questions;
create trigger tg_satisfaction_questions_updated_at
  before update on public.satisfaction_questions
  for each row execute function public.tg_set_updated_at();
