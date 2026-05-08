-- 0071_align_project_code_with_odoo.sql
-- Sky Light's Odoo prints project_code as "PRJ-" + lpad(odoo_id, 5, '0').
-- Our auto-counter was generating PRJ-001..PRJ-NNN, so codes drifted from
-- the live system. Backfill from external_id so screenshots line up.
update public.projects
   set project_code = 'PRJ-' || lpad(external_id, 5, '0')
 where external_source = 'odoo'
   and external_id ~ '^[0-9]+$'
   and (
     project_code is null
     or project_code !~ '^PRJ-[0-9]{5}$'
     or project_code <> 'PRJ-' || lpad(external_id, 5, '0')
   );
