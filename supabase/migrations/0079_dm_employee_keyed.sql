-- 0079_dm_employee_keyed.sql
-- Reality check: most Sky Light employees haven't logged into the new
-- dashboard yet, so employee_profiles.user_id is null on the majority of
-- the 115 imported staff rows. The original DM schema (mig. 0078) keyed
-- by auth.users which made every recipient invalid. Re-key both ends to
-- employee_profiles.id; user_id is auto-resolved at notification time.

alter table public.direct_messages
  add column if not exists sender_employee_id   uuid references public.employee_profiles(id) on delete cascade,
  add column if not exists recipient_employee_id uuid references public.employee_profiles(id) on delete cascade;

update public.direct_messages d
   set sender_employee_id = es.id,
       recipient_employee_id = er.id
  from public.employee_profiles es,
       public.employee_profiles er
 where es.user_id = d.sender_user_id
   and er.user_id = d.recipient_user_id
   and (d.sender_employee_id is null or d.recipient_employee_id is null);

alter table public.direct_messages alter column sender_employee_id set not null;
alter table public.direct_messages alter column recipient_employee_id set not null;
alter table public.direct_messages alter column sender_user_id drop not null;
alter table public.direct_messages alter column recipient_user_id drop not null;

drop index if exists idx_dm_conversation;
create index if not exists idx_dm_conversation on public.direct_messages(
  organization_id,
  least(sender_employee_id, recipient_employee_id),
  greatest(sender_employee_id, recipient_employee_id),
  created_at desc
);

alter table public.direct_messages drop constraint if exists dm_self_check;
alter table public.direct_messages add constraint dm_self_check
  check (sender_employee_id <> recipient_employee_id);

drop policy if exists dm_select on public.direct_messages;
create policy dm_select on public.direct_messages
  for select to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      exists (
        select 1 from public.employee_profiles ep
         where ep.user_id = auth.uid()
           and (ep.id = direct_messages.sender_employee_id
                or ep.id = direct_messages.recipient_employee_id)
      )
      or public.has_permission(organization_id, 'task.view_all')
    )
  );

drop policy if exists dm_insert on public.direct_messages;
create policy dm_insert on public.direct_messages
  for insert to authenticated
  with check (
    public.has_org_access(organization_id)
    and exists (
      select 1 from public.employee_profiles ep
       where ep.user_id = auth.uid()
         and ep.id = direct_messages.sender_employee_id
    )
  );

drop policy if exists dm_update on public.direct_messages;
create policy dm_update on public.direct_messages
  for update to authenticated
  using (
    public.has_org_access(organization_id)
    and exists (
      select 1 from public.employee_profiles ep
       where ep.user_id = auth.uid()
         and (ep.id = direct_messages.sender_employee_id
              or ep.id = direct_messages.recipient_employee_id)
    )
  );

drop policy if exists dm_att_select on public.direct_message_attachments;
create policy dm_att_select on public.direct_message_attachments
  for select to authenticated
  using (
    public.has_org_access(organization_id)
    and exists (
      select 1 from public.direct_messages m
        join public.employee_profiles ep on ep.user_id = auth.uid()
       where m.id = direct_message_attachments.message_id
         and (
           ep.id = m.sender_employee_id
           or ep.id = m.recipient_employee_id
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
        join public.employee_profiles ep on ep.user_id = auth.uid()
       where m.id = direct_message_attachments.message_id
         and ep.id = m.sender_employee_id
    )
  );
