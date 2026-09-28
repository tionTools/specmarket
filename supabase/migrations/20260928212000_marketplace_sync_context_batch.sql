-- Collapse the two per-cycle REST lookups (deleted orders + sync state) into one
-- service-role RPC. The request body carries external IDs, so hosted API logs no longer
-- contain the long repeated ?external_id=in.(...) query strings.
create or replace function public.get_crm_marketplace_order_sync_context(
  p_platform text,
  p_external_ids text[]
)
returns table (
  external_id text,
  is_deleted boolean,
  source_hash text,
  order_id uuid,
  synced_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select distinct item.external_id
    from pg_catalog.unnest(p_external_ids) as item(external_id)
    where item.external_id is not null and item.external_id <> ''
  )
  select
    requested.external_id,
    deleted.external_id is not null as is_deleted,
    state.source_hash,
    state.order_id,
    state.synced_at
  from requested
  left join public.crm_deleted_marketplace_orders deleted
    on deleted.platform = p_platform
   and deleted.external_id = requested.external_id
  left join public.crm_marketplace_order_sync_state state
    on state.platform = p_platform
   and state.external_id = requested.external_id;
$$;

revoke all on function public.get_crm_marketplace_order_sync_context(text, text[])
from public, anon, authenticated;
grant execute on function public.get_crm_marketplace_order_sync_context(text, text[])
to service_role;
