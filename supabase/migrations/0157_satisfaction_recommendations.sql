-- 0157 Satisfaction recommendations
-- Adds AI advice tied to real delivery work: the analysis now reads the
-- client's actual overdue tasks in Rawasm (getClientExecutionSnapshot) alongside
-- the WhatsApp chats and emits grounded recommendations correlating what the
-- client complains about with the concrete delayed tasks / stuck stages.
alter table public.client_satisfaction_analyses
  add column if not exists recommendations jsonb not null default '[]'::jsonb;
