-- 0074_project_package_duration.sql
-- Sky Light's project names embed both a "package" (نوفا / ذهبية / فضية / إعلانية)
-- and a "duration" (شهر / 3 شهور / 6 شهور / سنة). Surface them as first-class
-- fields on projects so the new-project wizard can pick them and the kanban
-- card can show them as proper chips.
alter table public.projects
  add column if not exists package_name text,
  add column if not exists duration_label text;
