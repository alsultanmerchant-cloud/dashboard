-- 0107_personal_events.sql
--
-- Sky Light §6.2: personal scheduling. Each employee can create their own
-- calendar events (reminders, internal meetings, time off, …) that show up
-- on the topbar calendar popover next to their task-driven activities.
--
-- Schema is intentionally minimal — title, date, optional note, color tag.
-- Time-of-day is captured in an optional `event_time` text field so we
-- don't have to commit to timestamptz semantics (timezone of "9 AM" for a
-- Saudi-only org is unambiguous; full timestamptz brings UTC-conversion
-- headaches without buying anything here).
--
-- RLS: user can only see/write their own events; no shared/team events in
-- this rev. Org admins with `personal_events.view_all` can see everything
-- for support — defaults off until a role grants it.

create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) >= 1),
  event_date date not null,
  -- Optional HH:MM time. NULL = all-day event.
  event_time text check (event_time is null or event_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  note text,
  -- Odoo color palette (0-11) so the dot/pill matches the rest of the UI.
  color int not null default 3 check (color between 0 and 11),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_events_user_date_idx
  on public.personal_events (user_id, event_date);

create index if not exists personal_events_org_date_idx
  on public.personal_events (organization_id, event_date);

-- updated_at trigger.
create or replace function public.touch_personal_event_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_personal_event_updated_at on public.personal_events;
create trigger trg_touch_personal_event_updated_at
  before update on public.personal_events
  for each row execute function public.touch_personal_event_updated_at();

alter table public.personal_events enable row level security;

drop policy if exists "personal_events_self_select" on public.personal_events;
create policy "personal_events_self_select"
  on public.personal_events
  for select
  using (
    auth.uid() = user_id
    or public.has_permission(organization_id, 'personal_events.view_all')
  );

drop policy if exists "personal_events_self_write" on public.personal_events;
create policy "personal_events_self_write"
  on public.personal_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.personal_events is
  'Per-user personal calendar events (reminders, meetings, time off). Sky Light §6.2.';
