-- 0037_supporting_dept_role_slots.sql
-- Add supporting-department role slots to task_role_type per the Sky Light
-- owner-system MD (sections 14-15): Specialist Departments (Social Media,
-- SEO, Media Buying) own client-facing output, but execution may be
-- delegated to a Supporting Department (Designing, Programming, SEO Content,
-- Social Content) via Log Note + Assign. Today the enum has only the four
-- client-facing roles; a delegated task has no slot to record the
-- supporting lead or agent.
--
-- Slots added:
--   * supporting_lead   — Lead of the supporting department who receives
--                         the delegation request from the Specialist
--   * supporting_agent  — Executor inside the supporting department, set
--                         by the supporting_lead
--
-- After this migration runs, a delegated task can carry up to 6 slots:
--   specialist + manager + agent + account_manager
--   + supporting_lead + supporting_agent
-- where (specialist, agent) belong to the client-facing dept and
-- (supporting_lead, supporting_agent) belong to a downstream dept.
--
-- Stage guard updates that reference these new slots land in 0038.

alter type public.task_role_type add value if not exists 'supporting_lead';
alter type public.task_role_type add value if not exists 'supporting_agent';

comment on type public.task_role_type is
  'Sky Light task role slots. specialist/manager/agent/account_manager are '
  'the four client-facing roles (per the operations PDF). supporting_lead '
  'and supporting_agent encode delegation into a Supporting Department '
  '(Designing/Programming/SEO Content/Social Content) per the owner-system MD.';
