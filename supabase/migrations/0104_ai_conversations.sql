-- 0104_ai_conversations.sql
--
-- Sky Light feedback §9.2: AI conversations currently live in sessionStorage
-- and get wiped on logout / tab close. Move persistence to the DB, scoped
-- per user, so threads survive sessions and devices.
--
-- Schema:
--   • ai_conversations — one row per thread, owned by a user inside the org.
--   • ai_messages      — append-only log of every message in a thread (role
--                        + JSONB content so we can carry tool calls/results
--                        verbatim from the Vercel AI SDK UI format).
--
-- RLS: a user can only see/write their own conversations. Org-level admins
-- (with `ai.view_all`) can also see all conversations inside their org for
-- support/auditing — gated by the helper, defaults to off until the role
-- explicitly grants it.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_org_user_idx
  on public.ai_conversations (organization_id, user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  -- Full Vercel-AI-SDK UI message in JSONB. Carries text parts, tool calls,
  -- tool results, and any future part types without schema migrations.
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at asc);

-- Bump updated_at on the parent whenever a new message lands so the
-- conversation list can sort by recent activity.
create or replace function public.touch_ai_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_ai_conversation_updated_at on public.ai_messages;
create trigger trg_touch_ai_conversation_updated_at
  after insert on public.ai_messages
  for each row execute function public.touch_ai_conversation_updated_at();

-- RLS.
alter table public.ai_conversations enable row level security;
alter table public.ai_messages       enable row level security;

drop policy if exists "ai_conversations_self_select" on public.ai_conversations;
create policy "ai_conversations_self_select"
  on public.ai_conversations
  for select
  using (
    auth.uid() = user_id
    or public.has_permission(organization_id, 'ai.view_all')
  );

drop policy if exists "ai_conversations_self_write" on public.ai_conversations;
create policy "ai_conversations_self_write"
  on public.ai_conversations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_messages_via_conversation_select" on public.ai_messages;
create policy "ai_messages_via_conversation_select"
  on public.ai_messages
  for select
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id
        and (
          auth.uid() = c.user_id
          or public.has_permission(c.organization_id, 'ai.view_all')
        )
    )
  );

drop policy if exists "ai_messages_via_conversation_write" on public.ai_messages;
create policy "ai_messages_via_conversation_write"
  on public.ai_messages
  for all
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and auth.uid() = c.user_id
    )
  )
  with check (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and auth.uid() = c.user_id
    )
  );

comment on table public.ai_conversations is
  'Persistent AI assistant conversations, one per thread per user. Sky Light §9.2.';
comment on table public.ai_messages is
  'Append-only log of AI assistant messages. content is the full Vercel AI SDK UI message (text + tool parts) in JSONB.';
