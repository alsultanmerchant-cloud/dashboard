-- Backfill org chart from Sky Light organization PDF (2026-05-13).
-- Conservative: only updates where PDF name -> DB record is unambiguous.

-- ===== 1. Department heads (where PDF specifies and DB is missing) =====

-- Video Editing → HEAD: اشرف مختار
update departments set head_employee_id = 'fa2ba04f-1397-4e76-9626-0c2366de0592'
  where id = '2c627760-8b28-41f2-9ba8-4d73b7377937' and head_employee_id is null;

-- AI Videos → HEAD: محمد زكريا (per PDF: "HEAD: Zakaria")
update departments set head_employee_id = '8c0e5f13-5b4b-44f6-a239-2b84c4cab4e1'
  where id = '4fa4f561-b301-4dbf-a9b8-cb98e6542553' and head_employee_id is null;

-- Moderator → HEAD: محمد زكريا (per PDF)
update departments set head_employee_id = '8c0e5f13-5b4b-44f6-a239-2b84c4cab4e1'
  where id = 'bd7db0a4-8995-4baa-b738-b5b2e394be22' and head_employee_id is null;

-- ===== 2. Employee department assignments =====

-- Account Manager (إدارة الحسابات)
update employee_profiles set department_id = 'e6de3783-15f3-41ae-a0b8-91be33b0fe21' where id in (
  '32dc8bdb-7b4e-4ef8-ae2d-d8f1c802ef5e',  -- بسنت محمد الصلب (Bassant TL)
  '0386f93f-d34e-49d2-bdfd-34a7f22a6c76',  -- شيماء هيثم (Shaimaa TL)
  '5a130832-48bb-4eb7-a166-1ae80893feb4',  -- دينا الحسيني (Dina Elhoseiny)
  '7eeb6745-7075-4ec2-810e-2273dd4fa5ba',  -- كريم سامح (Kareem)
  'a77e20f4-9856-4cdc-939e-dc6f89afeeb4'   -- سالي محمد (Sally)
) and department_id is null;

-- Art Direction Designs (الإخراج الفني والتصميمات)
update employee_profiles set department_id = '6350c11f-526b-4a12-ab85-c601b169bf05' where id in (
  'f7bb4469-ceec-4ca3-8355-1e6a9cf1ee12',  -- اسراء اسامه (Esraa Osama, Mona team)
  'b6231989-fb0c-4e9a-b7c5-241405ed48ea',  -- مني أبو سليمان (Mona TL)
  'af0440b1-61fd-4ece-b860-7ea65ad77f7f',  -- نغم محمد (Nagham TL)
  '4125bb13-fc94-4287-8a3a-3296a957a1c2',  -- حنين حسين (Haneen TL)
  'e1259dfe-3e0b-423a-9fe5-bec716e677f3',  -- ميرنا جمال (Merna TL)
  '31985ed1-9b1c-4b69-9910-e2dccc94fbe3',  -- نوران أيمن (Nouran TL)
  'd433d4b9-caf9-4250-8ab4-5200d67b5a2b',  -- مريم شعبان (under Hager team)
  'a5555aae-7206-48d3-937f-b6177e45c0c0',  -- هبة النجار
  'f200b71d-e8a6-4d41-95a9-dc5f5e2f8054',  -- محمد تامر
  '2ab42093-11d1-49ed-bd59-1f74e9c93b9f',  -- فدوى امير
  '59863af3-af2a-4fa5-a94e-3af6e6a70884',  -- سميره الطوبجي
  'ab5b6b05-89c1-46ef-96b2-9495f472a99d',  -- علية غنيم
  '6264fe75-7543-4620-87fb-4708d3edfb11',  -- امل صالح
  'd3a5c15a-6d44-4e6d-a80f-2409251348dc'   -- وليد احمد
) and department_id is null;

-- Graphic
update employee_profiles set department_id = '4a634b69-7b44-450f-a4cb-1d6f897febf5' where id in (
  '3ce7753b-7ffa-4e05-b063-563664c689cf',  -- احمد محسن (Ahmed Mohsen TL)
  'c84ab898-c862-4e8d-8263-310ae17f5390',  -- عبدالله غيث (Abdullah Ghaith)
  '7c74020b-1de2-47d9-a714-a3a89519b73a',  -- حسام محمد (Hossam Mohamed)
  '8de98186-d01c-44bd-b8cd-97c942593c69',  -- عبدالرحمن احمد (Abdelrahman Ahmed)
  '04e84fe4-ac51-4929-90f1-6edd178bc32d'   -- محمد حبيب (Mohamed Habib)
) and department_id is null;

