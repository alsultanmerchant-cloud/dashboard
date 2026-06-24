-- 0211 — Sky Light feedback: even design/content tasks sometimes shouldn't
-- have an upload date ("سعات بيحصل تغيير معين — ك اكسيبشن"). Add an explicit
-- exception flag so the specialist can mark a task as "no upload needed",
-- which removes it from the /uploads queue (distinct from "upload date not set
-- yet", which still surfaces via the derived/deadline date).
alter table public.tasks
  add column if not exists upload_not_required boolean not null default false;

comment on column public.tasks.upload_not_required is
  'Specialist-set exception: this design/content task needs no upload; excluded from the uploads queue regardless of upload_due_date / deadline.';
