-- 0145_client_merge.sql
--
-- Client de-duplication / merge support, so the team can manually close the
-- sheet↔Odoo duplicate gap. The same real company exists twice — once from
-- the contracts sheet (external_source='excel-acc-sheet', carries contracts +
-- WhatsApp groups) and once from Odoo (external_source='odoo', carries the
-- delivery projects). Merging unifies them so contracts, groups and projects
-- all resolve to one canonical client.
--
-- Design:
--   * clients.merged_into_client_id — non-destructive tombstone. The merged
--     (source) row stays but points at the canonical (target) row, and is
--     hidden from every client listing. Reversible: clear the pointer and
--     the row reappears (though references stay on the target).
--   * merge_clients(source, target) RPC — re-points all 8 FK columns that
--     reference clients.id from source→target, sets the tombstone, and logs.
--     Idempotent-ish: a row already merged into the same target is a no-op.

alter table public.clients
  add column if not exists merged_into_client_id uuid
    references public.clients(id) on delete set null;

create index if not exists clients_merged_into_idx
  on public.clients (merged_into_client_id)
  where merged_into_client_id is not null;

comment on column public.clients.merged_into_client_id is
  'If set, this client was merged INTO the referenced canonical client. The row is kept (reversible) but hidden from listings.';

-- merge_clients: re-point every client_id reference from source to target.
-- Returns a jsonb summary of how many rows moved per table.
create or replace function public.merge_clients(
  p_source uuid,
  p_target uuid,
  p_org uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_src clients;
  v_tgt clients;
  v_moved jsonb := '{}'::jsonb;
  v_n int;
begin
  if p_source = p_target then
    raise exception 'source and target are the same client';
  end if;

  select * into v_src from public.clients where id = p_source and organization_id = p_org;
  if not found then raise exception 'source client not found'; end if;
  select * into v_tgt from public.clients where id = p_target and organization_id = p_org;
  if not found then raise exception 'target client not found'; end if;
  if v_tgt.merged_into_client_id is not null then
    raise exception 'target client is itself already merged';
  end if;

  -- Re-point each FK table. Guarded per-table so adding/removing a table is
  -- localized. message_count etc. travel with the rows.
  update public.contracts set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('contracts', v_n);

  update public.projects set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('projects', v_n);

  update public.wa_group_links set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('wa_group_links', v_n);

  update public.wa_messages set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('wa_messages', v_n);

  update public.client_chat_imports set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('client_chat_imports', v_n);

  update public.client_satisfaction_analyses set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('client_satisfaction_analyses', v_n);

  update public.sales_handover_forms set client_id = p_target where client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('sales_handover_forms', v_n);

  update public.leads set converted_client_id = p_target where converted_client_id = p_source;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('leads', v_n);

  -- Backfill target.external_id from source when the target lacks one, so the
  -- sheet's "C123" code survives on the canonical row (handy for lookups).
  if v_tgt.external_id is null and v_src.external_id is not null then
    update public.clients set external_id = v_src.external_id where id = p_target;
  end if;

  -- Tombstone the source.
  update public.clients set merged_into_client_id = p_target, updated_at = now()
   where id = p_source;

  return jsonb_build_object(
    'source', p_source, 'target', p_target, 'moved', v_moved
  );
end $$;

comment on function public.merge_clients(uuid, uuid, uuid) is
  'Merge source client into target: re-point all client_id references, tombstone the source. Returns per-table move counts.';
