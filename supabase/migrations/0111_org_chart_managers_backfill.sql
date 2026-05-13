-- Backfill employee_profiles.manager_employee_id per Sky Light org PDF.
-- "Manager" = the person immediately above in the org chart:
--   - Members report to their team leader
--   - Team leaders report to their dept head
--   - Dept heads report to their section head (e.g. Technical → Ahmed Habib)
-- Skip-overwrite: only sets where currently null.

-- ===== Account Manager (إدارة الحسابات) reports to اية خفاجي =====
-- Team leaders under Aya:
update employee_profiles set manager_employee_id = '27b1e7fd-778e-407b-b1e4-0ae10867d94b' where id in (
  '428125f6-5ea0-4ce7-be70-470e305a1630',  -- بسملة محمد
  '32dc8bdb-7b4e-4ef8-ae2d-d8f1c802ef5e',  -- بسنت محمد الصلب
  '0386f93f-d34e-49d2-bdfd-34a7f22a6c76'   -- شيماء هيثم
) and manager_employee_id is null;

-- Members of Bassant's team:
update employee_profiles set manager_employee_id = '32dc8bdb-7b4e-4ef8-ae2d-d8f1c802ef5e' where id in (
  '7eeb6745-7075-4ec2-810e-2273dd4fa5ba',  -- كريم سامح
  'a77e20f4-9856-4cdc-939e-dc6f89afeeb4'   -- سالي محمد
) and manager_employee_id is null;

-- Dina Elhoseiny (account member, reports directly to Aya):
update employee_profiles set manager_employee_id = '27b1e7fd-778e-407b-b1e4-0ae10867d94b' where id in (
  '5a130832-48bb-4eb7-a166-1ae80893feb4'   -- دينا الحسيني
) and manager_employee_id is null;

-- ===== Art Direction Designs reports to محمد حجي =====
-- Team leaders + direct reports under Mohamed Heji:
update employee_profiles set manager_employee_id = 'ddd4de6b-e72d-4806-b241-6c68ebcdbc4a' where id in (
  'af0440b1-61fd-4ece-b860-7ea65ad77f7f',  -- نغم محمد (Nagham TL)
  '4125bb13-fc94-4287-8a3a-3296a957a1c2',  -- حنين حسين (Haneen TL)
  'b6231989-fb0c-4e9a-b7c5-241405ed48ea',  -- مني أبو سليمان (Mona TL)
  'e1259dfe-3e0b-423a-9fe5-bec716e677f3',  -- ميرنا جمال (Merna TL)
  '31985ed1-9b1c-4b69-9910-e2dccc94fbe3',  -- نوران أيمن (Nouran TL)
  '3ce7753b-7ffa-4e05-b063-563664c689cf',  -- احمد محسن (Graphic TL)
  '15bacd6f-95ad-4165-94a9-96ed73a00fa5',  -- محمد مسلماني (Motion TL)
  'e0e4f0bf-6096-4634-8b74-2f13126e14d4',  -- هاجر طارق (UI lead)
  'a5555aae-7206-48d3-937f-b6177e45c0c0',  -- هبة النجار
  'f200b71d-e8a6-4d41-95a9-dc5f5e2f8054'   -- محمد تامر
) and manager_employee_id is null;

-- Members of Mona's team:
update employee_profiles set manager_employee_id = 'b6231989-fb0c-4e9a-b7c5-241405ed48ea' where id in (
  'f7bb4469-ceec-4ca3-8355-1e6a9cf1ee12'   -- اسراء اسامه
) and manager_employee_id is null;

-- Members of Nagham's team:
update employee_profiles set manager_employee_id = 'af0440b1-61fd-4ece-b860-7ea65ad77f7f' where id in (
  '6264fe75-7543-4620-87fb-4708d3edfb11',  -- امل صالح
  'd3a5c15a-6d44-4e6d-a80f-2409251348dc'   -- وليد احمد
) and manager_employee_id is null;

-- "Hager" team leader (per PDF: Mariam Shaaban reports to Hager).
-- "Hager" identity is ambiguous; using Hager Tarek (the UI lead) since
-- Mariam Shaaban is in Art Direction context and Hager Tarek is the
-- closest unambiguous match. Reassign manually if needed.
update employee_profiles set manager_employee_id = 'e0e4f0bf-6096-4634-8b74-2f13126e14d4' where id in (
  'd433d4b9-caf9-4250-8ab4-5200d67b5a2b'   -- مريم شعبان
) and manager_employee_id is null;

-- Members under Rawan (Rawan unmatched; report directly to Mohamed Heji):
update employee_profiles set manager_employee_id = 'ddd4de6b-e72d-4806-b241-6c68ebcdbc4a' where id in (
  '2ab42093-11d1-49ed-bd59-1f74e9c93b9f',  -- فدوى امير
  '59863af3-af2a-4fa5-a94e-3af6e6a70884',  -- سميره الطوبجي
  'ab5b6b05-89c1-46ef-96b2-9495f472a99d'   -- علية غنيم
) and manager_employee_id is null;

-- ===== Graphic team members report to Ahmed Mohsen =====
update employee_profiles set manager_employee_id = '3ce7753b-7ffa-4e05-b063-563664c689cf' where id in (
  'c84ab898-c862-4e8d-8263-310ae17f5390',  -- عبدالله غيث
  '7c74020b-1de2-47d9-a714-a3a89519b73a',  -- حسام محمد
  '8de98186-d01c-44bd-b8cd-97c942593c69',  -- عبدالرحمن احمد
  '04e84fe4-ac51-4929-90f1-6edd178bc32d'   -- محمد حبيب
) and manager_employee_id is null;

