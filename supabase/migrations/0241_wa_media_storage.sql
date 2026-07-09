-- 0241_wa_media_storage.sql
-- Persist WhatsApp media binaries so satisfaction analysis can pass images/files
-- to the vision-capable model instead of relying only on captions/filenames.

alter table public.wa_messages
  add column if not exists media_storage_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_filename text,
  add column if not exists media_size_bytes bigint;

create index if not exists idx_wa_messages_media
  on public.wa_messages (organization_id, client_id, sent_at desc)
  where media_storage_path is not null;

insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa_media_org_read'
  ) then
    create policy wa_media_org_read on storage.objects
      for select using (bucket_id = 'wa-media' and public.has_org_access((storage.foldername(name))[1]::uuid));
  end if;
end $$;
