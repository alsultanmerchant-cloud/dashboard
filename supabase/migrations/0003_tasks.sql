-- 0003_tasks.sql
-- Task templates, tasks, assignees, comments, mentions.

-- =========================================================================
-- task_templates
-- =========================================================================
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_task_templates_org on public.task_templates(organization_id);
create index if not exists idx_task_templates_service on public.task_templates(service_id);

create trigger trg_task_templates_updated_at
before update on public.task_templates
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- task_template_items
-- =========================================================================
create table if not exists public.task_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_template_id uuid not null references public.task_templates(id) on delete cascade,
  title text not null,
  description text,
  default_department_id uuid references public.departments(id) on delete set null,
  default_role_key text,
  offset_days_from_project_start integer not null default 0,
  duration_days integer not null default 1,
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_template_items_org on public.task_template_items(organization_id);
create index if not exists idx_template_items_template on public.task_template_items(task_template_id, order_index);

create trigger trg_template_items_updated_at
before update on public.task_template_items
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- tasks
-- =========================================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo'
    check (status in ('todo','in_progress','review','blocked','done','cancelled')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  due_date date,
  completed_at timestamptz,
  created_from_template_item_id uuid references public.task_template_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_tasks_org on public.tasks(organization_id);
create index if not exists idx_tasks_project on public.tasks(project_id);
create index if not exists idx_tasks_status on public.tasks(organization_id, status);
create index if not exists idx_tasks_due on public.tasks(organization_id, due_date) where due_date is not null;
create index if not exists idx_tasks_overdue on public.tasks(organization_id) where status in ('todo','in_progress','review','blocked') and due_date is not null;

create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- task_assignees
-- =========================================================================
create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, employee_id)
);

create index if not exists idx_task_assignees_org on public.task_assignees(organization_id);
create index if not exists idx_task_assignees_task on public.task_assignees(task_id);
create index if not exists idx_task_assignees_employee on public.task_assignees(employee_id);

-- =========================================================================
-- task_comments
-- =========================================================================
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  is_internal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_task_comments_org on public.task_comments(organization_id);
create index if not exists idx_task_comments_task on public.task_comments(task_id, created_at desc);
create index if not exists idx_task_comments_author on public.task_comments(author_user_id);

create trigger trg_task_comments_updated_at
before update on public.task_comments
for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- task_mentions
-- =========================================================================
create table if not exists public.task_mentions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_comment_id uuid not null references public.task_comments(id) on delete cascade,
  mentioned_employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  mentioned_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_mentions_org on public.task_mentions(organization_id);
create index if not exists idx_task_mentions_comment on public.task_mentions(task_comment_id);
create index if not exists idx_task_mentions_employee on public.task_mentions(mentioned_employee_id);
