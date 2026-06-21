-- Records the moment the contracts Google-Sheet was last pulled, so the
-- "Pull from Sheet" button can show a "last synced" timestamp. We can't source
-- this from audit_logs: the sheet sync writes entity_id = 'excel-acc-sheet'
-- into audit_logs.entity_id (a uuid column), so that audit row fails silently
-- and never lands. A dedicated org-level stamp (mirrors ai_knowledge_updated_at,
-- migration 0197) is the reliable source. Single-tenant, so one column on the
-- org row is enough; stamped at the end of a successful full sync.
alter table public.organizations
  add column if not exists contracts_synced_at timestamptz;
