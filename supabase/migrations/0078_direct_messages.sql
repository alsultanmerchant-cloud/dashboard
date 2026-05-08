-- 0078_direct_messages.sql
-- Internal 1:1 DM between Sky Light staff. Triggered from any assignee chip
-- on the dashboard. Visibility: sender + recipient + anyone with the
-- existing org-wide read permission (heads/AMs already carry task.view_all,
-- so we reuse that signal for governance). Strict 1:1 — no group rooms.
-- Attachments stored in the existing 'attachments' bucket (mig. 0067) so
-- we don't add a second bucket. Auto-pruned after 90 days.

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_user_id   uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  body text,
  context_task_id uuid references public.tasks(id) on delete set null,
  context_project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint dm_self_check check (sender_user_id <> recipient_user_id)
);

create index if not exists idx_dm_conversation on public.direct_messages(
  organization_id,
  least(sender_user_id, recipient_user_id),
  greatest(sender_user_id, recipient_user_id),
  created_at desc
);
create index if not exists idx_dm_recipient_unread on public.direct_messages(
  recipient_user_id, read_at, created_at desc
) where read_at is null;
create index if not exists idx_dm_context_task on public.direct_messages(context_task_id) where context_task_id is not null;

create table if not exists public.direct_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  filename text not null,
  mimetype text,
  size_bytes bigint,
  storage_path text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_dm_attachments_message on public.direct_message_attachments(message_id);

alter table public.direct_messages enable row level security;
alter table public.direct_message_attachments enable row level security;

drop policy if exists dm_select on public.direct_messages;
create policy dm_select on public.direct_messages
  for select to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      sender_user_id = auth.uid()
      or recipient_user_id = auth.uid()
      or public.has_permission(organization_id, 'task.view_all')
    )
  );

drop policy if exists dm_insert on public.direct_messages;
create policy dm_insert on public.direct_messages
  for insert to authenticated
  with check (
    public.has_org_access(organization_id)
    and sender_user_id = auth.uid()
  );

drop policy if exists dm_update on public.direct_messages;
create policy dm_update on public.direct_messages
  for update to authenticated
  using (
    public.has_org_access(organization_id)
    and (sender_user_id = auth.uid() or recipient_user_id = auth.uid())
  )
  with check (
    public.has_org_access(organization_id)
    and (sender_user_id = auth.uid() or recipient_user_id = auth.uid())
  );

drop policy if exists dm_att_select on public.direct_message_attachments;
create policy dm_att_select on public.direct_message_attachments
  for select to authenticated
  using (
    public.has_org_access(organization_id)
    and exists (
      select 1 from public.direct_messages m
       where m.id = direct_message_attachments.message_id
         and (
           m.sender_user_id = auth.uid()
           or m.recipient_user_id = auth.uid()
           or public.has_permission(m.organization_id, 'task.view_all')
         )
    )
  );

drop policy if exists dm_att_insert on public.direct_message_attachments;
create policy dm_att_insert on public.direct_message_attachments
  for insert to authenticated
  with check (
    public.has_org_access(organization_id)
    and exists (
      select 1 from public.direct_messages m
       where m.id = direct_message_attachments.message_id
         and m.sender_user_id = auth.uid()
    )
  );

create or replace function public.prune_old_direct_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.direct_messages
   where created_at < now() - interval '90 days';
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'prune-direct-messages-daily') then
    perform cron.schedule(
      'prune-direct-messages-daily',
      '30 3 * * *',
      $cron$ select public.prune_old_direct_messages(); $cron$
    );
  end if;
end $$;