-- Motion
update employee_profiles set department_id = 'dde90cc3-c713-456a-9433-868cb8c7d515' where id in (
  '15bacd6f-95ad-4165-94a9-96ed73a00fa5',  -- محمد مسلماني (Almoslmany TL)
  'edd510f5-fd3f-4bb4-a6a0-7b3b43508693',  -- دنيا احمد (Donia)
  '4c80874c-74f6-4c82-a301-bacbb1ae1a92'   -- سلمي تامر (Salma)
) and department_id is null;

-- Social Media (السوشيال ميديا)
update employee_profiles set department_id = '537c2b86-388c-4eca-acc5-3a02e02ce562' where id in (
  'efd30bba-a324-4fa3-9896-a187fd27630f',  -- جنة احمد (Gannah)
  '4c035c4d-25ee-491c-bf9c-1dfb5ccfceb9',  -- نور مشعل (Nour Mashaal)
  'bca157f3-5882-402e-8091-048e77a97141',  -- اعتماد مصطفي (Eatimad)
  '39984131-58e5-4c1a-abb2-b1c1bc9f87f3',  -- شروق سليمان (Shrouq)
  '87e5b733-70b3-4ebc-96bc-4e30a04d4da7'   -- زياد حجي (Zyad Heji)
) and department_id is null;

-- SEO content (محتوى السيو)
update employee_profiles set department_id = '5467823c-5860-4d0c-9105-ccb1afa178bf' where id in (
  'ac1872ee-af8b-4421-8c4b-611b40f7092e'   -- يحيى علاء (D Yehya)
) and department_id is null;

-- Quality Control (الجودة)
update employee_profiles set department_id = 'febd8808-80de-4e89-9393-23591a5ef080' where id in (
  '76ba7a3c-d1e5-4378-a9af-1afad723a2df'   -- منة ابراهيم (Menna Ibrahim)
) and department_id is null;

-- HR (الموارد البشرية)
update employee_profiles set department_id = 'a2b9b8b4-8ce1-456d-9cd3-e6cb1ebdd104' where id in (
  '53ae32b1-3723-4bb1-95c2-119829381186',  -- چيلان محمود (Jelan)
  '3a4f4bea-fb27-44b6-831b-23e0457dff4c'   -- جميلة محمود (Gamila)
) and department_id is null;

-- Accountant (المحاسبة)
update employee_profiles set department_id = '346bd5ce-8804-498f-a872-81a077ebd28a' where id in (
  '6969aaf2-3d9f-40bb-aeb1-ca9f37f47738'   -- عمار ياسر (Ammar)
) and department_id is null;

-- Public Relations (العلاقات العامة (PR))
update employee_profiles set department_id = 'd28fb1e3-6c59-4d5b-b66f-df4c6e4b7858' where id in (
  '6e7d4b95-8add-4645-9356-44ad2048d640'   -- نرمين جمال (Nermeen)
) and department_id is null;

-- AI Videos (فيديو الذكاء الاصطناعي)
update employee_profiles set department_id = '4fa4f561-b301-4dbf-a9b8-cb98e6542553' where id in (
  'bc5ac4b9-d2aa-4902-9592-683a99e58b7d'   -- بولا ثروت (Bola Tharwat)
) and department_id is null;

-- Video Editing (تحرير الفيديو)
update employee_profiles set department_id = '2c627760-8b28-41f2-9ba8-4d73b7377937' where id in (
  '43a2ba27-5578-4cc5-81b6-7e0fdbaacd28',  -- سماء مصباح (Smaa Mosbah)
  '8d5cb3db-d651-4bb8-bb9d-ab0e22b362ef'   -- محمد يسري (yousri)
) and department_id is null;

-- SEO (تحسين محركات البحث) — assign Hassan to the dept he heads
update employee_profiles set department_id = 'd718b4d0-4c06-4fc3-9983-92cee3259c4e'
  where id = 'c96639e8-04d2-401c-8a4d-bc083226dac7' and department_id is null;
