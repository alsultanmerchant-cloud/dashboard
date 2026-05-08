-- 0077_stage_owner_positions.sql
-- Per-stage owner position on each task template item (and copied onto
-- tasks at creation). This lets the template author say:
--   "When this task is in 'manager_review', the owner is the *manager*
--    position. When it's in 'sent_to_client', the owner is the *account_
--    manager* position."
-- The system then resolves position → actual employee at render time by
-- looking up task_assignees with the matching role_type. The mapping is a
-- jsonb of { task_stage_key: task_role_type_key }; nulls mean "no specific
-- owner for that stage."

-- Default mapping reflects Sky Light's PDF §3 + §9 conventions.
create or replace function public._default_stage_owner_positions()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'new',                'specialist',
    'in_progress',        'agent',
    'manager_review',     'manager',
    'specialist_review',  'specialist',
    'ready_to_send',      'account_manager',
    'sent_to_client',     'account_manager',
    'client_changes',     'agent',
    'done',               null
  );
$$;

alter table public.task_template_items
  add column if not exists stage_owner_positions jsonb not null
    default public._default_stage_owner_positions();

alter table public.tasks
  add column if not exists stage_owner_positions jsonb;

update public.task_template_items
   set stage_owner_positions = public._default_stage_owner_positions()
 where stage_owner_positions is null
    or stage_owner_positions = '{}'::jsonb;

update public.tasks
   set stage_owner_positions = public._default_stage_owner_positions()
 where stage_owner_positions is null;

create or replace view public.task_current_stage_owner as
select
  t.id            as task_id,
  t.stage         as stage,
  t.stage_owner_positions->>(t.stage::text) as owner_position,
  ta.employee_id  as owner_employee_id,
  ep.full_name    as owner_full_name,
  ep.avatar_url   as owner_avatar_url,
  ep.job_title    as owner_job_title
from public.tasks t
left join lateral (
  select employee_id from public.task_assignees
   where task_id = t.id
     and role_type::text = t.stage_owner_positions->>(t.stage::text)
   order by created_at asc
   limit 1
) ta on true
left join public.employee_profiles ep on ep.id = ta.employee_id;
