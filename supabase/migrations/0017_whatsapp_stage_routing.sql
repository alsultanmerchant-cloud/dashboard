-- Phase 16 — WhatsApp stage → template routing.
--
-- Mirrors the Odoo addon `tus_meta_wa_project_task` (project_task.py:22-45):
-- when a task transitions into a stage that has a configured WhatsApp
-- template, an outbox row is enqueued for either the project group chat
-- or each assignee's mobile number.
--
-- This migration provides the data plane only. Sending is handled by a
-- Supabase edge function that flushes the outbox to the Meta WA Business
-- API; until those credentials exist, the function is a stub gated behind
-- the `wa_dispatch_enabled` org setting.

-- 1. Templates ---------------------------------------------------------------
create table if not exists public.wa_message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade,
  stage public.task_stage not null,
  name text not null,
  meta_template_name text,
  language text not null default 'ar',
  body_template text not null,
  target text not null default 'group' check (target in ('group','assignees')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_wa_tpl_scope
  on public.wa_message_templates (
    organization_id,
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    stage,
    target
  );

create index if not exists idx_wa_tpl_org_stage on public.wa_message_templates (organization_id, stage) where is_active;

-- 2. Outbox queue -----------------------------------------------------------
create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  template_id uuid references public.wa_message_templates(id) on delete set null,
  recipient_type text not null check (recipient_type in ('group','employee')),
  recipient_chat_id text,
  recipient_employee_id uuid references public.employee_profiles(id) on delete set null,
  recipient_phone text,
  meta_template_name text,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_outbox_pending on public.wa_outbox (status, scheduled_at) where status in ('queued','failed');
create index if not exists idx_wa_outbox_task on public.wa_outbox (task_id);

-- 3. Trigger: on stage change or insert, enqueue --------------------------
create or replace function public.rwasem_enqueue_wa_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.wa_message_templates%rowtype;
  v_body text;
  v_project_name text;
  v_client_name text;
  v_chat_id text;
  v_assignee record;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;

  -- Service-specific template wins over generic (service_id is null).
  select * into v_template
  from public.wa_message_templates
  where organization_id = new.organization_id
    and stage = new.stage
    and is_active
    and (service_id = new.service_id or service_id is null)
  order by service_id nulls last
  limit 1;

  if not found then return new; end if;

  select p.name, c.name
    into v_project_name, v_client_name
  from public.projects p
  left join public.clients c on c.id = p.client_id
  where p.id = new.project_id;

  v_body := v_template.body_template;
  v_body := replace(v_body, '{{task}}',     coalesce(new.title, ''));
  v_body := replace(v_body, '{{stage}}',    new.stage::text);
  v_body := replace(v_body, '{{project}}',  coalesce(v_project_name, ''));
  v_body := replace(v_body, '{{client}}',   coalesce(v_client_name, ''));
  v_body := replace(v_body, '{{due_date}}', coalesce(new.due_date::text, ''));

  if v_template.target = 'group' then
    select whatsapp_chat_id into v_chat_id
    from public.whatsapp_groups
    where project_id = new.project_id
      and whatsapp_chat_id is not null
    order by created_at
    limit 1;

    if v_chat_id is not null then
      insert into public.wa_outbox (
        organization_id, task_id, template_id,
        recipient_type, recipient_chat_id,
        meta_template_name, body
      ) values (
        new.organization_id, new.id, v_template.id,
        'group', v_chat_id,
        v_template.meta_template_name, v_body
      );
    end if;
  else
    for v_assignee in
      select ep.id as employee_id, ep.phone
      from public.task_assignees ta
      join public.employee_profiles ep on ep.id = ta.employee_id
      where ta.task_id = new.id
        and ep.phone is not null
        and ep.phone <> ''
    loop
      insert into public.wa_outbox (
        organization_id, task_id, template_id,
        recipient_type, recipient_employee_id, recipient_phone,
        meta_template_name, body
      ) values (
        new.organization_id, new.id, v_template.id,
        'employee', v_assignee.employee_id, v_assignee.phone,
        v_template.meta_template_name, v_body
      );
    end loop;
  end if;

  return new;
end
$$;

drop trigger if exists trg_rwasem_enqueue_wa_on_stage_change on public.tasks;
create trigger trg_rwasem_enqueue_wa_on_stage_change
  after insert or update of stage on public.tasks
  for each row
  execute function public.rwasem_enqueue_wa_on_stage_change();

-- 4. RLS --------------------------------------------------------------------
alter table public.wa_message_templates enable row level security;
alter table public.wa_outbox enable row level security;

drop policy if exists wa_tpl_org_select on public.wa_message_templates;
create policy wa_tpl_org_select on public.wa_message_templates
  for select to authenticated
  using (organization_id in (select organization_id from public.employee_profiles where user_id = auth.uid()));

drop policy if exists wa_tpl_org_write on public.wa_message_templates;
create policy wa_tpl_org_write on public.wa_message_templates
  for all to authenticated
  using (organization_id in (select organization_id from public.employee_profiles where user_id = auth.uid()))
  with check (organization_id in (select organization_id from public.employee_profiles where user_id = auth.uid()));

drop policy if exists wa_outbox_org_select on public.wa_outbox;
create policy wa_outbox_org_select on public.wa_outbox
  for select to authenticated
  using (organization_id in (select organization_id from public.employee_profiles where user_id = auth.uid()));

-- Outbox writes happen via trigger (security definer) and edge function
-- (service role); no end-user write policy needed.
