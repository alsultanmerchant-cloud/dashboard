-- 0018_department_kinds_and_sub_sections.sql
-- Phase 16 (Week 1): Sky Light org structure fidelity.
-- The PDF describes a 5-tier org: Account Management / Main Sections (Specialists) /
-- Supporting Sections (Execution: Design, Content, Video, Programming) / Heads / QC.
-- The dashboard had a flat departments list; this migration adds:
--   * a `kind` enum so the UI can route role pickers correctly
--     (Account Manager from account_management, Specialist from main_section,
--      Agent from supporting_section)
--   * parent "group" rows that wrap each tier
--   * the missing leaf sub-departments under Supporting Sections
--   * reparenting of existing leaf rows under their group

-- 1. Enum --------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'department_kind') then
    create type public.department_kind as enum (
      'group',                -- a parent bucket (Main Sections, Supporting Sections, ...)
      'account_management',   -- AMs / client-facing
      'main_section',         -- Specialists: Social Media, Media Buying, SEO
      'supporting_section',   -- Execution: Design, Content, Video, Programming
      'quality_control',      -- QC watcher, outside daily flow
      'other'                 -- general/back-office (HR, Finance, Management, Sales)
    );
  end if;
end$$;

alter table public.departments
  add column if not exists kind public.department_kind not null default 'other';

create index if not exists idx_departments_kind on public.departments(organization_id, kind);

-- 2. Backfill kinds for existing slugs ---------------------------------
update public.departments
   set kind = 'account_management'
 where slug = 'account-management';

update public.departments
   set kind = 'main_section'
 where slug in ('social-media', 'seo', 'media-buying');

update public.departments
   set kind = 'supporting_section'
 where slug = 'graphic-design';

update public.departments
   set kind = 'other'
 where slug in ('management', 'sales', 'tele-sales', 'hr', 'finance');

-- 3. Parent group rows -------------------------------------------------
insert into public.departments (organization_id, name, slug, description, kind)
select o.id, 'الأقسام الأساسية', 'main-sections',
       'القسم الأساسي للمتخصصين (Social Media / SEO / Media Buying)',
       'group'::public.department_kind
  from public.organizations o
on conflict (organization_id, slug) do update
   set kind = 'group',
       description = excluded.description;

insert into public.departments (organization_id, name, slug, description, kind)
select o.id, 'الأقسام المساندة', 'supporting-sections',
       'قسم التنفيذ — التصميم وكتابة المحتوى والمونتاج والبرمجة',
       'group'::public.department_kind
  from public.organizations o
on conflict (organization_id, slug) do update
   set kind = 'group',
       description = excluded.description;

insert into public.departments (organization_id, name, slug, description, kind)
select o.id, 'الجودة', 'quality-control',
       'قسم متابعة الجودة خارج الفلو اليومي',
       'quality_control'::public.department_kind
  from public.organizations o
on conflict (organization_id, slug) do update
   set kind = 'quality_control',
       description = excluded.description;

-- 4. New supporting leaf departments -----------------------------------
insert into public.departments (organization_id, name, slug, description, kind)
select o.id, 'كتابة المحتوى', 'content-writing',
       'فريق كتابة المحتوى (مقالات، كابشن، نصوص الإعلانات)',
       'supporting_section'::public.department_kind
  from public.organizations o
on conflict (organization_id, slug) do update
   set kind = 'supporting_section',
       description = excluded.description;

insert into public.departments (organization_id, name, slug, description, kind)
select o.id, 'المونتاج', 'video-editing',
       'فريق مونتاج الفيديو والاستوريز',
       'supporting_section'::public.department_kind
  from public.organizations o
on conflict (organization_id, slug) do update
   set kind = 'supporting_section',
       description = excluded.description;

insert into public.departments (organization_id, name, slug, description, kind)
select o.id, 'البرمجة', 'programming',
       'فريق تطوير المواقع والصفحات الهبوطية',
       'supporting_section'::public.department_kind
  from public.organizations o
on conflict (organization_id, slug) do update
   set kind = 'supporting_section',
       description = excluded.description;

-- 5. Reparent leaves under their group --------------------------------
update public.departments d
   set parent_department_id = g.id
  from public.departments g
 where g.organization_id = d.organization_id
   and g.slug = 'main-sections'
   and d.slug in ('social-media', 'seo', 'media-buying')
   and d.parent_department_id is distinct from g.id;

update public.departments d
   set parent_department_id = g.id
  from public.departments g
 where g.organization_id = d.organization_id
   and g.slug = 'supporting-sections'
   and d.slug in ('graphic-design', 'content-writing', 'video-editing', 'programming')
   and d.parent_department_id is distinct from g.id;
