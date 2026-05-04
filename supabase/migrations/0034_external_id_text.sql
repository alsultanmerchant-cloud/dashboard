-- 0034_external_id_text.sql
-- Migration 0011 typed external_id as bigint to fit Odoo's numeric IDs.
-- The Excel importer uses string IDs like "C10" / "C83|20250906", so widen
-- to text. bigint values cast cleanly to text — no data loss.
--
-- tasks.external_id is referenced by the tasks_with_metrics view, so we
-- drop+recreate the view around the column type change.

-- Drop the dependent view
drop view if exists public.tasks_with_metrics;

-- Widen the columns
alter table public.clients
  alter column external_id type text using external_id::text;

alter table public.projects
  alter column external_id type text using external_id::text;

alter table public.tasks
  alter column external_id type text using external_id::text;

alter table public.employee_profiles
  alter column external_id type text using external_id::text;

alter table public.service_categories
  alter column external_id type text using external_id::text;

-- Recreate the view with the same definition
create view public.tasks_with_metrics as
 SELECT id,
    organization_id,
    project_id,
    service_id,
    title,
    description,
    status,
    priority,
    due_date,
    completed_at,
    created_from_template_item_id,
    created_at,
    updated_at,
    created_by,
    stage,
    stage_entered_at,
    planned_date,
    allocated_time_minutes,
    progress_percent,
    expected_progress_percent,
    progress_slip_percent,
    external_source,
    external_id,
    delay_days,
    hold_reason,
    hold_since,
        CASE
            WHEN planned_date IS NULL THEN NULL::integer
            WHEN stage = 'done'::task_stage THEN delay_days
            ELSE CURRENT_DATE - planned_date
        END AS running_delay_days,
    task_current_stage_seconds(t.*) AS current_stage_seconds
   FROM tasks t;
