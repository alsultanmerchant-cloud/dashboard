-- =========================================================================
-- Migration 0022 — Permissions Hardening / RLS Tightening (phase T2)
-- =========================================================================
-- Owner spec (docs/SPEC_FROM_OWNER.md §6, §10): Agents see ONLY their own
-- tasks. The current `tasks_select` policy is permissive
-- (`has_org_access(organization_id)`), which lets every authenticated org
-- member read every task. This migration narrows the read surface to:
--
--   1. Callers with the new global permission `task.view_all`
--      (Heads / AM / Admin / Owner).
--   2. Callers assigned to the task on `public.task_assignees`
--      (any role_type — specialist / manager / agent / account_manager).
--   3. The task creator (`tasks.created_by`).
--
-- ⚠ Cross-phase contract: T3 amends this policy in migration 0023 to add
-- visibility for rows in `task_followers`. Until 0023 lands, followers do
-- NOT have read access via this policy. T3 will DROP and re-CREATE the
-- `tasks_select` policy with the additional branch.
--
-- Schema reality check (vs the original dispatch prompt):
--   • `tasks` does NOT have `assignee_ids uuid[]`, `owner_user_id`, or
--     `follower_ids` columns. Assignments live in the join table
--     `task_assignees(task_id, employee_id, role_type)`. We resolve the
--     calling user → employee_profile via `employee_profiles.user_id`
--     in a NOT-EXISTS-style subquery.
--   • `tasks.created_by` is the only "owner-ish" column on the row;
--     we treat it as the analog of `owner_user_id`.
--
-- Stage-transition permission keys: the canonical enforcement of
-- per-stage transitions is the trigger `assert_stage_transition_allowed`
-- shipped in migration 0015 — it gates by `task_assignees.role_type` for
-- the calling employee. We SEED the per-stage permission keys here so
-- they exist in the catalog (for UI / future dynamic gating) but do NOT
-- replace the trigger mechanism. See docs/phase-T2-report.md for the
-- rationale.
--
-- All operations are additive + idempotent.
-- =========================================================================

-- 1. Permission seed -------------------------------------------------------
insert into public.permissions (key, description) values
  ('task.view_all',
    'عرض جميع مهام المنظمة (يتجاوز قيد المهام المُسنَدة)'),
  ('task.transition.specialist_to_manager_review',
    'نقل المهمة من قيد التنفيذ إلى مراجعة المدير'),
  ('task.transition.manager_to_specialist_review',
    'نقل المهمة من مراجعة المدير إلى مراجعة المتخصص'),
  ('task.transition.specialist_to_ready_to_send',
    'نقل المهمة من مراجعة المتخصص إلى جاهز للإرسال'),
  ('task.transition.ready_to_send_to_sent',
    'نقل المهمة من جاهز للإرسال إلى مُرسَل للعميل'),
  ('task.transition.sent_to_client_changes',
    'نقل المهمة من مُرسَل للعميل إلى تعديلات العميل'),
  ('task.transition.client_changes_to_done',
    'نقل المهمة من تعديلات العميل إلى منجَز')
on conflict (key) do nothing;

-- Bind task.view_all to roles that perform cross-task oversight.
-- The current schema has `manager` (≈ Head per migration 0015 override),
-- `account_manager`, `admin`, and `owner`. There is no separate `head`
-- role — the dispatch prompt's "head" maps to the existing `manager`
-- role here. Owner already gets every permission via the catch-all in
-- migration 0006; re-asserting keeps re-runs deterministic.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin', 'manager', 'account_manager')
  and p.key = 'task.view_all'
on conflict do nothing;

-- 2. Helper: does the calling auth.uid() have a task_assignees row for
--    this task (regardless of role_type)? Inlined as a SQL expression
--    inside each policy below — kept here as a comment for clarity:
--
--      EXISTS (
--        SELECT 1
--        FROM public.task_assignees ta
--        JOIN public.employee_profiles ep ON ep.id = ta.employee_id
--        WHERE ta.task_id = tasks.id
--          AND ep.user_id = auth.uid()
--      )

-- 3. Tighten the tasks SELECT policy ---------------------------------------
-- Replace the permissive org-scoped policy. Org scope is preserved as the
-- outer guard (organization_id check via has_org_access still wins for
-- WRITE — see tasks_write below).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission('task.view_all')
      or tasks.created_by = auth.uid()
      or exists (
        select 1
        from public.task_assignees ta
        join public.employee_profiles ep on ep.id = ta.employee_id
        where ta.task_id = tasks.id
          and ep.user_id = auth.uid()
      )
    )
  );

-- WRITE policy is unchanged at the RLS level (org scope + tasks.manage
-- enforcement happens in server actions). Re-create it idempotently in
-- case it was dropped during a prior run.
drop policy if exists tasks_write on public.tasks;
create policy tasks_write
  on public.tasks
  for all
  to authenticated
  using      ( public.has_org_access(organization_id) )
  with check ( public.has_org_access(organization_id) );

-- 4. Tighten task_comments SELECT ------------------------------------------
-- Visibility: caller must be able to see the parent task. We mirror the
-- same OR chain (view_all OR creator OR assignee on parent task). INSERT
-- still requires the caller to be the comment author + org member.
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select
  on public.task_comments
  for select
  to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission('task.view_all')
      or exists (
        select 1
        from public.tasks t
        where t.id = task_comments.task_id
          and (
            t.created_by = auth.uid()
            or exists (
              select 1
              from public.task_assignees ta
              join public.employee_profiles ep on ep.id = ta.employee_id
              where ta.task_id = t.id
                and ep.user_id = auth.uid()
            )
          )
      )
    )
  );

-- 5. Tighten task_mentions SELECT ------------------------------------------
-- task_mentions has organization_id but the parent task is reachable via
-- task_comments.task_id. Mirror the same membership check; additionally
-- always allow the mentioned user to see their own mention rows.
drop policy if exists task_mentions_select on public.task_mentions;
create policy task_mentions_select
  on public.task_mentions
  for select
  to authenticated
  using (
    public.has_org_access(organization_id)
    and (
      public.has_permission('task.view_all')
      or task_mentions.mentioned_user_id = auth.uid()
      or exists (
        select 1
        from public.task_comments tc
        join public.tasks t on t.id = tc.task_id
        where tc.id = task_mentions.task_comment_id
          and (
            t.created_by = auth.uid()
            or exists (
              select 1
              from public.task_assignees ta
              join public.employee_profiles ep on ep.id = ta.employee_id
              where ta.task_id = t.id
                and ep.user_id = auth.uid()
            )
          )
      )
    )
  );

-- task_mentions write: keep as-is (org scope) — write happens via server
-- action `addTaskCommentAction` which has its own permission gate
-- (tasks.view + author = auth.uid()).
