-- Keep supplier debt aligned with shipment lifecycle:
-- a cancelled/returned order with only a bare TTN and no physical movement
-- must not contribute to the supplier debt.
create or replace function public.get_crm_current_cost_totals()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'usd',
    coalesce(
      sum(
        case
          when i.cost_usd > 0
            then i.cost_usd * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
          else 0
        end
      ),
      0
    ),
    'uah',
    coalesce(
      sum(
        case
          when i.cost_usd > 0
            then 0
          else i.cost * greatest(0, i.quantity - coalesce(r.returned_quantity, 0))
        end
      ),
      0
    )
  )
  from public.crm_orders o
  join public.crm_order_items i on i.order_id = o.id
  left join public.crm_order_item_returns r
    on r.order_id = i.order_id
    and r.item_position = i.position
  where nullif(btrim(coalesce(o.delivery ->> 'ttn', '')), '') is not null
    and not (
      (
        lower(coalesce(o.status, '')) ~ '(скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим)'
        or lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) in ('returning', 'returned')
      )
      and nullif(btrim(coalesce(o.delivery ->> 'printedAt', '')), '') is null
      and lower(btrim(coalesce(o.delivery ->> 'trackingNormalizedStatus', ''))) not in (
        'accepted',
        'in_transit',
        'ready_for_pickup',
        'delivered',
        'returning',
        'returned'
      )
    );
$$;

revoke all on function public.get_crm_current_cost_totals() from public, anon;
grant execute on function public.get_crm_current_cost_totals() to authenticated;


-- Existing cancelled Prom orders may already have the new Prom payload hash saved
-- while the old CRM TTN was preserved by the previous fallback. Force one retry
-- without changing the order data directly; the next Prom sync will re-read the
-- marketplace payload and clear the stale active TTN through normal sync logic.
update public.crm_marketplace_order_sync_state as sync_state
set
  source_hash = 'force-resync:prom-cancelled-ttn:' || sync_state.source_hash,
  synced_at = now()
from public.crm_orders as orders
where sync_state.order_id = orders.id
  and sync_state.platform = 'Пром'
  and orders.platform = 'Пром'
  and nullif(btrim(coalesce(orders.delivery ->> 'ttn', '')), '') is not null
  and lower(coalesce(orders.status, '')) ~ '(скас|отмен|cancel)'
  and nullif(btrim(coalesce(orders.delivery ->> 'printedAt', '')), '') is null
  and lower(btrim(coalesce(orders.delivery ->> 'trackingNormalizedStatus', ''))) not in (
    'accepted',
    'in_transit',
    'ready_for_pickup',
    'delivered',
    'returning',
    'returned'
  );
