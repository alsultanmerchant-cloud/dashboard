-- 0043_skylight_org_tree_seed.sql
-- Seed Sky Light's actual organization tree from "Sky light organization.pdf"
-- (provided by the owner) into the departments table. Heads are wired by
-- ILIKE matching against employee_profiles.full_name (which is stored in
-- Arabic, while the PDF lists Latin transliterations — both forms below).
--
-- The existing seeded departments from 0006/0018 are NOT deleted, just
-- augmented. Idempotent on the slug.

do $$
declare
  v_org uuid := (select id from public.organizations where slug = 'rawasm-demo' limit 1);
begin
  if v_org is null then
    raise notice 'rawasm-demo org not found; skipping org-tree seed';
    return;
  end if;

  -- Top-level groups under CEO
  insert into public.departments (organization_id, name, slug, kind)
  values
    (v_org, 'القيادة', 'sl-ceo', 'group'),
    (v_org, 'القسم الفني', 'sl-technical', 'group'),
    (v_org, 'المبيعات', 'sl-sales', 'group'),
    (v_org, 'الإدارة', 'sl-admin', 'group'),
    (v_org, 'المساعدون', 'sl-assistance', 'other')
  on conflict (organization_id, slug) do nothing;

  -- Technical sub-groups
  insert into public.departments (organization_id, name, slug, kind)
  values
    (v_org, 'القسم الأساسي', 'sl-tech-main', 'main_section'),
    (v_org, 'القسم المساند', 'sl-tech-supporting', 'supporting_section'),
    (v_org, 'الجودة', 'sl-quality-control', 'quality_control')
  on conflict (organization_id, slug) do nothing;

  -- Main-section departments (client-facing)
  insert into public.departments (organization_id, name, slug, kind)
  values
    (v_org, 'إدارة الحسابات (Account Management)', 'sl-account-management', 'account_management'),
    (v_org, 'الميديا باينج (Media Buying)', 'sl-media-buying', 'main_section'),
    (v_org, 'تحسين محركات البحث (SEO)', 'sl-seo', 'main_section'),
    (v_org, 'السوشيال ميديا (Social Media)', 'sl-social-media', 'main_section')
  on conflict (organization_id, slug) do nothing;

  -- Supporting-section departments
  insert into public.departments (organization_id, name, slug, kind)
  values
    (v_org, 'البرمجة (Programming)', 'sl-programming', 'supporting_section'),
    (v_org, 'محتوى السوشيال (Social Content)', 'sl-social-content', 'supporting_section'),
    (v_org, 'محتوى السيو (SEO Content)', 'sl-seo-content', 'supporting_section'),
    (v_org, 'الديزاين والآرت دايركشن (Art Direction & Designs)', 'sl-art-direction', 'supporting_section'),
    (v_org, 'مونتاج الفيديو (Video Editing)', 'sl-video-editing', 'supporting_section'),
    (v_org, 'فيديوهات الذكاء الاصطناعي (AI Videos)', 'sl-ai-videos', 'supporting_section'),
    (v_org, 'موديريشن (Moderator)', 'sl-moderator', 'supporting_section')
  on conflict (organization_id, slug) do nothing;

  -- Sales sub-departments
  insert into public.departments (organization_id, name, slug, kind)
  values
    (v_org, 'سيلز (Sales)', 'sl-sales-direct', 'main_section'),
    (v_org, 'تيلي سيلز (Telesales)', 'sl-telesales', 'main_section'),
    (v_org, 'العلاقات العامة (PR)', 'sl-public-relations', 'main_section')
  on conflict (organization_id, slug) do nothing;

  -- Admin sub-departments
  insert into public.departments (organization_id, name, slug, kind)
  values
    (v_org, 'الموارد البشرية (HR)', 'sl-hr', 'other'),
    (v_org, 'المحاسبة (Accountant)', 'sl-accounting', 'other'),
    (v_org, 'إدارة المبنى (Management Floor)', 'sl-management-floor', 'other')
  on conflict (organization_id, slug) do nothing;

  -- Wire parent_department_id by slug pairs.
  update public.departments c
     set parent_department_id = p.id
    from public.departments p
   where c.organization_id = v_org
     and p.organization_id = v_org
     and (
       (c.slug = 'sl-technical' and p.slug = 'sl-ceo') or
       (c.slug = 'sl-sales' and p.slug = 'sl-ceo') or
       (c.slug = 'sl-admin' and p.slug = 'sl-ceo') or
       (c.slug = 'sl-assistance' and p.slug = 'sl-ceo') or
       (c.slug = 'sl-tech-main' and p.slug = 'sl-technical') or
       (c.slug = 'sl-tech-supporting' and p.slug = 'sl-technical') or
       (c.slug = 'sl-quality-control' and p.slug = 'sl-technical') or
       (c.slug in (
          'sl-account-management', 'sl-media-buying', 'sl-seo', 'sl-social-media'
        ) and p.slug = 'sl-tech-main') or
       (c.slug in (
          'sl-programming', 'sl-social-content', 'sl-seo-content',
          'sl-art-direction', 'sl-video-editing', 'sl-ai-videos', 'sl-moderator'
        ) and p.slug = 'sl-tech-supporting') or
       (c.slug in ('sl-sales-direct', 'sl-telesales', 'sl-public-relations')
         and p.slug = 'sl-sales') or
       (c.slug in ('sl-hr', 'sl-accounting', 'sl-management-floor')
         and p.slug = 'sl-admin')
     );

  -- Wire heads by ILIKE matching the Arabic full_name. PDF transliterations
  -- in comments. NULL is fine if no match — the chart still renders.
  -- (Each subselect picks the first match in case of duplicates.)
  update public.departments d
     set head_employee_id = e.id
    from (
      select slug, name_pattern from (values
        ('sl-ceo',                'محمد السلطان'),     -- Mohammed Alsultan
        ('sl-technical',          'احمد حبيب'),         -- Ahmed Habib
        ('sl-quality-control',    'جهاد رمضان'),        -- Gihad Ramadan
        ('sl-account-management', 'اية خفاجي'),         -- Aya Khafagy
        ('sl-media-buying',       'اشرف مختار'),        -- Ashraf Mokhtar
        ('sl-seo',                'حسن شاهين'),         -- Hassan Shahin
        ('sl-social-media',       'هاله فتحي'),         -- Hala Fathi
        ('sl-social-content',     'نوف'),               -- Nouf
        ('sl-seo-content',        'محمد عادل'),         -- Mohamed Adel
        ('sl-art-direction',      'محمد حجي'),          -- Mohamed Heji
        ('sl-sales',              'عمر الدسوقي'),        -- Omar El Desouqy (CSO)
        ('sl-sales-direct',       'الشاعر'),             -- El Shaer
        ('sl-telesales',          'رانيا'),              -- Rania
        ('sl-public-relations',   'اية رضا'),            -- Aya Reda
        ('sl-hr',                 'مجدي'),               -- Magdy
        ('sl-accounting',         'صلاح')                -- Salah
      ) as t(slug, name_pattern)
    ) m
    join lateral (
      select id from public.employee_profiles
       where organization_id = v_org
         and full_name ilike '%' || m.name_pattern || '%'
       limit 1
    ) e on true
   where d.organization_id = v_org
     and d.slug = m.slug;
end$$;