-- ===== Motion team members report to Almoslmany =====
update employee_profiles set manager_employee_id = '15bacd6f-95ad-4165-94a9-96ed73a00fa5' where id in (
  'edd510f5-fd3f-4bb4-a6a0-7b3b43508693',  -- دنيا احمد
  '4c80874c-74f6-4c82-a301-bacbb1ae1a92'   -- سلمي تامر
) and manager_employee_id is null;

-- ===== Social Media members report to الاء فتحي =====
update employee_profiles set manager_employee_id = 'bc899c0c-20f1-40f9-ad6f-875bf05bb288' where id in (
  'efd30bba-a324-4fa3-9896-a187fd27630f',  -- جنة احمد
  '4c035c4d-25ee-491c-bf9c-1dfb5ccfceb9',  -- نور مشعل
  'bca157f3-5882-402e-8091-048e77a97141',  -- اعتماد مصطفي
  '39984131-58e5-4c1a-abb2-b1c1bc9f87f3',  -- شروق سليمان
  '87e5b733-70b3-4ebc-96bc-4e30a04d4da7'   -- زياد حجي
) and manager_employee_id is null;

-- ===== SEO Content member reports to محمد عادل =====
update employee_profiles set manager_employee_id = '38c18c2d-d25a-430f-a39a-3fa402800cbc' where id in (
  'ac1872ee-af8b-4421-8c4b-611b40f7092e'   -- يحيى علاء
) and manager_employee_id is null;

-- ===== Quality Control member reports to جهاد رمضان =====
update employee_profiles set manager_employee_id = 'eacb733e-6947-4386-b2b9-c9d09a8d104d' where id in (
  '76ba7a3c-d1e5-4378-a9af-1afad723a2df'   -- منة ابراهيم
) and manager_employee_id is null;

-- ===== HR members report to مجدي محمد =====
update employee_profiles set manager_employee_id = '241b1147-ede1-45ef-b6e0-11b4bfbee0fd' where id in (
  '53ae32b1-3723-4bb1-95c2-119829381186',  -- چيلان محمود
  '3a4f4bea-fb27-44b6-831b-23e0457dff4c'   -- جميلة محمود
) and manager_employee_id is null;

-- ===== Accountant member reports to صلاح حسونة =====
update employee_profiles set manager_employee_id = '0c2aa095-0c30-48ff-b7b1-2fd35377cdd8' where id in (
  '6969aaf2-3d9f-40bb-aeb1-ca9f37f47738'   -- عمار ياسر
) and manager_employee_id is null;

-- ===== Public Relations member reports to اية رضا =====
update employee_profiles set manager_employee_id = '848a1cb9-c441-499b-8fa0-87336feabe5d' where id in (
  '6e7d4b95-8add-4645-9356-44ad2048d640'   -- نرمين جمال
) and manager_employee_id is null;

-- ===== AI Videos member reports to محمد زكريا =====
update employee_profiles set manager_employee_id = '8c0e5f13-5b4b-44f6-a239-2b84c4cab4e1' where id in (
  'bc5ac4b9-d2aa-4902-9592-683a99e58b7d'   -- بولا ثروت
) and manager_employee_id is null;

-- ===== Video Editing members report to اشرف مختار =====
update employee_profiles set manager_employee_id = 'fa2ba04f-1397-4e76-9626-0c2366de0592' where id in (
  '43a2ba27-5578-4cc5-81b6-7e0fdbaacd28',  -- سماء مصباح
  '8d5cb3db-d651-4bb8-bb9d-ab0e22b362ef'   -- محمد يسري
) and manager_employee_id is null;

-- ===== Dept heads report to Head of Technical (احمد حبيب) =====
update employee_profiles set manager_employee_id = '2f5441e2-6a1f-4691-ba8d-bf10ce57d3d7' where id in (
  '27b1e7fd-778e-407b-b1e4-0ae10867d94b',  -- اية خفاجي (Account Manager head)
  'ddd4de6b-e72d-4806-b241-6c68ebcdbc4a',  -- محمد حجي (Art Direction head)
  'bc899c0c-20f1-40f9-ad6f-875bf05bb288',  -- الاء فتحي (Social Media head)
  '38c18c2d-d25a-430f-a39a-3fa402800cbc',  -- محمد عادل (SEO Content head)
  '2f326c11-b168-4f5d-8a3b-52b5ce153ecf',  -- نوف العتيبي (Social Content head)
  'fa2ba04f-1397-4e76-9626-0c2366de0592',  -- اشرف مختار (Media buying / Video Editing head)
  '848a1cb9-c441-499b-8fa0-87336feabe5d',  -- اية رضا (PR head)
  '8c0e5f13-5b4b-44f6-a239-2b84c4cab4e1',  -- محمد زكريا (AI Videos / Moderator)
  'c96639e8-04d2-401c-8a4d-bc083226dac7',  -- حسن شاهين (SEO head)
  'eacb733e-6947-4386-b2b9-c9d09a8d104d'   -- جهاد رمضان (Quality Control)
) and manager_employee_id is null;

-- Head of Technical reports to the CEO (Mohammed Alsultan).
update employee_profiles set manager_employee_id = '8902f9c8-2556-487e-9110-ca05a3e1a8b6' where id in (
  '2f5441e2-6a1f-4691-ba8d-bf10ce57d3d7'   -- احمد حبيب
) and manager_employee_id is null;
