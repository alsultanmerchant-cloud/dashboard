-- 0005_rls_policies.sql
-- Enable RLS and create practical, secure policies on every table.
-- Strategy: SELECT requires has_org_access. Writes require has_org_access too;
-- finer-grained permission gating happens in server actions via has_permission.
-- Service role bypasses RLS automatically (Supabase default).

-- =========================================================================
-- Enable RLS
-- =========================================================================
alter table public.organizations enable row level security;
alter table public.departments enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.project_services enable row level security;
alter table public.project_members enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_template_items enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_mentions enable row level security;
alter table public.sales_handover_forms enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_events enable row level security;

-- =========================================================================
-- organizations — readable by members
-- =========================================================================
create policy "orgs_select_members"
  on public.organizations for select
  to authenticated
  using (public.has_org_access(id));

-- =========================================================================
-- Generic org-scoped table policies factory replacement: explicit per table.
-- =========================================================================

-- departments
create policy "departments_select"
  on public.departments for select to authenticated
  using (public.has_org_access(organization_id));
create policy "departments_write"
  on public.departments for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- employee_profiles
create policy "employees_select"
  on public.employee_profiles for select to authenticated
  using (public.has_org_access(organization_id));
create policy "employees_write"
  on public.employee_profiles for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- roles
create policy "roles_select"
  on public.roles for select to authenticated
  using (organization_id is null or public.has_org_access(organization_id));
create policy "roles_write"
  on public.roles for all to authenticated
  using (organization_id is not null and public.has_org_access(organization_id))
  with check (organization_id is not null and public.has_org_access(organization_id));

-- permissions (global catalog — read-only for all authenticated)
create policy "permissions_select"
  on public.permissions for select to authenticated using (true);

-- role_permissions
create policy "role_permissions_select"
  on public.role_permissions for select to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and (r.organization_id is null or public.has_org_access(r.organization_id))
    )
  );
create policy "role_permissions_write"
  on public.role_permissions for all to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.organization_id is not null
        and public.has_org_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.organization_id is not null
        and public.has_org_access(r.organization_id)
    )
  );

-- user_roles
create policy "user_roles_select"
  on public.user_roles for select to authenticated
  using (public.has_org_access(organization_id) or user_id = auth.uid());
create policy "user_roles_write"
  on public.user_roles for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- services
create policy "services_select"
  on public.services for select to authenticated
  using (public.has_org_access(organization_id));
create policy "services_write"
  on public.services for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- clients
create policy "clients_select"
  on public.clients for select to authenticated
  using (public.has_org_access(organization_id));
create policy "clients_write"
  on public.clients for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- projects
create policy "projects_select"
  on public.projects for select to authenticated
  using (public.has_org_access(organization_id));
create policy "projects_write"
  on public.projects for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- project_services
create policy "project_services_select"
  on public.project_services for select to authenticated
  using (public.has_org_access(organization_id));
create policy "project_services_write"
  on public.project_services for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- project_members
create policy "project_members_select"
  on public.project_members for select to authenticated
  using (public.has_org_access(organization_id));
create policy "project_members_write"
  on public.project_members for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- task_templates
create policy "task_templates_select"
  on public.task_templates for select to authenticated
  using (public.has_org_access(organization_id));
create policy "task_templates_write"
  on public.task_templates for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- task_template_items
create policy "task_template_items_select"
  on public.task_template_items for select to authenticated
  using (public.has_org_access(organization_id));
create policy "task_template_items_write"
  on public.task_template_items for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- tasks
create policy "tasks_select"
  on public.tasks for select to authenticated
  using (public.has_org_access(organization_id));
create policy "tasks_write"
  on public.tasks for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- task_assignees
create policy "task_assignees_select"
  on public.task_assignees for select to authenticated
  using (public.has_org_access(organization_id));
create policy "task_assignees_write"
  on public.task_assignees for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- task_comments
create policy "task_comments_select"
  on public.task_comments for select to authenticated
  using (public.has_org_access(organization_id));
create policy "task_comments_insert"
  on public.task_comments for insert to authenticated
  with check (public.has_org_access(organization_id) and author_user_id = auth.uid());
create policy "task_comments_update_own"
  on public.task_comments for update to authenticated
  using (public.has_org_access(organization_id) and author_user_id = auth.uid())
  with check (public.has_org_access(organization_id) and author_user_id = auth.uid());

-- task_mentions
create policy "task_mentions_select"
  on public.task_mentions for select to authenticated
  using (public.has_org_access(organization_id));
create policy "task_mentions_write"
  on public.task_mentions for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- sales_handover_forms
create policy "handover_select"
  on public.sales_handover_forms for select to authenticated
  using (public.has_org_access(organization_id));
create policy "handover_write"
  on public.sales_handover_forms for all to authenticated
  using (public.has_org_access(organization_id))
  with check (public.has_org_access(organization_id));

-- notifications: recipients can read their own, members can insert (server creates them)
create policy "notifications_select_self"
  on public.notifications for select to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      recipient_user_id = auth.uid()
      or exists (
        select 1 from public.employee_profiles ep
        where ep.id = notifications.recipient_employee_id
          and ep.user_id = auth.uid()
      )
    )
  );
create policy "notifications_update_self"
  on public.notifications for update to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      recipient_user_id = auth.uid()
      or exists (
        select 1 from public.employee_profiles ep
        where ep.id = notifications.recipient_employee_id
          and ep.user_id = auth.uid()
      )
    )
  )
  with check (public.has_org_access(organization_id));
create policy "notifications_insert_org"
  on public.notifications for insert to authenticated
  with check (public.has_org_access(organization_id));

-- audit_logs: read-only for org members; service role inserts
create policy "audit_select"
  on public.audit_logs for select to authenticated
  using (public.has_org_access(organization_id));
create policy "audit_insert_org"
  on public.audit_logs for insert to authenticated
  with check (public.has_org_access(organization_id));

-- ai_events: read-only for org members; service role inserts
create policy "ai_events_select"
  on public.ai_events for select to authenticated
  using (public.has_org_access(organization_id));
create policy "ai_events_insert_org"
  on public.ai_events for insert to authenticated
  with check (public.has_org_access(organization_id));
